import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server';
import { SupabaseBackend, BackendError } from './supabase-backend';
import { startSupabaseTestHttp } from './supabase-test-http';
import { createDefaultUserProfile } from '../utils/deployment-logic';

test('Phase 3 HTTP: complete directory summaries without site/vector reads; manual expiry drains batches with one explicit final site read and preserves RBAC', async () => {
  const profile = (key: string, role: 'admin' | 'agent' | 'sub_admin', allowedTabs?: any[]) => {
    const id = randomUUID();
    return {
      ...createDefaultUserProfile({ id, name: key, email: `${key}@aether.local` }),
      userId: id,
      role,
      allowedTabs,
    };
  };
  const profiles = [
    profile('admin_one', 'admin'),
    profile('field_agent_1', 'agent'),
    profile('users_sub', 'sub_admin', ['users']),
    profile('sites_sub', 'sub_admin', ['sites']),
    profile('other_sub', 'sub_admin', ['analytics']),
    ...Array.from({ length: 1002 }, (_, i) => ({
      ...profile(`bulk_${String(i).padStart(4, '0')}`, 'agent'),
      fullName: 'Same Name',
      serialNo: `SN-UP-${2000 + i}`,
    })),
  ];
  const sites = Array.from({ length: 11005 }, (_, i) => ({
    id: `site_${String(i).padStart(5, '0')}`,
    siteCode: `UP-${i}`,
    district: 'Patna',
    clientName: `Office ${i}`,
    computerCount: 1,
    status: i < 1005 ? 'in_progress' : 'completed',
    reservedByUser: 'field_agent_1',
    completedByUser: i < 1005 ? undefined : 'field_agent_1',
    startedAt: new Date(Date.now() - 25 * 3600000).toISOString(),
  }));
  const behavior = { maxRows: 37, failRpc: '' };
  const remote = await startSupabaseTestHttp({ profiles, sites }, behavior);
  remote.tables.face_templates.push({
    user_key: 'bulk_1001',
    embedding: Array(128).fill(0.25),
    photo_thumbnail: 'face-thumbnail',
  });
  const backend = new SupabaseBackend({ url: remote.url, serviceRoleKey: 'test-service-role-key' });
  const app = await createApp({
    backend,
    enableSiteRealtime: false,
    hmacSecret: 'phase3-http-secret-at-least-thirty-two-characters',
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = async (path: string, cookie?: string, body: unknown = {}) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const login = async (key: string) => {
    const response = await request('/api/supabase/sign-in', undefined, {
      username: key,
      password: key === 'field_agent_1' ? 'AgentStrongPass!2026' : 'AdminStrongPass!2026',
    });
    assert.equal(response.status, 200);
    return response.cookie!;
  };
  const directory = '/api/supabase/list-users';
  const expiry = '/api/supabase/sites/expire-stale';
  try {
    const admin = await login('admin_one');
    const agent = await login('field_agent_1');
    const usersSub = await login('users_sub');
    const sitesSub = await login('sites_sub');
    const otherSub = await login('other_sub');
    for (const path of [directory, expiry]) {
      assert.equal((await request(path)).status, 401);
      assert.equal((await request(path, agent)).status, 403);
      assert.equal((await request(path, otherSub)).status, 403);
    }
    assert.equal((await request(expiry, usersSub)).status, 403);
    assert.equal((await request(directory, sitesSub)).status, 403);
    const start = remote.requests.length;
    const users = await request(directory, usersSub);
    assert.equal(users.status, 200);
    assert.equal(users.data.users.length, profiles.length);
    const field = users.data.users.find(
      (u: any) => u.user_metadata.username === 'field_agent_1',
    ).user_metadata;
    assert.equal(field.completed_count, 10000);
    assert.equal(field.in_progress_count, 1005);
    const last = users.data.users.find(
      (u: any) => u.user_metadata.username === 'bulk_1001',
    ).user_metadata;
    assert.equal(last.serial_no, 'SN-UP-3001');
    assert.equal(last.completed_count, 0);
    assert.equal(last.in_progress_count, 0);
    assert.equal(last.facial_enrolled, true);
    assert.equal(last.facial_photo, 'face-thumbnail');
    assert.doesNotMatch(JSON.stringify(users.data), /embedding/);
    const directoryRequests = remote.requests.slice(start);
    assert.equal(
      directoryRequests.filter((r) => r.path === '/rest/v1/rpc/user_directory_summaries').length,
      3,
    );
    assert.ok(
      !directoryRequests.some(
        (r) => r.path === '/rest/v1/sites' || r.path === '/rest/v1/face_templates',
      ),
    );
    assert.ok(directoryRequests.filter((r) => r.path === '/rest/v1/profiles').length > 1);

    // The batch API is also what the background timer uses: no before/after scans or per-row log writes.
    const sweepStart = remote.requests.length;
    const first = await backend.expireReservations();
    assert.equal(first.length, 500);
    assert.deepEqual(
      remote.requests.slice(sweepStart).map((r) => r.path),
      ['/rest/v1/rpc/release_expired_reservations_batch'],
    );
    const manualStart = remote.requests.length;
    const manual = await request(expiry, sitesSub);
    assert.equal(manual.status, 200);
    assert.equal(manual.data.expiredCount, 505);
    assert.equal(manual.data.expiredSiteIds.length, 505);
    assert.equal(manual.data.sites.length, 11005);
    const expiryLogs = remote.tables.activity_logs.filter(
      (l) => l.actor_username === 'system_cron_24h',
    );
    assert.equal(expiryLogs.length, 1005);
    assert.equal(new Set(expiryLogs.map((l) => l.site_id)).size, 1005);
    const manualRequests = remote.requests.slice(manualStart);
    assert.equal(
      manualRequests.filter((r) => r.path === '/rest/v1/rpc/release_expired_reservations_batch')
        .length,
      2,
    );
    assert.equal(
      manualRequests.filter((r) => r.path === '/rest/v1/sites' && !r.query?.includes('gt.')).length,
      1,
    );
    assert.ok(
      !manualRequests.some((r) => r.method === 'POST' && r.path === '/rest/v1/activity_logs'),
    );
    const noopStart = remote.requests.length;
    assert.deepEqual(await backend.expireReservations(), []);
    assert.deepEqual(
      remote.requests.slice(noopStart).map((r) => r.path),
      ['/rest/v1/rpc/release_expired_reservations_batch'],
    );

    behavior.failRpc = 'user_directory_summaries';
    const failure = await request(directory, admin);
    assert.equal(failure.status, 503);
    assert.deepEqual(failure.data.users, []);
    assert.match(failure.data.error, /Injected RPC failure/);
    behavior.failRpc = 'release_expired_reservations_batch';
    assert.equal((await request(expiry, admin)).status, 503);
  } finally {
    app.locals.disposeReservationSweep();
    await app.locals.disposeSiteEvents();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await remote.close();
  }
});

test('Phase 3 adapters reject incomplete, duplicate, invalid and failed-later-batch summaries; expiry never fabricates IDs', async () => {
  let response: any = { rows: [] };
  let calls = 0;
  const backend = new SupabaseBackend({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-key',
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const requested = body.p_user_keys;
      if (response === 'second-batch-fails') {
        if (calls === 2)
          return Response.json({ message: 'later summary batch failed' }, { status: 400 });
        return Response.json({
          rows: requested.map((userKey: string) => ({
            userKey,
            completed: 0,
            inProgress: 0,
            facialEnrolled: false,
            facialPhoto: null,
          })),
        });
      }
      return Response.json(response);
    },
  });
  const row = {
    userKey: 'agent',
    completed: 1,
    inProgress: 0,
    facialEnrolled: false,
    facialPhoto: null,
  };
  for (const rows of [
    [],
    [row, row],
    [{ ...row, userKey: 'other' }],
    [{ ...row, completed: -1 }],
    [{ ...row, inProgress: 0.5 }],
    [{ ...row, facialEnrolled: 'yes' }],
    [{ ...row, facialPhoto: {} }],
  ]) {
    response = { rows };
    await assert.rejects(backend.userDirectorySummaries(['agent']), BackendError);
  }
  response = { rows: [row] };
  assert.deepEqual((await backend.userDirectorySummaries(['agent', 'agent'])).get('agent'), row);
  response = 'second-batch-fails';
  calls = 0;
  await assert.rejects(
    backend.userDirectorySummaries(Array.from({ length: 501 }, (_, i) => `user_${i}`)),
    /later summary batch failed/,
  );
  assert.equal(calls, 2);
  for (const data of [
    null,
    {},
    { expiredSiteIds: ['a', 'a'] },
    { expiredSiteIds: [1] },
    { expiredSiteIds: [''] },
    { expiredSiteIds: Array(501).fill('id') },
  ]) {
    response = data;
    await assert.rejects(backend.expireReservations(), /Invalid reservation expiry response/);
  }
  let failedCalls = 0;
  const failedWrite = new SupabaseBackend({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-key',
    fetch: async () => {
      failedCalls++;
      throw new Error('connection lost after commit');
    },
  });
  await assert.rejects(failedWrite.expireReservations(), /connection lost after commit/);
  assert.equal(
    failedCalls,
    1,
    'ambiguous writes must not be silently retried to consume another batch',
  );
});

test('idle server never schedules reservation RPC sweeps', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let calls = 0;
  const app = await createApp({
    backend: {
      expireReservations: async () => {
        calls++;
        return [];
      },
    } as any,
    enableSiteRealtime: false,
    hmacSecret: 'phase3-no-poll-secret-at-least-thirty-two-characters',
  });
  try {
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, 0, 'idle uptime must not generate Supabase RPC traffic');
    app.locals.disposeReservationSweep();
  } finally {
    await app.locals.disposeSiteEvents();
  }
});
