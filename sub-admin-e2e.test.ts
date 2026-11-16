import { identityTestInput } from '../server/identity-test-fixtures';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createDefaultUserProfile } from './deployment-logic.ts';
import { SupabaseBackend } from '../server/supabase-backend.ts';
import { startSupabaseTestHttp } from '../server/supabase-test-http.ts';

async function apiReq(
  baseUrl: string,
  method: string,
  route: string,
  cookie?: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string; cookie?: string; setCookie?: string }> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.Origin = baseUrl;

  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const setCookie = res.headers.get('set-cookie');
  const responseCookie = setCookie?.split(';', 1)[0] || undefined;
  return {
    status: res.status,
    json,
    text,
    cookie: responseCookie,
    setCookie: setCookie || undefined,
  };
}

describe('Supabase HTTP contract: Sub-Admin Zero-Trust RBAC & Exploit Defense', () => {
  let BASE_URL = '';
  let appServer: http.Server;
  let remote: Awaited<ReturnType<typeof startSupabaseTestHttp>>;

  before(async () => {
    const nowIso = new Date().toISOString();
    const profile = (key: string, id: string, role: 'admin' | 'agent') => ({
      ...createDefaultUserProfile({ id, email: `${key}@aether.local`, name: key }),
      userId: id,
      role,
      fullName: role === 'admin' ? 'Super Admin' : 'Field Agent One',
      serialNo: role === 'admin' ? 'SN-UP-1001' : 'SN-UP-1002',
      updatedAt: nowIso,
    });
    remote = await startSupabaseTestHttp({
      profiles: [
        profile('super_admin_1', '00000000-0000-4000-a000-000000000001', 'admin'),
        profile('field_agent_1', '00000000-0000-4000-a000-000000000002', 'agent'),
      ],
      sites: [
        {
          id: '00000000-0000-4000-a000-000000000101',
          siteCode: 'UP-LKO-901',
          district: 'Lucknow',
          clientName: 'Collectorate Test Office',
          address: 'Hazratganj, Lucknow, UP',
          latitude: 26.8467,
          longitude: 80.9462,
          contactPhone: '+91 9999900001',
          expectedHostnamePrefix: 'UP-LKO-901',
          status: 'available',
          computerCount: 4,
          documents: [{ id: 'doc-secret', name: 'secret.pdf' }],
          biometricArrivalVerification: {
            verified: true,
            verificationId: 'BIO-SECRET-1',
            matchScore: 99,
          },
        },
        {
          id: '00000000-0000-4000-a000-000000000102',
          siteCode: 'UP-AGR-902',
          district: 'Agra',
          clientName: 'Agra Sub-Division',
          address: 'Sanjay Place, Agra, UP',
          status: 'completed',
          computerCount: 2,
          reservedByUser: 'field_agent_1',
          completedByUser: 'field_agent_1',
          startedAt: nowIso,
          completedAt: nowIso,
          milestones: [],
          documents: [
            {
              id: 'certificate-existing-1',
              name: 'signed-handover.pdf',
              docType: 'Sign-Off Certificate',
              sizeBytes: 19,
              uploadedAt: nowIso,
              checksum: 'Stored',
              storagePath: '00000000-0000-4000-a000-000000000102/certificate-existing-1',
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
    });
    remote.objects.set(
      'site-certificates/00000000-0000-4000-a000-000000000102/certificate-existing-1',
      new Uint8Array(Buffer.from('%PDF-1.4 test certificate')),
    );
    const backend = new SupabaseBackend({
      url: remote.url,
      serviceRoleKey: 'test-service-role-key',
    });
    const { createApp } = await import('../../server.ts');
    const app = await createApp({
      backend,
      hmacSecret: 'test-only-hmac-secret-at-least-32-characters',
      enableSiteRealtime: false,
    });
    appServer = app.listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    BASE_URL = `http://127.0.0.1:${(appServer.address() as any).port}`;
  });

  after(async () => {
    if (appServer) await new Promise<void>((resolve) => appServer.close(() => resolve()));
    if (remote) await remote.close();
  });

  it('enforces end-to-end zero-trust Sub-Admin RBAC, prevents escalation & cross-tab exploits, and applies live revocation', async () => {
    // 1. Unauthenticated access must fail with 401
    const unauthMe = await apiReq(BASE_URL, 'GET', '/api/supabase/me');
    assert.equal(unauthMe.status, 401);

    // 2. Super Admin signs in
    const adminSignIn = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-in', undefined, {
      username: 'super_admin_1',
      password: 'AdminStrongPass!2026',
    });
    assert.equal(adminSignIn.status, 200);
    assert.equal(adminSignIn.json?.user?.role, 'admin');
    const adminToken = adminSignIn.cookie;
    assert.ok(adminToken?.startsWith('aether_session=st1.'));
    assert.match(adminSignIn.setCookie || '', /HttpOnly/);
    assert.equal(adminSignIn.json?.session?.access_token, undefined);

    // 3. Reject Sub-Admin creation with empty allowedTabs
    const emptySubAttempt = await apiReq(
      BASE_URL,
      'POST',
      '/api/supabase/create-user',
      adminToken,
      {
        ...identityTestInput(),
        fullName: 'Synthetic Test User',
        username: 'empty_sub_admin',
        password: 'SubAdminPass!2026',
        role: 'sub_admin',
        allowedTabs: [],
      },
    );
    assert.equal(emptySubAttempt.status, 400);

    // 4. Create Sub-Admin A with ONLY ['analytics', 'users']
    await apiReq(BASE_URL, 'POST', '/api/supabase/delete-user', adminToken, {
      userKey: 'sub_analytics_users',
    });

    const createSubA = await apiReq(BASE_URL, 'POST', '/api/supabase/create-user', adminToken, {
      ...identityTestInput(),
      fullName: 'Synthetic Test User',
      username: 'sub_analytics_users',
      password: 'SubAdminPass!2026',
      role: 'sub_admin',

      allowedTabs: ['analytics', 'users', 'invalid_hacked_tab'],
    });
    assert.equal(createSubA.status, 200);
    assert.equal(createSubA.json?.user?.role, 'sub_admin');
    assert.deepEqual(createSubA.json?.user?.allowedTabs, ['users', 'analytics']);

    // 5. Sub-Admin A signs in and verifies /api/supabase/me
    const subASignIn = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-in', undefined, {
      username: 'sub_analytics_users',
      password: 'SubAdminPass!2026',
    });
    assert.equal(subASignIn.status, 200);
    const subAToken = subASignIn.cookie;
    assert.ok(subAToken);
    assert.deepEqual(subASignIn.json?.user?.allowedTabs, ['users', 'analytics']);

    const subAMe = await apiReq(BASE_URL, 'GET', '/api/supabase/me', subAToken);
    assert.equal(subAMe.status, 200);
    assert.equal(subAMe.json?.user?.role, 'sub_admin');
    assert.deepEqual(subAMe.json?.user?.allowedTabs, ['users', 'analytics']);

    // 6. Sub-Admin A allowed endpoints succeed and telemetry strips PII
    const analyticsSummary = await apiReq(BASE_URL, 'GET', '/api/analytics/summary', subAToken);
    assert.equal(analyticsSummary.status, 200);
    assert.equal(analyticsSummary.json?.metrics?.totalSites, 2);

    const telemetrySites = await apiReq(BASE_URL, 'GET', '/api/supabase/sites', subAToken);
    assert.equal(telemetrySites.status, 200);
    assert.equal(
      (
        await apiReq(
          BASE_URL,
          'GET',
          '/api/supabase/sites/00000000-0000-4000-a000-000000000101',
          subAToken,
        )
      ).status,
      403,
      'analytics-only sub-admins must not read individual site details',
    );
    assert.equal(telemetrySites.json?.telemetryOnly, true);
    assert.equal(telemetrySites.json?.sites?.[0]?.contactPhone, undefined);
    assert.equal(telemetrySites.json?.sites?.[0]?.documents, undefined);
    assert.equal(telemetrySites.json?.sites?.[0]?.biometricArrivalVerification, undefined);
    assert.equal(
      (
        await apiReq(
          BASE_URL,
          'GET',
          '/api/supabase/sites/00000000-0000-4000-a000-000000000102/documents/certificate-existing-1',
          subAToken,
        )
      ).status,
      403,
      'analytics-only sub-admins must not access private certificate files',
    );

    const listUsers = await apiReq(BASE_URL, 'POST', '/api/supabase/list-users', subAToken, {});
    assert.equal(listUsers.status, 200);
    assert.ok(Array.isArray(listUsers.json?.users));
    const agentEntry = listUsers.json.users.find(
      (u: any) => u.user_metadata?.username === 'field_agent_1',
    );
    assert.equal(agentEntry?.user_metadata?.completed_count, 1);

    const attendanceCsv = await apiReq(BASE_URL, 'GET', '/api/attendance/export-csv', subAToken);
    assert.equal(attendanceCsv.status, 200);

    const readAgentProfile = await apiReq(
      BASE_URL,
      'GET',
      '/api/supabase/profile/field_agent_1',
      subAToken,
    );
    assert.equal(readAgentProfile.status, 200);

    // 7. Sub-Admin A cross-tab & privilege escalation attempts MUST return 403
    assert.equal(
      (await apiReq(BASE_URL, 'POST', '/api/supabase/sites/sync', subAToken, { sites: [] })).status,
      403,
    );
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/sites/update-one', subAToken, {
          site: {
            id: '00000000-0000-4000-a000-000000000101',
            siteCode: 'UP-LKO-901',
            district: 'Lucknow',
            clientName: 'Hacked',
            address: 'X',
            expectedHostnamePrefix: 'UP',
            status: 'available',
            milestones: [],
            documents: [],
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (await apiReq(BASE_URL, 'POST', '/api/supabase/sites/expire-stale', subAToken, {})).status,
      403,
    );
    assert.equal((await apiReq(BASE_URL, 'GET', '/api/sites/export-csv', subAToken)).status, 403);
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/location/resolve', subAToken, {
          url: 'https://maps.google.com/?q=26.8467,80.9462',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/create-user', subAToken, {
          ...identityTestInput(),
          fullName: 'Synthetic Test User',
          username: 'unauth_agent',
          password: 'Password!2026',
          role: 'agent',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/delete-user', subAToken, {
          userId: '00000000-0000-4000-a000-000000000002',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/documents/sop', subAToken, {
          title: 'Malicious SOP',
          fileDataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
          fileName: 'malicious.pdf',
        })
      ).status,
      403,
    );
    assert.equal(
      (await apiReq(BASE_URL, 'DELETE', '/api/documents/sop?docId=sop', subAToken)).status,
      403,
    );
    assert.equal(
      (await apiReq(BASE_URL, 'GET', '/api/supabase/activity-logs', subAToken)).status,
      403,
    );
    assert.equal((await apiReq(BASE_URL, 'GET', '/api/supabase/logs', subAToken)).status, 403);
    // Cannot reset Super Admin's fingerprint even with 'users' tab
    assert.equal(
      (await apiReq(BASE_URL, 'DELETE', '/api/fingerprint/super_admin_1', subAToken)).status,
      403,
    );
    // Cannot call update-user-permissions to escalate own role/tabs
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/update-user-permissions', subAToken, {
          userKey: 'sub_analytics_users',
          role: 'admin',
          allowedTabs: ['sites', 'users', 'add_user', 'analytics', 'documents', 'activity_log'],
        })
      ).status,
      403,
    );
    // Self-profile edit cannot escalate role or allowedTabs
    const selfProfileEdit = await apiReq(
      BASE_URL,
      'POST',
      '/api/supabase/profile/sub_analytics_users',
      subAToken,
      {
        profile: {
          fullName: 'Sub Updated',
          role: 'admin',
          allowedTabs: ['sites', 'users', 'add_user', 'analytics', 'documents', 'activity_log'],
        },
      },
    );
    assert.equal(selfProfileEdit.status, 200);
    const subAMeAfter = await apiReq(BASE_URL, 'GET', '/api/supabase/me', subAToken);
    assert.equal(subAMeAfter.json?.user?.role, 'sub_admin');
    assert.deepEqual(subAMeAfter.json?.user?.allowedTabs, ['users', 'analytics']);

    // 8. Tampered session cookie MUST return 401
    const tamperedToken = `${subAToken.slice(0, -2)}XX`;
    assert.equal((await apiReq(BASE_URL, 'GET', '/api/supabase/me', tamperedToken)).status, 401);

    // 9. Create Sub-Admin B with ONLY ['add_user']
    const createSubB = await apiReq(BASE_URL, 'POST', '/api/supabase/create-user', adminToken, {
      ...identityTestInput(),
      fullName: 'Synthetic Test User',
      username: 'sub_user_creator',
      password: 'SubCreatorPass!2026',
      role: 'sub_admin',
      allowedTabs: ['add_user'],
    });
    assert.equal(createSubB.status, 200);

    const subBSignIn = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-in', undefined, {
      username: 'sub_user_creator',
      password: 'SubCreatorPass!2026',
    });
    assert.equal(subBSignIn.status, 200);
    const subBToken = subBSignIn.cookie;
    assert.ok(subBToken);

    // Sub-Admin B CANNOT create 'admin' or 'sub_admin' (403)
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/create-user', subBToken, {
          ...identityTestInput(),
          fullName: 'Synthetic Test User',
          username: 'rogue_admin',
          password: 'RoguePassword!2026',
          role: 'admin',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/create-user', subBToken, {
          ...identityTestInput(),
          fullName: 'Synthetic Test User',
          username: 'rogue_sub',
          password: 'RoguePassword!2026',
          role: 'sub_admin',
          allowedTabs: ['sites'],
        })
      ).status,
      403,
    );

    // Sub-Admin B CAN create a Field Agent ('agent')
    const subBCreateAgent = await apiReq(BASE_URL, 'POST', '/api/supabase/create-user', subBToken, {
      ...identityTestInput(),
      fullName: 'Synthetic Test User',
      username: 'created_by_sub_agent',
      password: 'AgentCreated!2026',
      role: 'agent',
    });
    assert.equal(subBCreateAgent.status, 200);

    // Sub-Admin B CANNOT delete Super Admin or another Sub-Admin (by userId, username, OR email)
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/delete-user', subBToken, {
          userId: '00000000-0000-4000-a000-000000000001',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/delete-user', subBToken, {
          username: 'sub_analytics_users',
        })
      ).status,
      403,
    );

    // Sub-Admin B CAN delete the 'agent' it created
    const deleteCreated = await apiReq(BASE_URL, 'POST', '/api/supabase/delete-user', subBToken, {
      username: 'created_by_sub_agent',
    });
    assert.equal(deleteCreated.status, 200, JSON.stringify(deleteCreated.json));
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/delete-user', subBToken, {
          username: 'created_by_sub_agent',
        })
      ).status,
      200,
    );

    // Sub-Admin B has ONLY 'add_user' -> blocked from users, sites, activity_log
    assert.equal(
      (await apiReq(BASE_URL, 'POST', '/api/supabase/list-users', subBToken, {})).status,
      403,
    );
    assert.equal((await apiReq(BASE_URL, 'GET', '/api/supabase/sites', subBToken)).status, 403);

    // 10. Live Permission Revocation: Super Admin revokes all tabs from Sub-Admin A
    const revokeSubA = await apiReq(
      BASE_URL,
      'POST',
      '/api/supabase/update-user-permissions',
      adminToken,
      {
        userKey: 'sub_analytics_users',
        role: 'sub_admin',
        allowedTabs: [],
      },
    );
    assert.equal(revokeSubA.status, 200);
    assert.deepEqual(revokeSubA.json?.allowedTabs, []);

    // Sub-Admin A's ALREADY-ISSUED token must IMMEDIATELY reflect empty tabs and fail with 403!
    const subAMeRevoked = await apiReq(BASE_URL, 'GET', '/api/supabase/me', subAToken);
    assert.equal(subAMeRevoked.status, 200);
    assert.deepEqual(subAMeRevoked.json?.user?.allowedTabs, []);
    assert.equal((await apiReq(BASE_URL, 'GET', '/api/analytics/summary', subAToken)).status, 403);
    assert.equal(
      (await apiReq(BASE_URL, 'POST', '/api/supabase/list-users', subAToken, {})).status,
      403,
    );

    // 11. Live Deletion: Super Admin deletes Sub-Admin B -> Sub-Admin B's token fails with 401 immediately
    const deleteSubB = await apiReq(BASE_URL, 'POST', '/api/supabase/delete-user', adminToken, {
      username: 'sub_user_creator',
    });
    assert.equal(deleteSubB.status, 200);
    assert.equal((await apiReq(BASE_URL, 'GET', '/api/supabase/me', subBToken)).status, 401);

    // 12. Field Agent gets 403 on all admin/sub-admin routes
    const agentSignIn = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-in', undefined, {
      username: 'field_agent_1',
      password: 'AgentStrongPass!2026',
    });
    assert.equal(agentSignIn.status, 200);
    const agentToken = agentSignIn.cookie;
    assert.ok(agentToken);

    assert.equal((await apiReq(BASE_URL, 'GET', '/api/analytics/summary', agentToken)).status, 403);
    assert.equal(
      (await apiReq(BASE_URL, 'POST', '/api/supabase/list-users', agentToken, {})).status,
      403,
    );
    assert.equal(
      (await apiReq(BASE_URL, 'GET', '/api/supabase/activity-logs', agentToken)).status,
      403,
    );
    assert.equal(
      (
        await apiReq(BASE_URL, 'POST', '/api/supabase/update-user-permissions', agentToken, {
          userKey: 'field_agent_1',
          role: 'admin',
        })
      ).status,
      403,
    );
  });

  it('protects permission-letter routes with cookie auth, origin checks, and profile-backed fields', async () => {
    const publicView = await apiReq(BASE_URL, 'GET', '/api/documents/permission-letter/view');
    const publicDownload = await apiReq(
      BASE_URL,
      'GET',
      '/api/documents/permission-letter/download',
    );
    assert.equal(publicView.status, 401);
    assert.equal(publicDownload.status, 401);
    assert.equal((await apiReq(BASE_URL, 'GET', '/api/push/config')).status, 401);

    const signIn = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-in', undefined, {
      username: 'field_agent_1',
      password: 'AgentStrongPass!2026',
    });
    assert.equal(signIn.status, 200);
    assert.ok(signIn.cookie);

    const ownedCertificate = await fetch(
      `${BASE_URL}/api/supabase/sites/00000000-0000-4000-a000-000000000102/documents/certificate-existing-1?inline=1`,
      { headers: { Cookie: signIn.cookie! } },
    );
    assert.equal(ownedCertificate.status, 200);
    assert.equal(ownedCertificate.headers.get('content-type'), 'application/pdf');
    assert.match(await ownedCertificate.text(), /^%PDF-1\.4/);

    const pushConfig = await apiReq(BASE_URL, 'GET', '/api/push/config', signIn.cookie);
    assert.equal(pushConfig.status, 200);
    assert.equal(typeof pushConfig.json?.enabled, 'boolean');
    assert.equal(typeof pushConfig.json?.publicKey, pushConfig.json.enabled ? 'string' : 'object');
    assert.equal(pushConfig.json?.privateKey, undefined);
    const invalidPushSubscription = await apiReq(
      BASE_URL,
      'POST',
      '/api/push/subscriptions',
      signIn.cookie,
      { subscription: { endpoint: 'https://attacker.example/not-push', keys: {} } },
    );
    assert.ok(invalidPushSubscription.status === 400 || invalidPushSubscription.status === 503);

    const forgedFields = await apiReq(
      BASE_URL,
      'GET',
      '/api/documents/permission-letter/view?fullName=%3Cscript%3Ealert(1)%3C%2Fscript%3E&user=super_admin_1',
      signIn.cookie,
    );
    assert.equal(forgedFields.status, 403);

    const ownLetter = await apiReq(
      BASE_URL,
      'GET',
      '/api/documents/permission-letter/view?fullName=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      signIn.cookie,
    );
    assert.equal(ownLetter.status, 200);
    assert.match(ownLetter.text, /Field Agent One/);
    assert.doesNotMatch(ownLetter.text, /<script>alert\(1\)<\/script>/);

    const csrfResponse = await fetch(`${BASE_URL}/api/supabase/sites/claim`, {
      method: 'POST',
      headers: {
        Cookie: signIn.cookie!,
        Origin: 'https://attacker.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(csrfResponse.status, 403);

    const signedOut = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-out', signIn.cookie);
    assert.equal(signedOut.status, 200);
    assert.match(signedOut.setCookie || '', /Max-Age=0/);
  });

  it('uploads, displays, downloads, and removes private signed site certificates with loading-safe server persistence', async () => {
    const signIn = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-in', undefined, {
      username: 'field_agent_1',
      password: 'AgentStrongPass!2026',
    });
    assert.equal(signIn.status, 200);
    const token = signIn.cookie!;
    const siteId = '00000000-0000-4000-a000-000000000101';
    const siteRow = remote.tables.sites.find((row) => row.id === siteId)!;
    const originalSite = structuredClone(siteRow);
    Object.assign(siteRow, {
      status: 'in_progress',
      assigned_user_id: 'field_agent_1',
      reserved_at: new Date().toISOString(),
      site_data: {
        ...siteRow.site_data,
        status: 'in_progress',
        reservedByUser: 'field_agent_1',
        reservedByName: 'Field Agent One',
        startedAt: new Date().toISOString(),
        documents: [],
      },
    });

    try {
      const singleSite = await apiReq(BASE_URL, 'GET', `/api/supabase/sites/${siteId}`, token);
      assert.equal(singleSite.status, 200);
      assert.equal(singleSite.json.site.id, siteId);
      assert.equal(singleSite.json.sites, undefined);

      const deniedSubAdmin = await apiReq(
        BASE_URL,
        'POST',
        `/api/supabase/sites/${siteId}/documents`,
        undefined,
      );
      assert.equal(deniedSubAdmin.status, 401);

      const pdfBytes = Buffer.from('%PDF-1.7\\nverified signed site certificate');
      const upload = await fetch(`${BASE_URL}/api/supabase/sites/${siteId}/documents`, {
        method: 'POST',
        headers: {
          Cookie: token,
          Origin: BASE_URL,
          'Content-Type': 'application/pdf',
          'X-File-Name': encodeURIComponent('signed-certificate.pdf'),
        },
        body: pdfBytes,
      });
      assert.equal(upload.status, 201, await upload.clone().text());
      const uploaded = await upload.json();
      assert.equal(uploaded.document.name, 'signed-certificate.pdf');
      assert.equal(uploaded.site.id, siteId);
      assert.equal(uploaded.site.documents.length, 1);
      assert.equal(uploaded.sites, undefined);
      const documentId = uploaded.document.id;

      const download = await fetch(
        `${BASE_URL}/api/supabase/sites/${siteId}/documents/${documentId}`,
        { headers: { Cookie: token } },
      );
      assert.equal(download.status, 200);
      assert.match(download.headers.get('content-disposition') || '', /^attachment;/);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdfBytes);

      const view = await fetch(
        `${BASE_URL}/api/supabase/sites/${siteId}/documents/${documentId}?inline=1`,
        { headers: { Cookie: token } },
      );
      assert.equal(view.status, 200);
      assert.match(view.headers.get('content-disposition') || '', /^inline;/);

      const removed = await apiReq(
        BASE_URL,
        'DELETE',
        `/api/supabase/sites/${siteId}/documents/${documentId}`,
        token,
      );
      assert.equal(removed.status, 200);
      assert.deepEqual(removed.json.site.documents, []);
      assert.equal(removed.json.sites, undefined);
    } finally {
      Object.assign(siteRow, originalSite);
    }
  });

  it('requires biometric data but never GPS coordinates to reserve a site', async () => {
    const signIn = await apiReq(BASE_URL, 'POST', '/api/supabase/sign-in', undefined, {
      username: 'field_agent_1',
      password: 'AgentStrongPass!2026',
    });
    assert.equal(signIn.status, 200);
    const token = signIn.cookie;
    assert.ok(token);

    const missingBiometric = await apiReq(BASE_URL, 'POST', '/api/supabase/sites/claim', token, {
      siteId: '00000000-0000-4000-a000-000000000101',
      userName: 'Field Agent One',
    });
    assert.equal(missingBiometric.status, 400);
    assert.match(missingBiometric.json.error, /Biometric verification data is required/);

    const invalidBiometric = await apiReq(BASE_URL, 'POST', '/api/supabase/sites/claim', token, {
      siteId: '00000000-0000-4000-a000-000000000101',
      biometricVerification: { matchScore: 0 },
    });
    assert.equal(invalidBiometric.status, 400);

    const stillAvailable = await apiReq(BASE_URL, 'GET', '/api/supabase/sites?fresh=1', token);
    assert.equal(
      stillAvailable.json.sites.find((s: any) => s.id === '00000000-0000-4000-a000-000000000101')
        .status,
      'available',
    );

    // No latitude, longitude, distance, or location permission is supplied.
    const claimed = await apiReq(BASE_URL, 'POST', '/api/supabase/sites/claim', token, {
      siteId: '00000000-0000-4000-a000-000000000101',
      userName: 'Field Agent One',
      biometricVerification: {
        verificationId: 'BIO-FINGERPRINT-NO-GPS',
        matchScore: 99.9,
        verifiedAt: new Date().toISOString(),
        distanceMeters: 99999,
        geofenceVerified: false,
      },
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.json.sites, undefined);
    assert.equal(claimed.json.site.status, 'in_progress');
    assert.equal(claimed.json.site.reservedByUser, 'field_agent_1');
    assert.equal(claimed.json.site.biometricArrivalVerification.verified, true);
    assert.equal(claimed.json.site.biometricArrivalVerification.latitude, undefined);
    assert.equal(claimed.json.site.biometricArrivalVerification.longitude, undefined);
    assert.equal(claimed.json.site.biometricArrivalVerification.distanceMeters, undefined);
    assert.equal(claimed.json.site.biometricArrivalVerification.geofenceVerified, undefined);
    assert.equal(claimed.json.site.latitude, 26.8467);
    assert.equal(claimed.json.site.longitude, 80.9462);
  });
});
