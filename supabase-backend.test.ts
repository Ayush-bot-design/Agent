import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  SupabaseBackend,
  BackendError,
  profileToRow,
  rowToProfile,
  siteToRow,
  rowToSite,
} from './supabase-backend.ts';
import { startSupabaseTestHttp } from './supabase-test-http.ts';
import { createDefaultUserProfile } from '../utils/deployment-logic.ts';

const profile = (key: string) => ({
  ...createDefaultUserProfile({
    id: '00000000-0000-4000-a000-000000000001',
    email: `${key}@example.com`,
    name: key,
  }),
  role: 'agent' as const,
});

test('configuration rejects missing/service-role confusion and never reads a local config file', () => {
  assert.throws(() => SupabaseBackend.fromEnv({}), /SUPABASE_URL/);
  assert.throws(
    () =>
      SupabaseBackend.fromEnv({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      SupabaseBackend.fromEnv({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_test',
      }),
    /service-role/,
  );
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  assert.throws(
    () =>
      SupabaseBackend.fromEnv({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: jwt,
      }),
    /service-role/,
  );
  assert.ok(
    SupabaseBackend.fromEnv({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
    }),
  );
});

test('profile and site projections preserve application fields, with canonical role authoritative', () => {
  const p = {
    ...profile('agent_one'),
    fingerprintCredentialId: 'device-123',
    allowedTabs: ['sites'] as any,
  };
  const row = profileToRow(p);
  assert.equal(row.user_key, 'agent_one');
  assert.equal(row.profile_data.fingerprintCredentialId, 'device-123');
  const restored = rowToProfile({
    ...row,
    role: 'sub_admin',
    profile_data: { ...row.profile_data, role: 'admin', allowedTabs: ['users', 'invalid'] },
  });
  assert.equal(restored.role, 'sub_admin');
  assert.deepEqual(restored.allowedTabs, ['users']);
  const site = {
    id: 'site-1',
    siteCode: 'UP-LKO-1',
    district: 'Lucknow',
    clientName: 'Office',
    status: 'in_progress',
    reservedByUser: 'agent_one',
    startedAt: new Date().toISOString(),
    documents: [{ id: 'd1' }],
  } as any;
  const sr = siteToRow(site);
  assert.equal(sr.assigned_user_id, 'agent_one');
  assert.equal(rowToSite(sr).documents[0].id, 'd1');
  assert.equal(
    rowToSite({ ...sr, status: 'available', assigned_user_id: null }).reservedByUser,
    undefined,
  );
});

test('server Realtime subscription listens only for site-table invalidations and never forwards row data', async () => {
  const backend = new SupabaseBackend({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'sb_secret_test',
  });
  let subscribedChannelName = '';
  let postgresChangeHandler: ((payload: any) => void) | undefined;
  let changeFilter: any;
  let unsubscribeCount = 0;
  const fakeChannel = {
    on(event: string, filter: unknown, handler: (payload: any) => void) {
      assert.equal(event, 'postgres_changes');
      changeFilter = filter;
      postgresChangeHandler = handler;
      return this;
    },
    subscribe(callback: (status: string) => void) {
      callback('SUBSCRIBED');
      return this;
    },
    async unsubscribe() {
      unsubscribeCount += 1;
      return 'ok';
    },
  };
  (backend.admin as any).channel = (name: string) => {
    subscribedChannelName = name;
    return fakeChannel;
  };
  const invalidatedSiteIds: Array<string | undefined> = [];
  const channel = backend.subscribeToSiteChanges((siteId) => {
    invalidatedSiteIds.push(siteId);
  });

  assert.deepEqual(
    invalidatedSiteIds,
    [undefined],
    'a new subscription reconciles after connecting',
  );
  assert.equal(subscribedChannelName, 'server-site-change-notifications');
  assert.deepEqual(changeFilter, { event: '*', schema: 'public', table: 'sites' });
  postgresChangeHandler?.({
    eventType: 'UPDATE',
    new: { id: 'site-1', contact_phone: 'private', site_data: { sensitive: true } },
    old: {},
  });
  assert.deepEqual(invalidatedSiteIds, [undefined, 'site-1']);
  assert.equal(await channel.unsubscribe(), 'ok');
  assert.equal(unsubscribeCount, 1);
});

test('real SDK writes profiles, templates, attendance and private documents to HTTP Supabase endpoints', async () => {
  const remote = await startSupabaseTestHttp();
  try {
    const backend = new SupabaseBackend({
      url: remote.url,
      serviceRoleKey: 'test-service-role-key',
    });
    const p = { ...profile('agent_one'), fingerprintCredentialId: 'device-123' };
    await backend.saveProfile(p);
    assert.equal((await backend.getProfile('agent_one'))?.fingerprintCredentialId, 'device-123');
    await backend.saveFaceTemplate({
      personId: 'agent_one',
      personName: 'Agent One',
      embedding: Array(128).fill(0.1),
      enrolledAt: new Date().toISOString(),
      modelName: 'test',
    });
    assert.equal((await backend.faceTemplates()).length, 1);
    await backend.deleteFaceTemplate('agent_one');
    assert.equal(await backend.faceTemplate('agent_one'), null);
    await backend.recordLog({
      eventType: 'attendance',
      actorUsername: 'agent_one',
      description: 'Checked in',
      matchScore: 99.1,
    });
    assert.equal((await backend.logs())[0].matchScore, 99.1);
    await backend.saveDocument(
      {
        id: 'sop',
        name: 'sop.pdf',
        sizeBytes: 4,
        uploadedAt: new Date().toISOString(),
        mimeType: 'application/pdf',
        url: '',
        isCustom: true,
      },
      new Uint8Array([1, 2, 3, 4]),
    );
    const doc = await backend.document('sop');
    assert.ok(doc?.url.includes('/storage/v1/object/sign/system-documents/sop/'));
    assert.equal(remote.objects.size, 1);
    await backend.deleteDocument('sop');
    assert.equal(await backend.document('sop'), null);
    assert.equal(remote.objects.size, 0);
    assert.ok(remote.requests.every((r) => r.key === 'test-service-role-key'));
  } finally {
    await remote.close();
  }
});

test('single-site lookup reads one site by ID without listing the registry', async () => {
  const remote = await startSupabaseTestHttp({
    sites: [
      {
        id: 'site-one',
        siteCode: 'UP-LKO-1',
        district: 'Lucknow',
        clientName: 'Office One',
        status: 'available',
        documents: [],
      } as any,
    ],
  });
  try {
    const backend = new SupabaseBackend({
      url: remote.url,
      serviceRoleKey: 'test-service-role-key',
    });
    const site = await backend.siteById('site-one');
    assert.equal(site?.clientName, 'Office One');
    assert.equal(await backend.siteById('missing'), null);
    assert.ok(remote.requests.every((request) => request.path === '/rest/v1/sites'));
  } finally {
    await remote.close();
  }
});

test('software delivery settings and one-time download RPCs use only hashed tokens in server-side Supabase requests', async () => {
  const calls: { method: string; path: string; body: any }[] = [];
  let settingsRow: any = null;
  const linkRow = {
    site_id: 'site-1',
    agent_user_key: 'agent_one',
    drive_file_id: 'private-drive-id',
    file_name: 'Installer.exe',
  };
  const backend = new SupabaseBackend({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'sb_secret_test',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body =
        request.method === 'GET'
          ? null
          : await request
              .clone()
              .json()
              .catch(() => null);
      calls.push({ method: request.method, path: url.pathname, body });
      if (url.pathname.endsWith('/software_delivery_settings') && request.method === 'POST') {
        settingsRow = {
          drive_file_id: body.drive_file_id,
          file_name: body.file_name,
          updated_at: body.updated_at,
          updated_by: body.updated_by,
        };
        return Response.json(settingsRow);
      }
      if (url.pathname.endsWith('/software_delivery_settings') && request.method === 'GET') {
        return Response.json(settingsRow);
      }
      if (url.pathname.endsWith('/rpc/issue_software_download_link')) {
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/rpc/consume_software_download_link')) {
        return Response.json([linkRow]);
      }
      if (url.pathname.endsWith('/rpc/issue_software_pc_download_session')) {
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/rpc/approve_software_pc_download_session')) {
        return Response.json(true);
      }
      if (url.pathname.endsWith('/rpc/consume_software_pc_download_session')) {
        return Response.json([
          {
            site_id: 'site-1',
            site_code: 'UP-LKO-1',
            agent_user_key: 'agent_one',
            drive_file_id: 'private-drive-id',
            file_name: 'Installer.exe',
          },
        ]);
      }
      if (url.pathname.endsWith('/software_pc_download_sessions') && request.method === 'GET') {
        const session = {
          pc_session_hash: 'a'.repeat(64),
          pairing_hash: 'b'.repeat(64),
          site_id: 'site-1',
          site_code: 'UP-LKO-1',
          agent_user_key: 'agent_one',
          drive_file_id: 'private-drive-id',
          file_name: 'Installer.exe',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          approved_at: new Date().toISOString(),
          consumed_at: null,
        };
        return Response.json(url.searchParams.has('pc_session_hash') ? session : [session]);
      }
      return Response.json(
        { message: `Unexpected test request: ${url.pathname}` },
        { status: 404 },
      );
    }) as typeof fetch,
  });

  const saved = await backend.saveSoftwareDeliverySettings({
    driveFileId: 'private-drive-id',
    fileName: 'Installer.exe',
    updatedBy: 'Agent_One',
  });
  assert.equal(saved.fileName, 'Installer.exe');
  assert.equal((await backend.softwareDeliverySettings())?.driveFileId, 'private-drive-id');

  const rawToken = 'RawShortLinkTokenMustNeverBeStored';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await backend.issueSoftwareDownloadLink({
    tokenHash,
    siteId: 'site-1',
    siteCode: 'UP-LKO-1',
    agentUserKey: 'Agent_One',
    driveFileId: 'private-drive-id',
    fileName: 'Installer.exe',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  const consumed = await backend.consumeSoftwareDownloadLink(tokenHash);
  assert.deepEqual(consumed, linkRow);

  const issueCall = calls.find((call) => call.path.endsWith('/rpc/issue_software_download_link'));
  assert.ok(issueCall);
  assert.equal(issueCall.body.p_token_hash, tokenHash);
  assert.equal(JSON.stringify(issueCall.body).includes(rawToken), false);
  assert.ok(calls.some((call) => call.path.endsWith('/rpc/consume_software_download_link')));

  const pcSecret = 'private-pc-session-secret';
  const pcSessionHash = crypto.createHash('sha256').update(pcSecret).digest('hex');
  const pairingHash = crypto.createHash('sha256').update('private-pairing-token').digest('hex');
  await backend.issueSoftwarePcDownloadSession({
    pcSessionHash,
    pairingHash,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  assert.equal(
    await backend.approveSoftwarePcDownloadSession({
      pairingHash,
      siteId: 'site-1',
      siteCode: 'UP-LKO-1',
      agentUserKey: 'Agent_One',
      driveFileId: 'private-drive-id',
      fileName: 'Installer.exe',
    }),
    true,
  );
  const pcSession = await backend.softwarePcDownloadSession('a'.repeat(64));
  assert.equal(pcSession?.site_code, 'UP-LKO-1');
  assert.equal((await backend.recentSoftwarePcDownloadSessions(20))[0].agent_user_key, 'agent_one');
  assert.deepEqual(await backend.consumeSoftwarePcDownloadSession(pcSessionHash), {
    site_id: 'site-1',
    site_code: 'UP-LKO-1',
    agent_user_key: 'agent_one',
    drive_file_id: 'private-drive-id',
    file_name: 'Installer.exe',
  });

  const pcIssue = calls.find((call) =>
    call.path.endsWith('/rpc/issue_software_pc_download_session'),
  );
  assert.ok(pcIssue);
  assert.equal(pcIssue.body.p_pc_session_hash, pcSessionHash);
  assert.equal(JSON.stringify(pcIssue.body).includes(pcSecret), false);
  assert.ok(calls.some((call) => call.path.endsWith('/rpc/approve_software_pc_download_session')));
  assert.ok(calls.some((call) => call.path.endsWith('/rpc/consume_software_pc_download_session')));
});

test('database failures propagate instead of returning a successful local fallback', async () => {
  const backend = new SupabaseBackend({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'sb_secret_test',
    fetch: (async () =>
      new Response(JSON.stringify({ message: 'relation missing' }), {
        status: 404,
      })) as typeof fetch,
  });
  await assert.rejects(
    backend.sites(),
    (e: any) =>
      e instanceof BackendError && e.statusCode === 503 && /relation missing/.test(e.message),
  );
  await assert.rejects(backend.saveProfile(profile('agent_one')), BackendError);
});
