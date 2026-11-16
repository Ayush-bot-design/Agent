import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server';
import { SupabaseBackend } from './supabase-backend';
import { startSupabaseTestHttp } from './supabase-test-http';
import { createDefaultUserProfile, type InstallationSite } from '../utils/deployment-logic';

test('pause/resume HTTP: original agent self-service, next site, no stolen identity/ordinary-save bypass, stale/double requests and administrator recovery', async () => {
  const profile = (key: string, role: 'agent' | 'admin' | 'sub_admin', allowedTabs?: any[]) => {
    const id = randomUUID();
    return {
      ...createDefaultUserProfile({ id, name: key, email: `${key}@aether.local` }),
      userId: id,
      role,
      allowedTabs,
    };
  };
  const siteId = randomUUID(),
    nextId = randomUUID();
  const original = {
    id: siteId,
    siteCode: 'UP-PAUSE',
    district: 'Lucknow',
    clientName: 'Pause Test Office',
    status: 'in_progress',
    reservedByUser: 'field_agent_1',
    startedAt: new Date().toISOString(),
    computerCount: 1,
    milestones: [{ id: 'install', completed: true }],
    hostnameVerifications: [{ verified: true, hostname: 'SAVED', verifiedByUser: 'field_agent_1' }],
    documents: [],
    additionalComputers: [{ remark: 'keep' }],
  };
  const remote = await startSupabaseTestHttp({
    profiles: [
      profile('field_agent_1', 'agent'),
      profile('other', 'agent'),
      profile('admin', 'admin'),
      profile('sub', 'sub_admin', ['sites']),
    ],
    sites: [
      original,
      {
        ...original,
        id: nextId,
        siteCode: 'UP-NEXT',
        status: 'available',
        reservedByUser: undefined,
      },
    ],
  });
  const backend = new SupabaseBackend({ url: remote.url, serviceRoleKey: 'test-service-role-key' });
  const app = await createApp({
    backend,
    enableSiteRealtime: false,
    hmacSecret: 'site-pause-http-tests-secret-at-least-thirty-two-characters',
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = async (path: string, body: any, cookie?: string) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const login = async (key: string) =>
    (
      await post('/api/supabase/sign-in', {
        username: key,
        password: key === 'field_agent_1' ? 'AgentStrongPass!2026' : 'AdminStrongPass!2026',
      })
    ).cookie!;
  const pausePath = `/api/supabase/sites/${siteId}/pause-transition`;
  const pause = {
    action: 'pause',
    expectedVersion: 0,
    reason: 'office_closed',
    remark: 'The office is unexpectedly closed',
  };
  try {
    const agent = await login('field_agent_1'),
      other = await login('other'),
      admin = await login('admin'),
      sub = await login('sub');
    assert.equal((await post(pausePath, pause)).status, 401);
    assert.equal((await post(pausePath, { ...pause, expectedVersion: 0.5 }, agent)).status, 400);
    assert.equal(
      (await post(pausePath, { ...pause, userKey: 'field_agent_1' }, other)).status,
      403,
    );
    assert.equal((await post(pausePath, pause, sub)).status, 403);
    const result = await post(pausePath, pause, agent);
    assert.equal(result.status, 200);
    assert.equal(result.data.site.status, 'pending');
    assert.equal(result.data.site.pendingIssue.agentUserKey, 'field_agent_1');
    assert.deepEqual(result.data.site.hostnameVerifications, original.hostnameVerifications);
    assert.equal((await post(pausePath, pause, agent)).status, 409);
    assert.equal(
      (await post('/api/supabase/sites/claim', { siteId }, other)).status,
      400,
      'pending site cannot be claimed',
    );
    assert.equal(
      (
        await post(
          '/api/supabase/sites/update-one',
          { site: { ...result.data.site, status: 'available' } },
          agent,
        )
      ).status,
      403,
    );
    await assert.rejects(
      backend.saveSite(
        { ...result.data.site, status: 'in_progress', reservedByUser: 'other' },
        'pending',
      ),
      /protected/,
    );
    const next = await backend.siteById(nextId);
    await backend.saveSite(
      {
        ...next!,
        status: 'in_progress',
        reservedByUser: 'field_agent_1',
        startedAt: new Date().toISOString(),
      },
      'available',
    );
    assert.equal(
      (await post(pausePath, { action: 'resume', expectedVersion: 1 }, agent)).status,
      409,
    );
    assert.equal(
      (await post(pausePath, { action: 'resume', expectedVersion: 1 }, other)).status,
      403,
    );
    assert.equal(
      (await post(`/api/supabase/sites/${nextId}/pause-transition`, pause, agent)).status,
      200,
    );
    const resumed = await post(pausePath, { action: 'resume', expectedVersion: 1 }, agent);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.site.workflowVersion, 2);
    assert.equal(resumed.data.site.status, 'in_progress');
    assert.equal(resumed.data.site.pendingIssue, undefined);
    assert.ok(Date.parse(resumed.data.site.startedAt) > Date.now() - 5000);
    const stale = await post(
      '/api/supabase/sites/update-one',
      { site: { ...original, status: 'completed', workflowVersion: 0 } },
      agent,
    );
    assert.equal(stale.status, 409);
    const recoverPath = `/api/supabase/sites/${nextId}/pause-transition`;
    const recover = {
      action: 'recover',
      expectedVersion: 1,
      remark: 'Original technician unable to return',
    };
    assert.equal((await post(recoverPath, recover, sub)).status, 403);
    assert.equal((await post(recoverPath, recover, other)).status, 403);
    const recovered = await post(recoverPath, recover, admin);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.site.status, 'available');
    assert.equal(remote.tables.site_pause_events.length, 4);
    assert.equal(remote.tables.site_pause_events[0].actor_user_key, 'field_agent_1');
  } finally {
    app.locals.disposeReservationSweep();
    await app.locals.disposeSiteEvents();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await remote.close();
  }
});
