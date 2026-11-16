import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { InstallationSite } from '../utils/deployment-logic.ts';
import { createSoftwareDownloadToken, hashSoftwareDownloadToken } from './software-delivery.ts';

const hmacSecret = 'software-delivery-test-secret-which-is-at-least-32-characters';
const agentKey = 'field_agent_1';

function sessionCookie(userKey: string, role: 'admin' | 'agent') {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: role === 'admin' ? 'admin-id' : userKey === agentKey ? 'agent-id' : 'other-agent-id',
      userKey,
      email: `${userKey}@example.com`,
      role,
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', hmacSecret).update(payload).digest('base64url');
  return `aether_session=st1.${payload}.${signature}`;
}

async function withTestApp<T>(
  run: (origin: string, backend: any) => Promise<T>,
  backendOverrides: Record<string, unknown> = {},
): Promise<T> {
  const site: InstallationSite = {
    id: 'site-install-1',
    siteCode: 'UP-LKO-001',
    district: 'Lucknow',
    clientName: 'Test Office',
    status: 'in_progress',
    reservedByUser: agentKey,
    milestones: [{ id: 'install', title: 'Install', description: '', completed: false }],
    documents: [],
  } as unknown as InstallationSite;
  let consumeCount = 0;
  const backend = {
    getAuthProfile: async (userKey: string) =>
      userKey === 'admin_user'
        ? { userKey, userId: 'admin-id', email: 'admin_user@example.com', role: 'admin' }
        : userKey === agentKey
          ? { userKey, userId: 'agent-id', email: `${agentKey}@example.com`, role: 'agent' }
          : userKey === 'someone_else'
            ? {
                userKey,
                userId: 'other-agent-id',
                email: 'someone_else@example.com',
                role: 'agent',
              }
            : null,
    siteById: async (siteId: string) => (siteId === site.id ? site : null),
    softwareDeliverySettings: async () => null,
    consumeSoftwareDownloadLink: async () => {
      consumeCount += 1;
      return null;
    },
    ...backendOverrides,
  };
  const { createApp } = await import('../../server.ts');
  const app = await createApp({ backend: backend as any, hmacSecret });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test server did not bind a TCP port.');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await run(origin, { backend, getConsumeCount: () => consumeCount });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('software link issuance is authenticated, restricted to the assigned active agent, and fails closed without admin configuration', async () => {
  await withTestApp(async (origin) => {
    const noSession = await fetch(`${origin}/api/software-delivery/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ siteId: 'site-install-1' }),
    });
    assert.equal(noSession.status, 401);

    const unassignedSession = sessionCookie('someone_else', 'agent');
    const forbidden = await fetch(`${origin}/api/software-delivery/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: unassignedSession,
      },
      body: JSON.stringify({ siteId: 'site-install-1' }),
    });
    assert.equal(forbidden.status, 403);

    const assignedSession = sessionCookie(agentKey, 'agent');
    const notConfigured = await fetch(`${origin}/api/software-delivery/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: assignedSession,
      },
      body: JSON.stringify({ siteId: 'site-install-1' }),
    });
    assert.equal(notConfigured.status, 503);
    assert.match((await notConfigured.json()).error, /administrator has not configured/);
  });
});

test('software settings are admin-only and reveal no Drive file ID or permanent URL', async () => {
  const originalCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    await withTestApp(async (origin) => {
      const agentResponse = await fetch(`${origin}/api/software-delivery/admin-config`, {
        headers: { Cookie: sessionCookie(agentKey, 'agent') },
      });
      assert.equal(agentResponse.status, 403);

      const adminResponse = await fetch(`${origin}/api/software-delivery/admin-config`, {
        headers: { Cookie: sessionCookie('admin_user', 'admin') },
      });
      assert.equal(adminResponse.status, 200);
      const config = await adminResponse.json();
      assert.deepEqual(config, {
        configured: false,
        fileName: null,
        updatedAt: null,
        updatedBy: null,
        driveConfigured: false,
        serviceAccountEmail: null,
        recentDownloads: [],
      });

      const invalidLink = await fetch(`${origin}/api/software-delivery/admin-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          Cookie: sessionCookie('admin_user', 'admin'),
        },
        body: JSON.stringify({ driveUrl: 'https://attacker.example/private-installer' }),
      });
      assert.equal(invalidLink.status, 400);
      assert.match((await invalidLink.json()).error, /valid Google Drive file URL/);
    });
  } finally {
    if (originalCredentials === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalCredentials;
  }
});

