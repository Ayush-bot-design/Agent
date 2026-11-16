import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../../server.ts';
import { SupabaseBackend } from './supabase-backend';
import { startSupabaseTestHttp } from './supabase-test-http';
import { createDefaultMilestones, createDefaultUserProfile } from '../utils/deployment-logic';

test('bulk site deletion really removes Supabase rows, refuses pending work as a whole batch, and audits the operator', async () => {
  const profile = (key: string, role: 'admin' | 'agent' | 'sub_admin', allowedTabs?: string[]) => {
    const id = randomUUID();
    return {
      ...createDefaultUserProfile({ id, email: `${key}@aether.local`, name: key }),
      userId: id,
      userKey: key,
      role,
      allowedTabs: allowedTabs ?? [],
    };
  };
  const makeSite = (n: number, status: string, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    siteCode: `UP-DEL-${100 + n}`,
    district: 'Agra',
    clientName: `Deletion Office ${n}`,
    status,
    computerCount: 1,
    milestones: createDefaultMilestones(),
    hostnameVerifications: [],
    documents: [],
    ...extra,
  });

  const keep = makeSite(1, 'available');
  const first = makeSite(2, 'completed');
  const second: any = makeSite(3, 'available', {
    documents: [
      {
        id: 'certificate',
        name: 'signed.pdf',
        docType: 'Sign-Off Certificate',
        sizeBytes: 10,
        uploadedAt: new Date().toISOString(),
        checksum: 'abc',
        storagePath: '',
      },
    ],
  });
  const pending = makeSite(4, 'pending');
  second.documents[0].storagePath = `${second.id}/certificate`;

  const remote = await startSupabaseTestHttp({
    profiles: [
      profile('root_admin', 'admin'),
      profile('field_agent', 'agent'),
      profile('site_manager', 'sub_admin', ['sites']),
      profile('analyst', 'sub_admin', ['analytics']),
    ],
    sites: [keep, first, second, pending],
  });
  remote.objects.set(`site-certificates/${second.id}/certificate`, new Uint8Array([1, 2, 3]));

  const backend = new SupabaseBackend({ url: remote.url, serviceRoleKey: 'test-service-role-key' });
  const app = await createApp({
    backend,
    hmacSecret: 'site-delete-tests-secret-32-characters',
    enableSiteRealtime: false,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = async (path: string, body: object, cookie = '') => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const signIn = async (username: string, password = 'AdminStrongPass!2026') => {
    const result = await post('/api/supabase/sign-in', { username, password });
    assert(result.cookie, `sign-in failed for ${username}: ${JSON.stringify(result.data)}`);
    return result.cookie!;
  };
  const deletePath = '/api/supabase/sites/delete';
  const siteIds = () => remote.tables.sites.map((row: any) => row.id).sort();

  try {
    assert.equal((await post(deletePath, { ids: [first.id] })).status, 401);

    const admin = await signIn('root_admin');
    const agent = await signIn('field_agent');
    const manager = await signIn('site_manager');
    const analyst = await signIn('analyst');

    // Authorisation: agents never delete, and a sub-admin needs the sites module.
    assert.equal((await post(deletePath, { ids: [first.id] }, agent)).status, 403);
    assert.equal((await post(deletePath, { ids: [first.id] }, analyst)).status, 403);

    // Payload validation.
    for (const body of [
      {},
      { ids: [] },
      { ids: 'site' },
      { ids: [42] },
      { ids: [''] },
      { ids: Array.from({ length: 101 }, () => randomUUID()) },
    ]) {
      assert.equal((await post(deletePath, body, admin)).status, 400);
    }
    assert.equal((await post(deletePath, { ids: [randomUUID()] }, admin)).status, 404);

    // Pending work is recoverable: the whole batch is refused and nothing disappears.
    const beforePending = siteIds();
    const blocked = await post(deletePath, { ids: [first.id, pending.id] }, admin);
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /Recover pending work/);
    assert.deepEqual(siteIds(), beforePending, 'a refused batch deletes nothing');

    // A real deletion removes the rows from the database, not just from the browser.
    const single = await post(deletePath, { ids: [first.id] }, manager);
    assert.equal(single.status, 200);
    assert.deepEqual(single.data.deleted, [first.id]);
    assert.equal(single.data.deletedCount, 1);
    assert.equal(
      remote.tables.sites.some((row: any) => row.id === first.id),
      false,
      'the deleted row is gone from Supabase',
    );
    const singleLog = remote.tables.activity_logs.at(-1)!;
    assert.equal(singleLog.event_type, 'status_change');
    assert.equal(singleLog.new_status, 'deleted');
    assert.equal(singleLog.previous_status, 'completed');
    assert.equal(singleLog.site_code, first.siteCode);
    assert.match(singleLog.description, /permanently deleted site "Deletion Office 2"/);
    assert.equal(singleLog.actor_username, 'site_manager');

    // Bulk deletion clears the rest in one audited batch, certificates included.
    const bulk = await post(deletePath, { ids: [second.id, keep.id] }, admin);
    assert.equal(bulk.status, 200);
    assert.deepEqual([...bulk.data.deleted].sort(), [second.id, keep.id].sort());
    assert.deepEqual(
      remote.tables.sites.map((row: any) => row.id),
      [pending.id],
      'only the protected pending site survives',
    );
    assert.equal(
      remote.objects.has(`${second.id}/certificate`),
      false,
      'certificate object removed',
    );
    const bulkLog = remote.tables.activity_logs.at(-1)!;
    assert.equal(bulkLog.new_status, 'deleted');
    assert.equal(bulkLog.previous_status, null);
    assert.match(bulkLog.description, /permanently deleted 2 sites/);
    assert.match(bulkLog.description, new RegExp(second.siteCode));
    assert.match(bulkLog.description, new RegExp(keep.siteCode));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await remote.close();
  }
});
