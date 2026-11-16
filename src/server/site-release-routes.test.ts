import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server';
import { SupabaseBackend, siteToRow } from './supabase-backend';
import { startSupabaseTestHttp } from './supabase-test-http';
import { createDefaultUserProfile } from '../utils/deployment-logic';

test('targeted admin release preserves evidence and unrelated registry records, checks authorization and reservation conflicts', async () => {
  const profile = (key: string, role: 'admin' | 'sub_admin' | 'agent', allowedTabs?: any[]) => {
    const id = randomUUID();
    return {
      ...createDefaultUserProfile({ id, name: key, email: `${key}@aether.local` }),
      userId: id,
      role,
      allowedTabs,
    };
  };
  const target = {
    id: randomUUID(),
    siteCode: 'UP-RELEASE',
    district: 'Agra',
    clientName: 'BAAD',
    status: 'in_progress',
    reservedByUser: 'field_agent_1',
    reservedByName: 'Agent',
    assignedToUser: 'field_agent_1',
    startedAt: '2026-11-16T01:00:00.000Z',
    computerCount: 2,
    totalSystems: 7,
    milestones: [{ id: 'install', completed: true }],
    hostnameVerifications: [{ verified: true, hostname: 'KEEP', verifiedByUser: 'field_agent_1' }],
    documents: [{ id: 'doc', storagePath: 'private/keep.pdf' }],
    additionalComputers: [{ remark: 'Keep extra PC' }],
    notes: 'Full original CSV snapshot',
    biometricArrivalVerification: { verified: true },
    workflowVersion: 3,
  };
  const pending = {
    ...target,
    id: randomUUID(),
    siteCode: 'UP-PENDING',
    status: 'pending',
    pendingIssue: { remark: 'Office closed' },
  };
  const completed = {
    ...target,
    id: randomUUID(),
    siteCode: 'UP-DONE',
    status: 'completed',
    completedByUser: 'other',
  };
  const otherSites = Array.from({ length: 793 }, (_, i) => ({
    ...target,
    id: randomUUID(),
    siteCode: `UP-${i}`,
    status: 'available',
  }));
  const behavior: { beforeSitePatch?: (rows: any[]) => void } = {};
  const remote = await startSupabaseTestHttp(
    {
      profiles: [
        profile('admin', 'admin'),
        profile('sub', 'sub_admin', ['sites']),
        profile('denied', 'sub_admin', ['analytics']),
        profile('field_agent_1', 'agent'),
      ],
      sites: [target, pending, completed, ...otherSites],
    },
    behavior,
  );
  const backend = new SupabaseBackend({ url: remote.url, serviceRoleKey: 'test-service-role-key' });
  const app = await createApp({
    backend,
    enableSiteRealtime: false,
    hmacSecret: 'release-http-test-secret-at-least-thirty-two-characters',
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = async (path: string, body: any, cookie?: string) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const login = async (key: string) =>
    (
      await post('/api/supabase/sign-in', {
        username: key,
        password: key === 'field_agent_1' ? 'AgentStrongPass!2026' : 'AdminStrongPass!2026',
      })
    ).cookie!;
  const path = (id = target.id) => `/api/supabase/sites/${id}/release-reservation`;
  const body = {
    expectedVersion: 3,
    expectedOwner: 'field_agent_1',
    expectedStartedAt: target.startedAt,
  };
  try {
    const admin = await login('admin'),
      sub = await login('sub'),
      denied = await login('denied'),
      agent = await login('field_agent_1');
    assert.equal((await post(path(), body)).status, 401);
    assert.equal((await post(path(), body, agent)).status, 403);
    assert.equal((await post(path(), body, denied)).status, 403);
    for (const invalid of [
      {},
      { ...body, expectedVersion: -1 },
      { ...body, expectedVersion: 1.5 },
      { ...body, expectedStartedAt: 'yesterday' },
    ])
      assert.equal((await post(path(), invalid, admin)).status, 400);
    assert.equal((await post(path(randomUUID()), body, admin)).status, 404);
    const pendingResult = await post(path(pending.id), body, admin);
    assert.equal(pendingResult.status, 409);
    assert.match(pendingResult.data.error, /recovery/);
    assert.equal((await post(path(completed.id), body, admin)).status, 409);
    for (const stale of [
      { ...body, expectedOwner: 'other' },
      { ...body, expectedVersion: 2 },
      { ...body, expectedStartedAt: '2026-11-15T01:00:00Z' },
    ])
      assert.equal((await post(path(), stale, admin)).status, 409);
    const before = structuredClone(remote.tables.sites);
    const requestStart = remote.requests.length;
    const released = await post(
      path(),
      { ...body, site: { notes: 'FORGED', computerCount: 100 }, sites: [] },
      admin,
    );
    assert.equal(released.status, 200);
    assert.equal(released.data.success, true);
    const saved = released.data.site;
    assert.equal(saved.status, 'available');
    for (const field of [
      'reservedByUser',
      'reservedByName',
      'assignedToUser',
      'startedAt',
      'biometricArrivalVerification',
    ])
      assert.equal(saved[field], undefined, field);
    for (const field of [
      'milestones',
      'hostnameVerifications',
      'documents',
      'additionalComputers',
      'notes',
      'computerCount',
      'totalSystems',
      'workflowVersion',
    ])
      assert.deepEqual(saved[field], target[field as keyof typeof target], field);
    assert.equal(remote.tables.sites.length, 796);
    assert.deepEqual(
      remote.tables.sites.slice(1),
      before.slice(1),
      'pending, completed and every unrelated record remain untouched',
    );
    const siteRequests = remote.requests
      .slice(requestStart)
      .filter((r) => r.path === '/rest/v1/sites');
    assert.equal(siteRequests.filter((r) => r.method === 'PATCH').length, 1);
    assert(
      siteRequests.every((r) => r.query?.includes('id=eq.')),
      'read/write only selected site',
    );
    assert(!siteRequests.some((r) => r.method === 'DELETE' || r.method === 'POST'));
    const patch = siteRequests.find((r) => r.method === 'PATCH')!;
    assert.match(patch.query!, /updated_at=eq\./);
    assert.match(patch.query!, /workflow_version=eq\.3/);
    assert.equal(remote.tables.activity_logs.at(-1)?.actor_username, 'admin');
    assert.match(remote.tables.activity_logs.at(-1)?.description, /released/);
    assert.equal((await post(path(), body, admin)).status, 409, 'double release rejected');

    // Authorized sub-admin can release, but a write racing the server read must win.
    const row = remote.tables.sites[0];
    Object.assign(row, siteToRow(target as any));
    row.updated_at = new Date().toISOString();
    behavior.beforeSitePatch = (rows) => {
      behavior.beforeSitePatch = undefined;
      const current = rows.find((r) => r.id === target.id);
      current.site_data.notes = 'Concurrent saved evidence';
      current.updated_at = new Date(Date.now() + 10000).toISOString();
    };
    assert.equal((await post(path(), body, sub)).status, 409);
    assert.equal(row.status, 'in_progress');
    assert.equal(row.site_data.notes, 'Concurrent saved evidence');
    assert.equal((await post(path(), body, sub)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await remote.close();
  }
});