test('admin software activity shows the agent and site without exposing QR hashes or Drive IDs', async () => {
  const privateHash = 'a'.repeat(64);
  await withTestApp(
    async (origin) => {
      const response = await fetch(`${origin}/api/software-delivery/admin-config`, {
        headers: { Cookie: sessionCookie('admin_user', 'admin') },
      });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.recentDownloads, [
        {
          agentUserKey: agentKey,
          siteCode: 'UP-LKO-001',
          fileName: 'TenderInstaller.exe',
          createdAt: '2026-11-13T00:00:00.000Z',
          approvedAt: '2026-11-13T00:01:00.000Z',
          downloadedAt: null,
          status: 'approved',
        },
      ]);
      assert.equal(JSON.stringify(data).includes(privateHash), false);
      assert.equal(JSON.stringify(data).includes('private-drive-id'), false);
    },
    {
      recentSoftwarePcDownloadSessions: async () => [
        {
          pc_session_hash: privateHash,
          pairing_hash: 'b'.repeat(64),
          site_id: 'site-private-id',
          site_code: 'UP-LKO-001',
          agent_user_key: agentKey,
          drive_file_id: 'private-drive-id',
          file_name: 'TenderInstaller.exe',
          created_at: '2026-11-13T00:00:00.000Z',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          approved_at: '2026-11-13T00:01:00.000Z',
          consumed_at: null,
          revoked_at: null,
        },
      ],
    },
  );
});

test('assigned agent receives a random expiring short URL and the office download is streamed once without a Drive redirect', async () => {
  const originalCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const originalFetch = globalThis.fetch;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: 'service_account',
    client_email: 'drive-reader@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });

  const fileId = '1AaBbCcDdEeFfGgHhIiJjKk';
  let issuedHash = '';
  let redeemed = false;
  let savedFileId = '';
  const linkRecord = {
    site_id: 'site-install-1',
    agent_user_key: agentKey,
    drive_file_id: fileId,
    file_name: 'TenderInstaller.exe',
  };
  const fakeGoogleFetch: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === 'https://oauth2.googleapis.com') {
      return Response.json({ access_token: 'private-server-token', expires_in: 3600 });
    }
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(url.pathname, `/drive/v3/files/${fileId}`);
    if (url.searchParams.get('alt') === 'media') {
      const bytes = Buffer.from('private installer bytes');
      return new Response(bytes, {
        headers: { 'Content-Length': String(bytes.length) },
      });
    }
    return Response.json({
      id: fileId,
      name: 'TenderInstaller.exe',
      mimeType: 'application/octet-stream',
      size: '1234',
    });
  };
  globalThis.fetch = fakeGoogleFetch;
  try {
    await withTestApp(
      async (origin) => {
        const sameOrigin = `https://${new URL(origin).host}`;
        const configResponse = await originalFetch(`${origin}/api/software-delivery/admin-config`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: sameOrigin,
            Cookie: sessionCookie('admin_user', 'admin'),
          },
          body: JSON.stringify({ driveUrl: `https://drive.google.com/file/d/${fileId}/view` }),
        });
        assert.equal(configResponse.status, 200);
        const configured = await configResponse.json();
        assert.equal(configured.fileName, 'TenderInstaller.exe');
        assert.equal('driveFileId' in configured, false);
        assert.equal('driveUrl' in configured, false);
        assert.equal(savedFileId, fileId);

        const response = await originalFetch(`${origin}/api/software-delivery/links`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: sameOrigin,
            Cookie: sessionCookie(agentKey, 'agent'),
          },
          body: JSON.stringify({ siteId: 'site-install-1' }),
        });
        assert.equal(response.status, 201);
        const generated = await response.json();
        const generatedUrl = new URL(generated.url);
        assert.equal(generatedUrl.pathname.split('/').length, 3);
        const code = generatedUrl.pathname.split('/').at(-1) || '';
        assert.match(code, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
        assert.equal(generated.fileName, 'TenderInstaller.exe');
        assert.ok(Date.parse(generated.expiresAt) > Date.now());
        assert.ok(Date.parse(generated.expiresAt) <= Date.now() + 5 * 60 * 1000);
        assert.equal(issuedHash, hashSoftwareDownloadToken(code));

        const download = await originalFetch(`${origin}/d/${code}`);
        assert.equal(download.status, 200);
        assert.match(download.headers.get('content-disposition') || '', /attachment/);
        assert.equal(download.headers.get('location'), null);
        assert.equal(await download.text(), 'private installer bytes');
        assert.equal(redeemed, true);

        const replay = await originalFetch(`${origin}/d/${code}`);
        assert.equal(replay.status, 404);
      },
      {
        softwareDeliverySettings: async () => ({ driveFileId: fileId, fileName: 'OldName.exe' }),
        saveSoftwareDeliverySettings: async (input: any) => {
          savedFileId = input.driveFileId;
          return {
            driveFileId: input.driveFileId,
            fileName: input.fileName,
            updatedAt: new Date().toISOString(),
            updatedBy: input.updatedBy,
          };
        },
        issueSoftwareDownloadLink: async (input: any) => {
          issuedHash = input.tokenHash;
          redeemed = false;
        },
        consumeSoftwareDownloadLink: async (tokenHash: string) => {
          if (tokenHash !== issuedHash || redeemed) return null;
          redeemed = true;
          return linkRecord;
        },
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCredentials === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalCredentials;
  }
});

