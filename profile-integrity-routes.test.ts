import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../../server.ts';
import { SupabaseBackend } from './supabase-backend';
import { startSupabaseTestHttp } from './supabase-test-http';
import { createDefaultUserProfile } from '../utils/deployment-logic';
import { identityTestInput } from './identity-test-fixtures';
import { getIdentityCompliance } from '../utils/identity-compliance';

test('phase 1 HTTP: real onboarding, server serials, authorized evidence review, and immutable ordinary updates', async () => {
  const seed = (key: string, role: 'admin' | 'sub_admin' | 'agent') => {
    const id = randomUUID();
    return {
      ...createDefaultUserProfile({ id, name: key, email: `${key}@aether.local` }),
      userId: id,
      role,
      allowedTabs: role === 'sub_admin' ? ['add_user', 'users'] : undefined,
    };
  };
  const remote = await startSupabaseTestHttp({
    profiles: [
      seed('admin_one', 'admin'),
      seed('admin_two', 'admin'),
      seed('review_sub', 'sub_admin'),
      seed('field_agent_1', 'agent'),
    ],
  });
  const backend = new SupabaseBackend({ url: remote.url, serviceRoleKey: 'test-service-role-key' });
  const app = await createApp({
    backend,
    enableSiteRealtime: false,
    hmacSecret: 'identity-tests-secret-of-at-least-32-characters',
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
  const login = async (username: string) =>
    (
      await post('/api/supabase/sign-in', {
        username,
        password: username === 'field_agent_1' ? 'AgentStrongPass!2026' : 'AdminStrongPass!2026',
      })
    ).cookie!;
  try {
    const admin = await login('admin_one');
    const sub = await login('review_sub');
    const agent = await login('field_agent_1');
    assert.ok(admin && sub && agent);
    const initialAuthCount = remote.users.size;
    const create = (name: string, patch: object = {}) => ({
      ...identityTestInput(),
      username: name,
      fullName: 'New Technician',
      role: 'agent',
      password: 'StrongPassword!2026',
      ...patch,
    });
    for (const patch of [
      { address: '' },
      { legalProofNumber: '' },
      { legalProofDoc: undefined },
      { legalProofDoc: { name: 'claimed.pdf', sizeBytes: 154200, verified: true } },
    ]) {
      assert.equal(
        (await post('/api/supabase/create-user', create('invalid_user', patch), admin)).status,
        400,
      );
    }
    assert.equal(
      remote.users.size,
      initialAuthCount,
      'invalid onboarding must not create Auth accounts',
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        post(
          '/api/supabase/create-user',
          create(`parallel_${i}`, { serialNo: 'SN-UP-9999' }),
          admin,
        ),
      ),
    );
    assert.ok(
      results.every((r) => r.status === 200),
      JSON.stringify(results),
    );
    const serials = results.map((r) => r.data.user.user_metadata.serial_no);
    assert.equal(new Set(serials).size, 6);
    assert.ok(!serials.includes('SN-UP-9999'));
    assert.ok(
      results.every((result) => result.data.user.user_metadata.full_name === 'New Technician'),
    );
    assert.ok(
      results.every((result) => result.data.user.user_metadata.legal_proof_doc.verified === false),
    );
    assert.equal(
      remote.tables.profile_identity_audits.length,
      0,
      'same-name accounts receive unique serials immediately without an approval or verification action',
    );
    for (const result of results) {
      const saved = await backend.getProfile(result.data.user.user_metadata.username);
      assert.equal(saved!.serialNo, result.data.user.user_metadata.serial_no);
      assert.equal(getIdentityCompliance(saved!).status, 'pending_verification');
    }

    const duplicates = await Promise.all([
      post('/api/supabase/create-user', create('duplicate_name'), admin),
      post('/api/supabase/create-user', create('duplicate_name'), admin),
    ]);
    assert.equal(duplicates.filter((r) => r.status === 200).length, 1);
    assert.ok(duplicates.some((r) => r.status === 400 || r.status === 409));
    const surviving = (await backend.getProfile('duplicate_name'))!;
    assert.ok(
      remote.users.has(surviving.userId!),
      'failed provisioning must not delete the concurrently created account',
    );
    const target = 'parallel_0';
    let profile = (await backend.getProfile(target))!;
    const originalSerial = profile.serialNo;
    assert.equal(profile.legalProofDoc!.verified, false);
    assert.equal(
      profile.legalProofDoc!.sizeBytes,
      Buffer.from(identityTestInput().legalProofDoc.fileData.split(',')[1], 'base64').length,
    );
    assert.equal(getIdentityCompliance(profile).status, 'pending_verification');
    const path = `/api/supabase/profile/${target}/identity`;
    const verify = { action: 'verify', expectedUpdatedAt: profile.updatedAt, confirmed: true };
    assert.equal((await post(path, verify)).status, 401);
    assert.equal((await post(path, verify, agent)).status, 403);
    assert.equal((await post(path, verify, sub)).status, 403);
    assert.equal((await post(path, { ...verify, confirmed: false }, admin)).status, 400);
    const reviewed = await post(path, verify, admin);
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
    assert.equal(reviewed.data.compliance.status, 'verified');
    assert.equal(reviewed.data.profile.legalProofDoc.verifiedBy, 'admin_one');
    assert.ok(Date.parse(reviewed.data.profile.legalProofDoc.verifiedAt));
    assert.equal((await post(path, verify, admin)).status, 409, 'stale review must conflict');
    const targetCookie = (
      await post('/api/supabase/sign-in', { username: target, password: 'StrongPassword!2026' })
    ).cookie!;
    profile = reviewed.data.profile;
    const ordinary = await post(
      `/api/supabase/profile/${target}`,
      {
        profile: {
          ...profile,
          serialNo: 'SN-UP-999999',
          address: 'Forged address',
          legalProofNumber: 'FORGED',
          legalProofDoc: { verified: false },
          alternatePhone: '+91 9999900000',
        },
      },
      targetCookie,
    );
    assert.equal(ordinary.status, 200);
    assert.equal(ordinary.data.profile.serialNo, originalSerial);
    assert.equal(ordinary.data.profile.address, identityTestInput().address);
    assert.equal(ordinary.data.profile.legalProofDoc.verifiedBy, 'admin_one');
    assert.equal(ordinary.data.profile.alternatePhone, '+91 9999900000');
    profile = (await backend.getProfile(target))!;
    const replacement = await post(
      path,
      { action: 'replace', expectedUpdatedAt: profile.updatedAt, identity: identityTestInput() },
      admin,
    );
    assert.equal(replacement.status, 200);
    assert.equal(replacement.data.profile.legalProofDoc.verified, false);
    assert.equal(replacement.data.profile.legalProofDoc.verifiedBy, undefined);
    assert.equal(replacement.data.profile.serialNo, originalSerial);
    assert.equal(remote.tables.profile_identity_audits.length, 2);
    assert.equal(
      remote.tables.profile_identity_audits[1].previous_identity.legalProofDoc.verifiedBy,
      'admin_one',
    );
    const adminProfile = (await backend.getProfile('admin_one'))!;
    const ownReplace = await post(
      '/api/supabase/profile/admin_one/identity',
      {
        action: 'replace',
        expectedUpdatedAt: adminProfile.updatedAt,
        identity: identityTestInput(),
      },
      admin,
    );
    assert.equal(ownReplace.status, 200);
    assert.equal(
      (
        await post(
          '/api/supabase/profile/admin_one/identity',
          {
            action: 'verify',
            expectedUpdatedAt: ownReplace.data.profile.updatedAt,
            confirmed: true,
          },
          admin,
        )
      ).status,
      403,
    );
    // Even a super admin's normal profile payload cannot bypass the separate verification action.
    const adminNormal = await post(
      '/api/supabase/profile/admin_one',
      {
        profile: {
          ...ownReplace.data.profile,
          serialNo: 'SN-UP-9999',
          legalProofDoc: {
            ...ownReplace.data.profile.legalProofDoc,
            verified: true,
            verifiedBy: 'admin_one',
            verificationVersion: 1,
          },
        },
      },
      admin,
    );
    assert.equal(adminNormal.status, 200);
    assert.equal(adminNormal.data.profile.legalProofDoc.verified, false);
    // Existing users with legacy or missing evidence can still sign in; no silent migration rewrite.
    assert.equal(
      getIdentityCompliance((await backend.getProfile('field_agent_1'))!).status,
      'review_required',
    );
    assert.ok(await login('field_agent_1'));
  } finally {
    await app.locals.disposeSiteEvents();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await remote.close();
  }
});
