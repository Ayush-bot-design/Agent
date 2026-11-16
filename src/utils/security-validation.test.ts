import { identityTestInput } from '../server/identity-test-fixtures';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeText,
  sanitizeDistrict,
  checkTabAccess,
  checkAnyTabAccess,
  checkUserResourceOwnership,
  validateUserCreationPayload,
  validateProfilePayload,
  validateServerSideSiteUpdate,
  VerifiedAuthContext,
} from './security-validation';

const mockBaseSite: any = {
  id: 'site-1',
  siteCode: 'UP-LKO-101',
  district: 'Lucknow',
  clientName: 'Collectorate',
  address: 'Hazratganj, Lucknow',
  expectedHostnamePrefix: 'UP-LKO-NIC',
  status: 'available',
  milestones: [
    { id: 'reserve', label: 'Reserve', completed: false },
    { id: 'verify', label: 'Verify', completed: false },
    { id: 'install', label: 'Install', completed: false },
    { id: 'upload', label: 'Upload', completed: false },
  ],
  documents: [],
};

describe('Zero-Trust Backend Security & Validation Module', () => {
  const adminContext: VerifiedAuthContext = {
    userId: 'admin-123',
    userKey: 'admin',
    email: 'admin@mohan.io',
    role: 'admin',
  };

  const agentContext: VerifiedAuthContext = {
    userId: 'agent-456',
    userKey: 'ayush',
    email: 'ayush@aether.local',
    role: 'agent',
  };

  it('sanitizes HTML tags, script injections, and control characters', () => {
    const raw = '<b>Bold</b> <script>alert(1)</script>\0Null';
    const clean = sanitizeText(raw);
    assert.equal(clean, 'Bold alert(1)Null');
  });

  it('validates Uttar Pradesh districts against the official whitelist', () => {
    assert.equal(sanitizeDistrict('Lucknow').isValid, true);
    assert.equal(sanitizeDistrict('lucknow').isValid, true);
    assert.equal(sanitizeDistrict('London').isValid, false);
  });

  it('enforces deny-by-default RBAC checks (blocks unauthenticated and unauthorized roles)', () => {
    const adminOnly = checkUserResourceOwnership(agentContext, 'admin', true);
    assert.equal(adminOnly.allowed, false);
    assert.equal(adminOnly.statusCode, 403);

    const adminSelf = checkUserResourceOwnership(adminContext, 'admin', true);
    assert.equal(adminSelf.allowed, true);
  });

  it('enforces horizontal user isolation (prevents IDOR across agent profiles)', () => {
    const crossProfile = checkUserResourceOwnership(agentContext, 'ravi_captain', false);
    assert.equal(crossProfile.allowed, false);

    const ownProfile = checkUserResourceOwnership(agentContext, 'ayush', false);
    assert.equal(ownProfile.allowed, true);
  });

  it('validates user creation payload and rejects weak passwords', () => {
    const bad = validateUserCreationPayload({
      username: 'rahul',
      password: '123',
      role: 'agent',
    });
    assert.equal(bad.isValid, false);
    assert.equal(
      validateUserCreationPayload({
        username: 'rahul',
        password: 'StrongPass1',
        role: 'agent',
      }).isValid,
      false,
    );

    const good = validateUserCreationPayload({
      ...identityTestInput(),
      username: 'rahul_agent',
      password: 'StrongPassword123!',
      role: 'agent',
      fullName: 'Rahul Verma',
      phone: '+91 94150 12345',
      address: 'Sector 18, Indira Nagar, Lucknow, UP',
      legalProofType: 'Aadhaar',
      legalProofNumber: '5432-1234-8765',
      serialNo: 'SN-UP-5566',
    });
    assert.equal(good.isValid, true);
    assert.equal(good.sanitized?.email, 'rahul_agent@aether.local');
    assert.equal(good.sanitized?.fullName, 'Rahul Verma');
    assert.equal(good.sanitized?.serialNo, undefined);
    assert.equal(good.sanitized?.legalProofType, 'Aadhaar');
    assert.equal(good.sanitized?.legalProofNumber, '5432-1234-8765');
  });

  it('binds profile updates strictly to the authenticated session identity', () => {
    const res = validateProfilePayload(
      {
        userKey: 'spoofed_other_user',
        fullName: '<b>Ayush Sharma</b>',
        employeeId: 'up-tech-ayush-101',
        phone: '+91 9876543210',
        address: '42 Gomti Nagar, Lucknow, UP',
        legalProofType: 'PAN Card',
        legalProofNumber: 'ABCDE1234F',
        onDuty: true,
      },
      agentContext,
    );
    assert.equal(res.isValid, true);
    assert.equal(res.sanitized?.userKey, 'ayush');
    assert.equal(res.sanitized?.fullName, 'Ayush Sharma');
    assert.equal(res.sanitized?.address, '42 Gomti Nagar, Lucknow, UP');
    assert.equal(res.sanitized?.legalProofType, 'PAN Card');
    assert.equal(res.sanitized?.legalProofNumber, 'ABCDE1234F');
  });

  it('blocks marking a site completed on the server if hostname or document verification is missing', () => {
    const baseSite = {
      ...mockBaseSite,
      status: 'in_progress' as const,
      reservedByUser: 'ayush',
    };

    // Attempt to force status: 'completed' without hostname verification or document
    const bypassAttempt = validateServerSideSiteUpdate(
      baseSite,
      {
        ...baseSite,
        status: 'completed',
      },
      agentContext,
    );
    assert.equal(bypassAttempt.isValid, false);
    assert.equal(bypassAttempt.statusCode, 400);

    // Attempt by another agent ('ravi_captain') to modify 'ayush' reservation
    const otherAgent: VerifiedAuthContext = {
      userId: 'agent-202',
      userKey: 'ravi_captain',
      email: 'ravi_captain@aether.local',
      role: 'agent',
    };
    const hijackAttempt = validateServerSideSiteUpdate(baseSite, { ...baseSite }, otherAgent);
    assert.equal(hijackAttempt.isValid, false);
    assert.equal(hijackAttempt.statusCode, 403);
  });

  it('requires live photo evidence for every exception and five words for Other', () => {
    const activeSite = {
      ...mockBaseSite,
      status: 'in_progress' as const,
      reservedByUser: 'ayush',
      computerCount: 1,
      hostnameVerifications: [{ verified: false, hostname: '' }],
    };
    const submitException = (exception: Record<string, unknown>) =>
      validateServerSideSiteUpdate(
        activeSite,
        {
          ...activeSite,
          hostnameVerifications: [
            {
              verified: true,
              hostname: 'EXCUSED-01',
              exceptionProofPhoto: 'data:image/jpeg;base64,AAAA',
              ...exception,
            },
          ],
        },
        agentContext,
        [activeSite],
      );

    const unavailableWithoutPhoto = submitException({
      exceptionReason: 'pc_unavailable',
      exceptionProofPhoto: undefined,
    });
    assert.equal(unavailableWithoutPhoto.isValid, false);

    const unavailable = submitException({ exceptionReason: 'pc_unavailable' });
    assert.equal(unavailable.isValid, true);
    assert.equal(
      unavailable.sanitizedSite?.hostnameVerifications[0].exceptionReason,
      'pc_unavailable',
    );

    const windowsSeven = submitException({ exceptionReason: 'windows_7' });
    assert.equal(windowsSeven.isValid, true);

    const shortOther = submitException({
      exceptionReason: 'other',
      exceptionDescription: 'Power issue',
      exceptionProofPhoto: 'data:image/jpeg;base64,AAAA',
    });
    assert.equal(shortOther.isValid, false);

    const missingOtherPhoto = submitException({
      exceptionReason: 'other',
      exceptionDescription: 'The computer has an unsupported operating system',
      exceptionProofPhoto: undefined,
    });
    assert.equal(missingOtherPhoto.isValid, false);

    const validOther = submitException({
      exceptionReason: 'other',
      exceptionDescription: 'The computer has an unsupported operating system',
      exceptionProofPhoto: 'data:image/jpeg;base64,AAAA',
    });
    assert.equal(validOther.isValid, true);
    assert.equal(
      validOther.sanitizedSite?.hostnameVerifications[0].exceptionDescription,
      'The computer has an unsupported operating system',
    );
  });

  it('requires live workstation photo evidence for standard hostname submissions', () => {
    const activeSite = {
      ...mockBaseSite,
      status: 'in_progress' as const,
      reservedByUser: 'ayush',
      computerCount: 1,
      hostnameVerifications: [{ verified: false, hostname: '' }],
    };
    const submitHostname = (workstationProofPhoto?: string) =>
      validateServerSideSiteUpdate(
        activeSite,
        {
          ...activeSite,
          hostnameVerifications: [
            {
              verified: true,
              hostname: 'OFFICE-PC-01',
              ramGB: 8,
              windowsVersion: 'Windows 11 24H2',
              systemArchitecture: 'x64',
              ...(workstationProofPhoto ? { workstationProofPhoto } : {}),
            },
          ],
        },
        agentContext,
        [activeSite],
      );

    const missingPhoto = submitHostname();
    assert.equal(missingPhoto.isValid, false);
    assert.match(missingPhoto.error || '', /live workstation photo/);

    const validPhoto = submitHostname('data:image/jpeg;base64,AAAA');
    assert.equal(validPhoto.isValid, true);
    assert.equal(
      validPhoto.sanitizedSite?.hostnameVerifications[0].workstationProofPhoto,
      'data:image/jpeg;base64,AAAA',
    );
  });

  it('requires and safely stores per-computer inventory for new hostname submissions', () => {
    const activeSite = {
      ...mockBaseSite,
      status: 'in_progress' as const,
      reservedByUser: 'ayush',
      computerCount: 1,
      hostnameVerifications: [{ verified: false, hostname: '' }],
    };
    const makePayload = (inventory: Record<string, unknown>) => ({
      ...activeSite,
      hostnameVerifications: [
        {
          verified: true,
          hostname: 'OFFICE-PC-01',
          workstationProofPhoto: 'data:image/jpeg;base64,AAAA',
          ...inventory,
        },
      ],
    });
    const missingInventory = validateServerSideSiteUpdate(
      activeSite,
      makePayload({}),
      agentContext,
      [activeSite],
    );
    assert.equal(missingInventory.isValid, false);
    assert.match(missingInventory.error || '', /installed RAM/);

    const validInventory = validateServerSideSiteUpdate(
      activeSite,
      makePayload({
        ramGB: 4,
        windowsVersion: 'Windows 11 24H2',
        windowsEdition: 'Pro',
        windowsBuild: '<script>26100.1</script>',
        systemArchitecture: 'x64',
      }),
      agentContext,
      [activeSite],
    );
    assert.equal(validInventory.isValid, true);
    assert.deepEqual(
      {
        ramGB: validInventory.sanitizedSite?.hostnameVerifications[0].ramGB,
        windowsVersion: validInventory.sanitizedSite?.hostnameVerifications[0].windowsVersion,
        windowsEdition: validInventory.sanitizedSite?.hostnameVerifications[0].windowsEdition,
        windowsBuild: validInventory.sanitizedSite?.hostnameVerifications[0].windowsBuild,
        systemArchitecture:
          validInventory.sanitizedSite?.hostnameVerifications[0].systemArchitecture,
      },
      {
        ramGB: 4,
        windowsVersion: 'Windows 11 24H2',
        windowsEdition: 'Pro',
        windowsBuild: '26100.1',
        systemArchitecture: 'x64',
      },
    );
    assert.equal(
      validInventory.sanitizedSite?.hostnameVerifications[0].hardwareReportedBy,
      'ayush',
    );

    const invalidRam = validateServerSideSiteUpdate(
      activeSite,
      makePayload({
        ramGB: -8,
        windowsVersion: 'Windows 11',
        systemArchitecture: 'x64',
      }),
      agentContext,
      [activeSite],
    );
    assert.equal(invalidRam.isValid, false);
  });

  it('requires the software-installed step before completion when computers were excused', () => {
    const existingSite = {
      ...mockBaseSite,
      status: 'in_progress' as const,
      reservedByUser: 'ayush',
      computerCount: 2,
      hostnameVerifications: [
        { verified: false, hostname: '' },
        { verified: false, hostname: '' },
      ],
    };
    const result = validateServerSideSiteUpdate(
      existingSite,
      {
        ...existingSite,
        status: 'completed',
        hostnameVerifications: [
          {
            verified: true,
            hostname: 'OFFICE-PC-01',
            workstationProofPhoto: 'data:image/jpeg;base64,AAAA',
            ramGB: 8,
            windowsVersion: 'Windows 11 24H2',
            systemArchitecture: 'x64',
          },
          {
            verified: true,
            hostname: 'EXCUSED-02',
            exceptionReason: 'pc_unavailable',
            exceptionProofPhoto: 'data:image/jpeg;base64,AAAA',
          },
        ],
      },
      agentContext,
      [existingSite],
    );
    assert.equal(result.isValid, false);
    assert.match(result.error || '', /Software installation step has not been completed/);
  });

  it('prevents self-escalation of role or allowedTabs in validateProfilePayload', () => {
    const subAdminCtx: VerifiedAuthContext = {
      userId: 'sub-1',
      userKey: 'ops_sub',
      email: 'ops_sub@aether.local',
      role: 'sub_admin',
      allowedTabs: ['analytics'],
    };

    const agentEscalation = validateProfilePayload(
      {
        fullName: 'Rahul',
        role: 'admin',
        allowedTabs: ['sites', 'users', 'add_user', 'analytics', 'documents', 'activity_log'],
      },
      agentContext,
    );
    assert.equal(agentEscalation.isValid, true);
    assert.equal(agentEscalation.sanitized?.role, 'agent');
    assert.equal(agentEscalation.sanitized?.allowedTabs, undefined);

    const subAdminEscalation = validateProfilePayload(
      {
        fullName: 'Ops Sub',
        role: 'admin',
        allowedTabs: ['sites', 'users', 'add_user', 'analytics', 'documents', 'activity_log'],
      },
      subAdminCtx,
    );
    assert.equal(subAdminEscalation.isValid, true);
    assert.equal(subAdminEscalation.sanitized?.role, 'sub_admin');
    assert.deepEqual(subAdminEscalation.sanitized?.allowedTabs, ['analytics']);
  });

  it('blocks analytics-only sub-admin from updating available sites and rejects empty sub-admin creation tabs', () => {
    const analyticsSub: VerifiedAuthContext = {
      userId: 'sub-analytics',
      userKey: 'report_viewer',
      email: 'report_viewer@aether.local',
      role: 'sub_admin',
      allowedTabs: ['analytics'],
    };

    const siteWriteAttempt = validateServerSideSiteUpdate(
      mockBaseSite,
      { ...mockBaseSite, clientName: 'Hacked Site' },
      analyticsSub,
    );
    assert.equal(siteWriteAttempt.isValid, false);
    assert.equal(siteWriteAttempt.statusCode, 403);

    const zeroTabCreation = validateUserCreationPayload({
      username: 'zero_tabs_sub',
      password: 'StrongPassword123!',
      role: 'sub_admin',
      allowedTabs: [],
    });
    assert.equal(zeroTabCreation.isValid, false);

    const invalidTabCreation = validateUserCreationPayload({
      ...identityTestInput(),
      fullName: 'Bad Tabs Sub',
      username: 'bad_tabs_sub',
      password: 'StrongPassword123!',
      role: 'sub_admin',
      allowedTabs: ['nonexistent_tab', 'sites'],
    });
    assert.equal(invalidTabCreation.isValid, true);
    assert.deepEqual(invalidTabCreation.sanitized?.allowedTabs, ['sites']);

    const zeroTabsSub: VerifiedAuthContext = {
      userId: 'sub-zero',
      userKey: 'locked_sub',
      email: 'locked_sub@aether.local',
      role: 'sub_admin',
      allowedTabs: [],
    };
    assert.equal(checkTabAccess(zeroTabsSub, 'sites').allowed, false);
    assert.equal(checkAnyTabAccess(zeroTabsSub, ['sites', 'analytics']).allowed, false);
    assert.equal(checkUserResourceOwnership(analyticsSub, 'rahul', true, 'users').allowed, false);
    assert.equal(
      checkUserResourceOwnership(
        { ...analyticsSub, allowedTabs: ['users'] },
        'rahul',
        true,
        'users',
      ).allowed,
      true,
    );
  });
});