test('PC QR handoff requires the assigned agent, streams once, and records the approved site session', async () => {
  const originalCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const originalFetch = globalThis.fetch;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: 'service_account',
    client_email: 'drive-reader@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  const fileId = '1AaBbCcDdEeFfGgHhIiJjKk';
  const fakeGoogleFetch: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === 'https://oauth2.googleapis.com') {
      return Response.json({ access_token: 'test-drive-token', expires_in: 3600 });
    }
    if (url.origin !== 'https://www.googleapis.com') throw new Error('Unexpected fetch');
    if (url.searchParams.get('alt') === 'media') {
      return new Response(Buffer.from('private installer bytes'), {
        headers: { 'Content-Length': '23' },
      });
    }
    return Response.json({
      id: fileId,
      name: 'TenderInstaller.exe',
      mimeType: 'application/octet-stream',
      size: '23',
    });
  };
  globalThis.fetch = fakeGoogleFetch;
  const qrSession: any = {};
  try {
    await withTestApp(
      async (origin) => {
        const started = await originalFetch(`${origin}/api/software-delivery/pc-sessions`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{}',
        });
        assert.equal(started.status, 200);
        const startData = await started.json();
        assert.match(startData.qrPayload, /^AETHER-SOFTWARE-PAIR:[A-Za-z0-9_-]{43}$/);
        assert.equal(startData.fileName, 'TenderInstaller.exe');
        assert.ok(
          started.headers.get('set-cookie')?.includes(`software_pc_${startData.sessionId}=`),
        );
        const pcCookie = started.headers.get('set-cookie')!.split(';')[0];

        const missingSession = await originalFetch(
          `${origin}/api/software-delivery/pc-sessions/status`,
          {
            headers: { 'X-Software-PC-Session': startData.sessionId },
          },
        );
        assert.equal(missingSession.status, 401);

        const unauthorizedApproval = await originalFetch(
          `${origin}/api/software-delivery/pc-sessions/approve`,
          {
            method: 'POST',
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              Cookie: sessionCookie('someone_else', 'agent'),
            },
            body: JSON.stringify({ pairingCode: startData.qrPayload, siteId: 'site-install-1' }),
          },
        );
        assert.equal(unauthorizedApproval.status, 403);

        const approved = await originalFetch(
          `${origin}/api/software-delivery/pc-sessions/approve`,
          {
            method: 'POST',
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              Cookie: sessionCookie(agentKey, 'agent'),
            },
            body: JSON.stringify({ pairingCode: startData.qrPayload, siteId: 'site-install-1' }),
          },
        );
        assert.equal(approved.status, 200);
        assert.deepEqual(await approved.json(), { success: true, siteCode: 'UP-LKO-001' });
        assert.equal(qrSession.agent_user_key, agentKey);
        assert.equal(qrSession.site_id, 'site-install-1');
        const approvalReplay = await originalFetch(
          `${origin}/api/software-delivery/pc-sessions/approve`,
          {
            method: 'POST',
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              Cookie: sessionCookie(agentKey, 'agent'),
            },
            body: JSON.stringify({ pairingCode: startData.qrPayload, siteId: 'site-install-1' }),
          },
        );
        assert.equal(approvalReplay.status, 409);

        const status = await originalFetch(`${origin}/api/software-delivery/pc-sessions/status`, {
          headers: {
            'X-Software-PC-Session': startData.sessionId,
            Cookie: pcCookie,
          },
        });
        assert.equal(status.status, 200);
        assert.equal((await status.json()).status, 'approved');

        const download = await originalFetch(
          `${origin}/api/software-delivery/pc-sessions/download`,
          {
            method: 'POST',
            headers: {
              Origin: origin,
              Cookie: pcCookie,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ sessionId: startData.sessionId }),
          },
        );
        assert.equal(download.status, 200);
        assert.equal(await download.text(), 'private installer bytes');
        assert.equal(qrSession.consumed_at != null, true);

        const replay = await originalFetch(`${origin}/api/software-delivery/pc-sessions/download`, {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: pcCookie,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ sessionId: startData.sessionId }),
        });
        assert.equal(replay.status, 404);
      },
      {
        softwareDeliverySettings: async () => ({ driveFileId: fileId, fileName: 'OldName.exe' }),
        issueSoftwarePcDownloadSession: async (input: any) => {
          Object.assign(qrSession, {
            pc_session_hash: input.pcSessionHash,
            pairing_hash: input.pairingHash,
            created_at: new Date().toISOString(),
            expires_at: input.expiresAt,
            approved_at: null,
            consumed_at: null,
          });
        },
        approveSoftwarePcDownloadSession: async (input: any) => {
          if (input.pairingHash !== qrSession.pairing_hash || qrSession.approved_at) return false;
          Object.assign(qrSession, {
            site_id: input.siteId,
            site_code: input.siteCode,
            agent_user_key: input.agentUserKey,
            drive_file_id: input.driveFileId,
            file_name: input.fileName,
            approved_at: new Date().toISOString(),
          });
          return true;
        },
        softwarePcDownloadSession: async (sessionHash: string) =>
          sessionHash === qrSession.pc_session_hash ? { ...qrSession } : null,
        consumeSoftwarePcDownloadSession: async (sessionHash: string) => {
          if (
            sessionHash !== qrSession.pc_session_hash ||
            !qrSession.approved_at ||
            qrSession.consumed_at
          )
            return null;
          qrSession.consumed_at = new Date().toISOString();
          return {
            site_id: qrSession.site_id,
            site_code: qrSession.site_code,
            agent_user_key: qrSession.agent_user_key,
            drive_file_id: qrSession.drive_file_id,
            file_name: qrSession.file_name,
          };
        },
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCredentials === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalCredentials;
  }
});

test('short download route atomically redeems the code and gives generic failure for invalid or reused links', async () => {
  await withTestApp(async (origin, state) => {
    const code = createSoftwareDownloadToken();
    const response = await fetch(`${origin}/d/${code}`);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /invalid, expired, or already used/);
    assert.equal(state.getConsumeCount(), 1);
    assert.equal(
      response.headers.get('cache-control'),
      'no-store, no-cache, must-revalidate, private',
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');

    const malformed = await fetch(`${origin}/d/not-a-secret`);
    assert.equal(malformed.status, 404);
    assert.equal(state.getConsumeCount(), 1);
  });
});
