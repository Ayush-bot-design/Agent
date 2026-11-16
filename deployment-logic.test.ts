import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSitesByDistrict,
  sortInstallationSites,
  filterInstallationSites,
  filterProvisionedUsers,
  canUserClaimSite,
  releaseExpiredReservations,
  parseBulkSitesInput,
  mergeUploadedSites,
  createDefaultMilestones,
  getInstallationPhaseStepper,
  paginateActivityLogs,
  InstallationSite,
  ActivityLogEntry,
  updateSiteDetails,
  adminAssignSiteToAgent,
  generateSitesCsvReport,
  getUserInstallationSummary,
  resolveUserRecordByIdentifier,
  getDistrictProgressBreakdown,
  getStaleReservations,
  releaseStaleReservations,
  resolveUserSequentialSerialNo,
  getNextSequentialSerialNo,
  getGoogleMapsNavigationUrl,
  getGoogleMapsSearchUrl,
  getComputerSoftwarePlan,
  SystemDocumentType,
  SystemDocumentRecord,
} from './deployment-logic';

const mockSites: InstallationSite[] = [
  {
    id: 'up-site-lko-101',
    siteCode: 'UP-LKO-101',
    district: 'Lucknow',
    clientName: 'Lucknow Collectorate NIC Center',
    facilityName: 'District Magistrate Record Room',
    address: 'Kaiserbagh, Hazratganj, Lucknow, Uttar Pradesh',
    zone: 'Lucknow District',
    contactPerson: 'Nodal Officer (IT)',
    contactPhone: '+91 94150 11201',
    softwarePackage: 'UP Tender Core v4.2',
    expectedHostnamePrefix: 'UP-LKO-NIC',
    sampleValidHostname: 'UP-LKO-NIC01.UP.GOV.LOCAL',
    slaWindow: 'Tender Phase 1',
    status: 'available',
    milestones: [
      {
        id: 'checkin',
        title: 'Arrival Check-in',
        completed: false,
        description: 'Technician has arrived at site',
      },
      {
        id: 'audit',
        title: 'Device Audit',
        completed: false,
        description: 'Inventory of target devices verified',
      },
      {
        id: 'install',
        title: 'Install Software',
        completed: false,
        description: 'UP Tender software package deployed',
      },
      {
        id: 'hostname_verify',
        title: 'Verify Hostname',
        completed: false,
        description: 'Local server hostname matches tender registry',
      },
      {
        id: 'paperwork',
        title: 'Official Documents',
        completed: false,
        description: 'Signed installation report uploaded',
      },
    ],
    documents: [],
    computerCount: 1,
    hostnameVerifications: [{ verified: false, hostname: '' }],
  },
  {
    id: 'up-site-vns-103',
    siteCode: 'UP-VNS-103',
    district: 'Varanasi',
    clientName: 'Varanasi Vikas Bhawan HQ',
    facilityName: 'Smart Governance Server Wing',
    address: 'Orderly Bazar, Cantonment, Varanasi, Uttar Pradesh',
    zone: 'Varanasi District',
    contactPerson: 'District Informatics Officer',
    contactPhone: '+91 94152 44890',
    softwarePackage: 'UP Tender Core v4.2',
    expectedHostnamePrefix: 'UP-VNS-VBH',
    sampleValidHostname: 'UP-VNS-VBH01.UP.GOV.LOCAL',
    slaWindow: 'Tender Phase 1',
    status: 'available',
    milestones: [
      {
        id: 'checkin',
        title: 'Arrival Check-in',
        completed: false,
        description: 'Technician has arrived at site',
      },
      {
        id: 'audit',
        title: 'Device Audit',
        completed: false,
        description: 'Inventory of target devices verified',
      },
      {
        id: 'install',
        title: 'Install Software',
        completed: false,
        description: 'UP Tender software package deployed',
      },
      {
        id: 'hostname_verify',
        title: 'Verify Hostname',
        completed: false,
        description: 'Local server hostname matches tender registry',
      },
      {
        id: 'paperwork',
        title: 'Official Documents',
        completed: false,
        description: 'Signed installation report uploaded',
      },
    ],
    documents: [],
    computerCount: 1,
    hostnameVerifications: [{ verified: false, hostname: '' }],
  },
];

test('filterSitesByDistrict, filterInstallationSites, and filterProvisionedUsers search accurately', () => {
  const lko = filterSitesByDistrict(mockSites, 'Lucknow');
  assert.equal(lko.length, 1);
  assert.equal(lko[0].district, 'Lucknow');

  const vns = filterSitesByDistrict(mockSites, 'Varanasi');
  assert.equal(vns.length, 1);

  const search = filterSitesByDistrict(mockSites, 'all', 'Collectorate');
  assert.equal(search.length, 1);
  assert.equal(search[0].siteCode, 'UP-LKO-101');

  const users: any[] = [
    { username: 'ayush', email: 'ayush@aether.local', role: 'agent' },
    { username: 'admin', email: 'admin@mohan.io', role: 'admin' },
  ];
  const foundUser = filterProvisionedUsers(users, 'ayush');
  assert.equal(foundUser.length, 1);

  const tenderSite = {
    ...mockSites[0],
    zone: 'AGRA ZONE',
    locationKey: 'AGRA|AGRA|EDC AGRA',
    contactPerson: 'Tender Nodal Officer',
    pendingSystems: 4,
  };
  assert.equal(filterSitesByDistrict([tenderSite], 'all', 'EDC AGRA').length, 1);
  assert.equal(filterSitesByDistrict([tenderSite], 'all', 'Tender Nodal Officer').length, 1);
});

test('sortInstallationSites sorts by district, name, or pending workload without mutating source order', () => {
  const sites = [
    { ...mockSites[0], clientName: 'Zeta Office', district: 'Varanasi', pendingSystems: 1 },
    { ...mockSites[1], clientName: 'Alpha Office', district: 'Agra', pendingSystems: 5 },
  ];
  const districtSorted = sortInstallationSites(sites, 'district');
  assert.deepEqual(
    districtSorted.map((site) => site.district),
    ['Agra', 'Varanasi'],
  );
  assert.deepEqual(
    sortInstallationSites(sites, 'name').map((site) => site.clientName),
    ['Alpha Office', 'Zeta Office'],
  );
  assert.deepEqual(
    sortInstallationSites(sites, 'pending').map((site) => site.pendingSystems),
    [5, 1],
  );
  assert.equal(sites[0].clientName, 'Zeta Office');
});

test('canUserClaimSite enforces 1 active installation per user and shows Reserved to other users', () => {
  const user1 = 'ayush';
  const user2 = 'ravi_captain';

  // Initially available
  assert.equal(canUserClaimSite(mockSites, mockSites[0].id, user1).allowed, true);

  // User 1 claims site 0
  const claimedSites = mockSites.map((s, idx) =>
    idx === 0 ? { ...s, status: 'in_progress' as const, reservedByUser: user1 } : s,
  );

  // Site 0 is now reserved to others
  const res = canUserClaimSite(claimedSites, claimedSites[0].id, user2);
  assert.equal(res.allowed, false);
  // Match exact error message from implementation
  assert.match(res.reason || '', /currently reserved by @ayush/);

  // User 1 cannot claim another site while one is in progress
  const res2 = canUserClaimSite(claimedSites, claimedSites[1].id, user1);
  assert.equal(res2.allowed, false);
  assert.match(res2.reason || '', /already have an active installation/);
});

test('releaseExpiredReservations automatically resets incomplete reservations older than 24 hours back to available', () => {
  const staleDate = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  const sites: InstallationSite[] = [
    {
      ...mockSites[0],
      status: 'in_progress',
      reservedByUser: 'ayush',
      startedAt: staleDate,
    },
  ];

  const { sites: updated, expiredCount } = releaseExpiredReservations(sites);
  assert.equal(expiredCount, 1);
  assert.equal(updated[0].status, 'available');
  assert.equal(updated[0].reservedByUser, undefined);
});

test('parseBulkSitesInput parses CSV rows into UP district sites and profiles remain isolated', () => {
  const input = `District,Client Name,Address,Hostname Prefix
Lucknow,Tehsil Sadar,Vibhuti Khand,UP-LKO-TEH
Varanasi,Vikas Bhawan,Orderly Bazar,UP-VNS-VBH`;

  const parsed = parseBulkSitesInput(input, 'Lucknow');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].district, 'Lucknow');
  assert.equal(parsed[0].expectedHostnamePrefix, 'UP-LKO-TEH');
  assert.equal(parsed[1].district, 'Varanasi');
});

test('parseBulkSitesInput correctly parses 18-column DVVNL UP tender CSV format', () => {
  const dvvnlCsv = `District,Discom,Zone,Circle,Division,Sub Division/Other,Sub Station Name,Office Type,Office Address,Number of departmental Desktop/Laptop,Contact Person Name and Designation,Phone Number,Preferred time for Remote Assistant (If any),Remark,Source Workbook,Location Key,Available Systems,Pending system
AGRA,DVVNL,AGRA,NA,NA,OTHER,,ZONE,"CHIEF OFFICE,AGRA ZONE,AGRA GAILANA ROAD,AGRA",21,"ER.DESHRAJ SINGH,JUNIOR ENGINEER",9760103063,-,-,Agra Zone_Final.xlsx,"AGRA|AGRA|NA|NA|OTHER|ZONE|CHIEF OFFICE,AGRA ZONE,AGRA GAILANA ROAD,AGRA",19,2
MATHURA,DVVNL,MATHURA,EUDC,TECH -2 11KV & LT,OTHER,,Division,Masani,2,"Er.Anil PAL (EE 11 KV/LT LINE)",9193303371,10:00 am to 06:00 PM,Desktop,Mathura Zone.xlsx,MATHURA|MATHURA|...,1,1`;

  const parsed = parseBulkSitesInput(dvvnlCsv, 'Agra');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].district, 'AGRA');
  assert.equal(parsed[0].discom, 'DVVNL');
  assert.equal(parsed[0].officeType, 'ZONE');
  assert.equal(parsed[0].address, 'CHIEF OFFICE,AGRA ZONE,AGRA GAILANA ROAD,AGRA');
  assert.equal(parsed[0].contactPerson, 'ER.DESHRAJ SINGH,JUNIOR ENGINEER');
  assert.equal(parsed[0].contactPhone, '9760103063');
  assert.equal(parsed[0].zone, 'AGRA');
  assert.equal(
    parsed[0].locationKey,
    'AGRA|AGRA|NA|NA|OTHER|ZONE|CHIEF OFFICE,AGRA ZONE,AGRA GAILANA ROAD,AGRA',
  );
  assert.equal(parsed[0].sourceWorkbook, 'Agra Zone_Final.xlsx');
  assert.equal(parsed[0].totalSystems, 21);
  assert.equal(parsed[0].availableSystems, 19);
  assert.equal(parsed[0].pendingSystems, 2);
  assert.equal(parsed[0].computerCount, 2); // Pending system = 2
  assert.equal(parsed[1].district, 'MATHURA');
  assert.equal(parsed[1].computerCount, 1); // Pending system = 1
  assert.equal(parsed[1].slaWindow, '10:00 am to 06:00 PM');
  assert.equal(parsed[1].preferredRemoteTime, '10:00 am to 06:00 PM');
});

test('parseBulkSitesInput preserves DVVNL source details and recovers a blank district from its location key', () => {
  const csv =
    '\uFEFF District, Discom, Zone, Circle, Division, Sub Division/Other, Sub Station Name, Office Type, Office Address, Number of departmental Desktop/Laptop, Contact Person Name and Designation, Phone Number, Preferred time for Remote Assistant (If any), Remark, Source Workbook, Location Key, Available Systems, Pending system\n,DVVNL,AGRA,EDC AGRA,EDD SIKANDARA,EDSD II BAAD,,SUBDIVISION,"B-690 KAMLA NAGAR, AGRA",12,"Officer Name, Engineer",9193303502,-,Check desktop count,Agra Zone_Final.xlsx,"AGRA|AGRA|EDC AGRA|EDD SIKANDARA|EDSD II BAAD|SUBDIVISION|B-690 KAMLA NAGAR, AGRA",7,5';
  const [site] = parseBulkSitesInput(csv, 'Lucknow');

  assert.ok(site);
  assert.equal(site.district, 'AGRA');
  assert.equal(site.zone, 'AGRA');
  assert.equal(site.circle, 'EDC AGRA');
  assert.equal(site.division, 'EDD SIKANDARA');
  assert.equal(site.subDivision, 'EDSD II BAAD');
  assert.equal(
    site.locationKey,
    'AGRA|AGRA|EDC AGRA|EDD SIKANDARA|EDSD II BAAD|SUBDIVISION|B-690 KAMLA NAGAR, AGRA',
  );
  assert.equal(site.sourceWorkbook, 'Agra Zone_Final.xlsx');
  assert.equal(site.totalSystems, 12);
  assert.equal(site.availableSystems, 7);
  assert.equal(site.pendingSystems, 5);
  assert.equal(site.computerCount, 5);
  assert.equal(site.preferredRemoteTime, '-');
  assert.equal(site.remark, 'Check desktop count');
});

test('getInstallationPhaseStepper accurately tracks Selected, In Progress, and Completed phases', () => {
  const site: InstallationSite = { ...mockSites[0] };
  const stepper = getInstallationPhaseStepper(site);
  assert.equal(stepper.currentPhase, 'Selected');

  site.status = 'in_progress';
  // If no milestones completed, it still shows Selected because subStepsCompleted is 0
  const stepper2 = getInstallationPhaseStepper(site);
  assert.equal(stepper2.currentPhase, 'Selected');

  // Complete one sub-step
  site.milestones = site.milestones.map((m) =>
    m.id === 'install' ? { ...m, completed: true } : m,
  );
  const stepper3 = getInstallationPhaseStepper(site);
  assert.equal(stepper3.currentPhase, 'In Progress');

  site.status = 'completed';
  const stepper4 = getInstallationPhaseStepper(site);
  assert.equal(stepper4.currentPhase, 'Completed');

  const exceptionSite = {
    ...mockSites[0],
    status: 'in_progress' as const,
    computerCount: 2,
    milestones: mockSites[0].milestones.map((milestone) => ({
      ...milestone,
      completed: false,
    })),
    hostnameVerifications: [
      { verified: true, hostname: 'OFFICE-PC-01' },
      { verified: true, hostname: 'EXCUSED-02', exceptionReason: 'pc_unavailable' as const },
    ],
    hostnameVerification: { verified: true, hostname: 'OFFICE-PC-01' },
    documents: [],
  };
  const exceptionStepper = getInstallationPhaseStepper(exceptionSite);
  assert.equal(exceptionStepper.subStepsCompleted, 1);
});

test('paginateActivityLogs filters login events vs status changes and paginates accurately', () => {
  const sampleLogs: ActivityLogEntry[] = [
    {
      id: '1',
      eventType: 'login',
      actorUsername: 'ayush',
      createdAt: '2026-11-08T10:00:00Z',
      description: 'Login',
    },
    {
      id: '2',
      eventType: 'status_change',
      actorUsername: 'ayush',
      createdAt: '2026-11-08T10:05:00Z',
      description: 'Reserved',
      siteCode: 'UP-LKO-101',
    },
    {
      id: '3',
      eventType: 'status_change',
      actorUsername: 'admin',
      createdAt: '2026-11-08T10:10:00Z',
      description: 'Assigned',
      siteCode: 'UP-VNS-103',
    },
  ];

  const all = paginateActivityLogs(sampleLogs, { page: 1, pageSize: 2 });
  assert.equal(all.items.length, 2);
  assert.equal(all.totalItems, 3);
  assert.equal(all.totalPages, 2);

  // Filter by login events only
  const loginOnly = paginateActivityLogs(sampleLogs, {
    page: 1,
    pageSize: 5,
    eventFilter: 'login',
  });
  assert.equal(loginOnly.totalItems, 1);
  assert.equal(loginOnly.items[0].eventType, 'login');

  // Filter by status_change events only
  const statusOnly = paginateActivityLogs(sampleLogs, {
    page: 1,
    pageSize: 5,
    eventFilter: 'status_change',
  });
  assert.equal(statusOnly.totalItems, 2);
});

test('updateSiteDetails, adminAssignSiteToAgent, and generateSitesCsvReport handle Admin site operations', async () => {
  const { updateSiteDetails, adminAssignSiteToAgent, generateSitesCsvReport } =
    await import('./deployment-logic');

  const baseSites = mockSites.map((s) => ({ ...s }));
  const targetId = baseSites[0].id;

  // 1. Edit existing site details inline
  const editRes = updateSiteDetails(baseSites, targetId, {
    clientName: 'Lucknow Smart Collectorate Wing B',
    district: 'Lucknow',
    address: 'Hazratganj Block 4, Lucknow',
    expectedHostnamePrefix: 'UP-LKO-SWB',
  });

  assert.equal(editRes.isValid, true);
  assert.equal(editRes.updatedSite?.clientName, 'Lucknow Smart Collectorate Wing B');
  assert.equal(editRes.updatedSite?.expectedHostnamePrefix, 'UP-LKO-SWB');
  assert.equal(editRes.updatedSite?.sampleValidHostname, 'UP-LKO-SWB01.UP.GOV.LOCAL');

  // 2. Manual assignment and reassignment
  const assignRes = adminAssignSiteToAgent(
    editRes.sites,
    targetId,
    'ravi_captain',
    '2026-11-08T10:00:00.000Z',
  );
  assert.equal(assignRes.success, true);
  assert.equal(assignRes.updatedSite?.status, 'in_progress');
  assert.equal(assignRes.updatedSite?.reservedByUser, 'ravi_captain');

  // Reassign to another agent
  const reassignRes = adminAssignSiteToAgent(
    assignRes.sites,
    targetId,
    'ayush',
    '2026-11-08T11:00:00.000Z',
  );
  assert.equal(reassignRes.updatedSite?.reservedByUser, 'ayush');

  // 3. CSV Export
  const csv = generateSitesCsvReport(reassignRes.sites);
  assert.match(csv, /Lucknow Smart Collectorate/);
  assert.match(csv, /ayush/);
});

test('getUserInstallationSummary and resolveUserRecordByIdentifier compute per-user installation counts and details accurately', () => {
  const user: any = {
    id: 'u1',
    username: 'ayush',
    email: 'ayush@aether.local',
    role: 'agent',
    createdAt: '2026-11-08',
    syncedToSupabase: true,
  };
  const sites: InstallationSite[] = [
    { ...mockSites[0], status: 'completed', completedByUser: 'ayush' },
    { ...mockSites[1], status: 'in_progress', reservedByUser: 'ayush' },
  ];

  const summary = getUserInstallationSummary(user, sites);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.inProgressCount, 1);
  // Districts in summary are sorted alphabetically
  assert.deepStrictEqual(summary.districtsCovered.sort(), ['Lucknow', 'Varanasi']);

  // Identifier resolution
  const res1 = resolveUserRecordByIdentifier('ayush', [user]);
  assert.equal(res1?.id, 'u1');

  const res2 = resolveUserRecordByIdentifier('ayush@aether.local', [user]);
  assert.equal(res2?.username, 'ayush');
});

test('getDistrictProgressBreakdown, getStaleReservations, and releaseStaleReservations track UP district progress and stale reservations', () => {
  const sites: InstallationSite[] = [
    { ...mockSites[0], district: 'Lucknow', status: 'completed' },
    { ...mockSites[0], id: 's2', district: 'Lucknow', status: 'available' },
    {
      ...mockSites[1],
      district: 'Varanasi',
      status: 'in_progress',
      startedAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
    },
  ];

  const breakdown = getDistrictProgressBreakdown(sites);
  const lko = breakdown.find((b) => b.district === 'Lucknow');
  assert.equal(lko?.completedSites, 1);
  assert.equal(lko?.totalSites, 2);

  const stale = getStaleReservations(sites);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].site.district, 'Varanasi');

  const { sites: released } = releaseStaleReservations(sites);
  assert.equal(released.find((s) => s.district === 'Varanasi')?.status, 'available');
});

test('resolveUserSequentialSerialNo and getNextSequentialSerialNo enforce sequential series 1001, 1002, 1003...', () => {
  // Baseline resolution (with empty KNOWN_USER_SERIAL_MAP)
  const s1 = resolveUserSequentialSerialNo('ayush');
  assert.match(s1, /^SN-UP-\d{4,}$/);

  // Next in series
  const existing = [{ serialNo: 'SN-UP-1010' }, { serialNo: 'SN-UP-1005' }];
  const next = getNextSequentialSerialNo(existing);
  assert.equal(next, 'SN-UP-1011');

  // Explicit preserve
  const s2 = resolveUserSequentialSerialNo('ravi', 'SN-UP-5566');
  assert.equal(s2, 'SN-UP-5566');
});

test('paginateActivityLogs filters attendance events and generateAttendanceCsvReport exports daily biometric attendance CSV', async () => {
  const { paginateActivityLogs, generateAttendanceCsvReport } = await import('./deployment-logic');

  const logs = [
    {
      id: 'att-1',
      eventType: 'attendance' as const,
      actorUsername: 'shivam',
      actorFullName: 'Shivam Kumar',
      serialNo: 'SN-UP-1001',
      verificationId: 'BIO-NEURAL-1762700000-ABCD',
      matchScore: 96.4,
      newStatus: 'on_duty',
      description: 'Biometric Facial Check-In Verified (96.4% Match) — @shivam is now On Duty',
      createdAt: '2026-11-09T09:15:22.000Z',
    },
    {
      id: 'log-1',
      eventType: 'login' as const,
      actorUsername: 'shivam',
      description: 'User @shivam logged in',
      createdAt: '2026-11-09T09:14:00.000Z',
    },
  ];

  const attendanceOnly = paginateActivityLogs(logs, { eventFilter: 'attendance' });
  assert.equal(attendanceOnly.totalItems, 1);
  assert.equal(attendanceOnly.items[0].verificationId, 'BIO-NEURAL-1762700000-ABCD');

  const byVerifId = paginateActivityLogs(logs, {
    eventFilter: 'all',
    searchQuery: 'BIO-NEURAL-1762700000',
  });
  assert.equal(byVerifId.totalItems, 1);

  const csv = generateAttendanceCsvReport(logs, [
    {
      username: 'shivam',
      fullName: 'Shivam Kumar',
      serialNo: 'SN-UP-1001',
      onDuty: true,
      lastVerifiedAt: '2026-11-09T09:15:22.000Z',
      lastVerificationId: 'BIO-NEURAL-1762700000-ABCD',
      lastMatchScore: 96.4,
    },
  ]);

  assert.match(
    csv,
    /Serial No,Technician Name,Username,Duty Status,Check-In Timestamp,Match Score \(%\),Verification ID,Description/,
  );
  assert.match(csv, /SN-UP-1001/);
  assert.match(csv, /Shivam Kumar/);
  assert.match(csv, /@shivam/);
  assert.match(csv, /96\.4%/);
  assert.match(csv, /BIO-NEURAL-1762700000-ABCD/);
});

test('biometricArrivalVerification is preserved across site updates and cleared when site resets to available', async () => {
  const { validateServerSideSiteUpdate } = await import('./security-validation');

  const claimedSite: InstallationSite = {
    ...mockSites[0],
    status: 'in_progress',
    reservedByUser: 'shivam',
    startedAt: new Date().toISOString(),
    biometricArrivalVerification: {
      verified: true,
      verifiedByUser: 'shivam',
      verifiedByName: 'Shivam Kumar',
      verificationId: 'BIO-NEURAL-1762700500-SITE',
      matchScore: 95.8,
      verifiedAt: '2026-11-09T09:30:00.000Z',
    },
  };

  // Preserved when updating milestones or completing site
  const valRes = validateServerSideSiteUpdate(
    claimedSite,
    {
      ...claimedSite,
      notes: 'Server rack mounted',
    },
    {
      userId: 'u-shivam',
      email: 'shivam@aether.local',
      userKey: 'shivam',
      role: 'agent',
    },
  );
  assert.equal(valRes.isValid, true);
  assert.equal(valRes.sanitizedSite?.biometricArrivalVerification?.verified, true);
  assert.equal(valRes.sanitizedSite?.biometricArrivalVerification?.verifiedByUser, 'shivam');
  assert.equal(
    valRes.sanitizedSite?.biometricArrivalVerification?.verificationId,
    'BIO-NEURAL-1762700500-SITE',
  );

  // Cleared when reservation expires after 24h
  const expiredSite: InstallationSite = {
    ...claimedSite,
    startedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
  };
  const { sites: afterExpiry } = releaseExpiredReservations([expiredSite]);
  assert.equal(afterExpiry[0].status, 'available');
  assert.equal(afterExpiry[0].biometricArrivalVerification, undefined);

  // Cleared when admin unassigns site
  const unassignRes = adminAssignSiteToAgent([claimedSite], claimedSite.id, null);
  assert.equal(unassignRes.updatedSite?.status, 'available');
  assert.equal(unassignRes.updatedSite?.biometricArrivalVerification, undefined);
});

test('biometricCompletionSeal is validated on site completion and exported in generateSitesCsvReport', async () => {
  const { validateServerSideSiteUpdate } = await import('./security-validation');

  const inProgressSite: InstallationSite = {
    ...mockSites[0],
    status: 'in_progress',
    reservedByUser: 'shivam',
    startedAt: '2026-11-09T09:30:00.000Z',
    hostnameVerifications: [{ verified: true, hostname: 'UP-LKO-NIC01.UP.GOV.LOCAL' }],
    hostnameVerification: {
      verified: true,
      hostname: 'UP-LKO-NIC01.UP.GOV.LOCAL',
      resolvedIp: '10.142.20.15',
      approvalCode: 'APR-UP-LKO-101',
      verifiedAt: '2026-11-09T10:15:00.000Z',
    },
    documents: [
      {
        id: 'doc-1',
        name: 'UP-LKO-101-SignOff.pdf',
        docType: 'Sign-Off Certificate',
        sizeBytes: 204800,
        uploadedAt: '10:20 AM',
        checksum: 'Verified',
      },
    ],
    milestones: mockSites[0].milestones.map((m) => ({ ...m, completed: true })),
  };

  const completedRes = validateServerSideSiteUpdate(
    inProgressSite,
    {
      ...inProgressSite,
      status: 'completed',
      biometricCompletionSeal: {
        verified: true,
        verifiedByUser: 'shivam',
        verifiedByName: 'Shivam Kumar',
        verificationId: 'BIO-NEURAL-1762705000-SEAL',
        matchScore: 97.2,
        verifiedAt: '2026-11-09T10:25:00.000Z',
      },
    },
    {
      userId: 'u-shivam',
      email: 'shivam@aether.local',
      userKey: 'shivam',
      role: 'agent',
    },
  );

  assert.equal(completedRes.isValid, true);
  assert.equal(completedRes.sanitizedSite?.status, 'completed');
  assert.equal(completedRes.sanitizedSite?.biometricCompletionSeal?.verified, true);
  assert.equal(
    completedRes.sanitizedSite?.biometricCompletionSeal?.verificationId,
    'BIO-NEURAL-1762705000-SEAL',
  );
  assert.equal(completedRes.sanitizedSite?.completedAt, '2026-11-09T10:25:00.000Z');

  const csv = generateSitesCsvReport([completedRes.sanitizedSite!]);
  assert.match(
    csv,
    /Sr No,Reporting Date,Vendor Name,Engineer Name,Discom,Zone,Address,Username,Hostname,UEM,EDR,Remarks/,
  );
  assert.match(csv, /BIO-NEURAL-1762705000-SEAL/);
  assert.match(csv, /2026-11-09/);
  assert.match(csv, /97\.2%/);
});

test('site completion ignores legacy distance data and does not persist location-based verification fields', async () => {
  const { validateServerSideSiteUpdate } = await import('./security-validation');
  const inProgressSite: InstallationSite = {
    ...mockSites[0],
    status: 'in_progress',
    reservedByUser: 'shivam',
    latitude: 26.8467,
    longitude: 80.9462,
    startedAt: '2026-11-09T09:30:00.000Z',
    hostnameVerifications: [{ verified: true, hostname: 'UP-LKO-NIC01.UP.GOV.LOCAL' }],
    documents: [
      {
        id: 'doc-1',
        name: 'UP-LKO-101-SignOff.pdf',
        docType: 'Sign-Off Certificate',
        sizeBytes: 204800,
        uploadedAt: '10:20 AM',
        checksum: 'Verified',
      },
    ],
    milestones: mockSites[0].milestones.map((m) => ({ ...m, completed: true })),
  };
  // Legacy clients may still send these fields. They must not block or taint work.
  const legacySeal = {
    verified: true,
    verifiedByUser: 'shivam',
    verifiedByName: 'Shivam Kumar',
    verificationId: 'BIO-NEURAL-1762705000-SEAL',
    matchScore: 97.2,
    verifiedAt: '2026-11-09T10:25:00.000Z',
    distanceMeters: 84000.3,
    geofenceVerified: false,
  };
  const result = validateServerSideSiteUpdate(
    inProgressSite,
    { ...inProgressSite, status: 'completed', biometricCompletionSeal: legacySeal },
    { userId: 'u-shivam', email: 'shivam@aether.local', userKey: 'shivam', role: 'agent' },
  );
  assert.equal(result.isValid, true);
  assert.equal(result.sanitizedSite?.status, 'completed');
  assert.equal(result.sanitizedSite?.biometricCompletionSeal?.verified, true);
  assert.equal(result.sanitizedSite?.latitude, 26.8467);
  assert.equal(result.sanitizedSite?.longitude, 80.9462);
  const seal = result.sanitizedSite!.biometricCompletionSeal!;
  assert.equal('distanceMeters' in seal, false);
  assert.equal('geofenceVerified' in seal, false);
  assert.equal('coordinatesLocked' in result.sanitizedSite!, false);
});

test('calculateSiteTransitGaps groups by IST calendar date to exclude overnight gaps and supports Morning On-Duty Check-In commute', async () => {
  const { calculateSiteTransitGaps } = await import('./deployment-logic');

  const multiDaySites: InstallationSite[] = [
    {
      ...mockSites[0],
      id: 'site-day1-1',
      siteCode: 'UP-LKO-101',
      clientName: 'Day 1 Site A',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-10T04:30:00.000Z', // 10:00 AM IST on Nov 10
      completedAt: '2026-11-10T05:30:00.000Z', // 11:00 AM IST on Nov 10
    },
    {
      ...mockSites[0],
      id: 'site-day1-2',
      siteCode: 'UP-LKO-102',
      clientName: 'Day 1 Site B',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-10T06:00:00.000Z', // 11:30 AM IST on Nov 10 (30m travel from Site A)
      completedAt: '2026-11-10T07:00:00.000Z', // 12:30 PM IST on Nov 10
    },
    {
      ...mockSites[0],
      id: 'site-day2-1',
      siteCode: 'UP-LKO-201',
      clientName: 'Day 2 Site C (Next Morning)',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-11T04:00:00.000Z', // 09:30 AM IST on Nov 11 (Overnight gap must NOT be counted!)
      completedAt: '2026-11-11T05:00:00.000Z', // 10:30 AM IST on Nov 11
    },
    {
      ...mockSites[0],
      id: 'site-day2-2',
      siteCode: 'UP-LKO-202',
      clientName: 'Day 2 Site D',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-11T05:45:00.000Z', // 11:15 AM IST on Nov 11 (45m travel from Site C)
      completedAt: '2026-11-11T06:30:00.000Z', // 12:00 PM IST on Nov 11
    },
  ];

  // 1. Without Morning Check-In: Overnight gap between Day 1 Site B and Day 2 Site C is excluded
  const resWithoutCheckIn = calculateSiteTransitGaps(multiDaySites, 'rahul');
  assert.equal(resWithoutCheckIn.transitGaps.length, 2); // Only Day1(A->B) and Day2(C->D)
  const day2FirstSite = resWithoutCheckIn.sitesWithTransit.find((s) => s.id === 'site-day2-1');
  assert.equal(day2FirstSite?.isFirstSiteOfDay, true);
  assert.equal(day2FirstSite?.transitFromPrevious, undefined);

  // Total travel is 30m + 45m = 75m (never includes 21h overnight gap)
  assert.equal(resWithoutCheckIn.totalTransitMs, (30 + 45) * 60 * 1000);

  // 2. With Morning On-Duty Check-In on Day 2 at 09:00 AM IST (03:30 UTC) -> 30m commute to Day 2 Site C
  const resWithMorningCheckIn = calculateSiteTransitGaps(multiDaySites, 'rahul', {
    morningCheckInsByTech: {
      rahul: {
        verifiedAt: '2026-11-11T03:30:00.000Z', // 09:00 AM IST on Nov 11
        latitude: 26.8467,
        longitude: 80.9462,
      },
    },
  });
  assert.equal(resWithMorningCheckIn.transitGaps.length, 3); // Day1(A->B) + Day2(MorningCheckIn->C) + Day2(C->D)
  const day2FirstWithCommute = resWithMorningCheckIn.sitesWithTransit.find(
    (s) => s.id === 'site-day2-1',
  );
  assert.equal(day2FirstWithCommute?.isFirstSiteOfDay, true);
  assert.equal(day2FirstWithCommute?.transitFromPrevious?.isMorningCheckInTransit, true);
  assert.equal(
    day2FirstWithCommute?.transitFromPrevious?.previousClientName,
    'Morning On-Duty Check-In',
  );
  assert.equal(day2FirstWithCommute?.transitFromPrevious?.transitDurationMs, 30 * 60 * 1000);
});

test('filterSitesByIstDateRange and summarizeTransitForFilteredSites filter by single date or date range and recalculate travel totals', async () => {
  const { calculateSiteTransitGaps, filterSitesByIstDateRange, summarizeTransitForFilteredSites } =
    await import('./deployment-logic');

  const multiDaySites: InstallationSite[] = [
    {
      ...mockSites[0],
      id: 'site-d1-a',
      siteCode: 'UP-LKO-101',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-09T04:00:00.000Z',
      completedAt: '2026-11-09T05:00:00.000Z', // 2026-11-09 IST
    },
    {
      ...mockSites[0],
      id: 'site-d2-a',
      siteCode: 'UP-LKO-102',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-10T04:00:00.000Z',
      completedAt: '2026-11-10T05:00:00.000Z', // 2026-11-10 IST
    },
    {
      ...mockSites[0],
      id: 'site-d2-b',
      siteCode: 'UP-LKO-103',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-10T05:25:00.000Z', // 25m travel on 2026-11-10
      completedAt: '2026-11-10T06:00:00.000Z', // 2026-11-10 IST
    },
    {
      ...mockSites[0],
      id: 'site-d3-a',
      siteCode: 'UP-LKO-104',
      status: 'completed',
      completedByUser: 'rahul',
      startedAt: '2026-11-11T04:00:00.000Z',
      completedAt: '2026-11-11T05:00:00.000Z', // 2026-11-11 IST
    },
  ];

  const { sitesWithTransit } = calculateSiteTransitGaps(multiDaySites, 'rahul');

  // Single Date: 2026-11-10 -> 2 sites, 25m total travel
  const nov10Only = filterSitesByIstDateRange(sitesWithTransit, 'single', '2026-11-10');
  assert.equal(nov10Only.length, 2);
  const nov10Stats = summarizeTransitForFilteredSites(nov10Only);
  assert.equal(nov10Stats.count, 2);
  assert.equal(nov10Stats.totalTransitMs, 25 * 60 * 1000);
  assert.equal(nov10Stats.averageTransitMs, 25 * 60 * 1000);

  // Date Range: 2026-11-10 to 2026-11-11 -> 3 sites
  const rangeSites = filterSitesByIstDateRange(
    sitesWithTransit,
    'range',
    '',
    '2026-11-10',
    '2026-11-11',
  );
  assert.equal(rangeSites.length, 3);

  // Reversed Date Range auto-normalizes
  const reversedRange = filterSitesByIstDateRange(
    sitesWithTransit,
    'range',
    '',
    '2026-11-10',
    '2026-11-09',
  );
  assert.equal(reversedRange.length, 3);
});

test('verifyHostnameWithServerRegistry supports any non-predetermined hostname and prevents duplicate hostnames across computers and sites', async () => {
  const { verifyHostnameWithServerRegistry, findDuplicateHostname } =
    await import('./deployment-logic');

  const existingSites: InstallationSite[] = [
    {
      ...mockSites[0],
      id: 'site-a',
      siteCode: 'UP-LKO-101',
      clientName: 'Lucknow Center',
      computerCount: 2,
      hostnameVerifications: [
        { verified: true, hostname: 'OFFICE-MAIN-PC01' },
        { verified: false, hostname: '' },
      ],
    },
    {
      ...mockSites[1],
      id: 'site-b',
      siteCode: 'UP-VNS-103',
      clientName: 'Varanasi Hub',
      computerCount: 1,
      hostnameVerifications: [{ verified: true, hostname: 'VARANASI-SERVER-NODE' }],
    },
  ];

  // 1. Hostnames are NOT predetermined and can be any custom name
  const arbitraryResult = verifyHostnameWithServerRegistry(
    'ANY-CUSTOM-HOSTNAME-123',
    existingSites[0],
    existingSites,
    'site-a',
    1,
  );
  assert.equal(arbitraryResult.verified, true);
  assert.equal(arbitraryResult.hostname, 'ANY-CUSTOM-HOSTNAME-123');
  assert.ok(arbitraryResult.resolvedIp);
  assert.ok(arbitraryResult.approvalCode);

  // 2. Reject duplicate hostname across different sites
  const dupCrossSiteResult = verifyHostnameWithServerRegistry(
    'VARANASI-SERVER-NODE', // already used on site-b
    existingSites[0],
    existingSites,
    'site-a',
    1,
  );
  assert.equal(dupCrossSiteResult.verified, false);
  assert.match(
    dupCrossSiteResult.error || '',
    /Duplicate Hostname.*already registered on site UP-VNS-103/,
  );

  // 3. Reject duplicate hostname within the same site (Computer #2 trying to use Computer #1's hostname)
  const dupSameSiteResult = verifyHostnameWithServerRegistry(
    'office-main-pc01', // case-insensitive match with Computer #1
    existingSites[0],
    existingSites,
    'site-a',
    1,
  );
  assert.equal(dupSameSiteResult.verified, false);
  assert.match(
    dupSameSiteResult.error || '',
    /Duplicate Hostname.*already assigned to Computer #1 at this site/,
  );

  // 4. Re-submitting the exact same slot's own hostname is allowed (self-update)
  const selfUpdateResult = verifyHostnameWithServerRegistry(
    'OFFICE-MAIN-PC01',
    existingSites[0],
    existingSites,
    'site-a',
    0,
  );
  assert.equal(selfUpdateResult.verified, true);

  // 5. Direct findDuplicateHostname helper checks
  const dupCheck1 = findDuplicateHostname('OFFICE-MAIN-PC01', existingSites, 'site-a', 1);
  assert.equal(dupCheck1.isDuplicate, true);
  assert.equal(dupCheck1.conflictSiteCode, 'UP-LKO-101');
  assert.equal(dupCheck1.conflictComputerSlot, 1);

  const dupCheck2 = findDuplicateHostname('NEW-UNIQUE-PC', existingSites);
  assert.equal(dupCheck2.isDuplicate, false);
});

test('getGoogleMapsNavigationUrl generates intelligent turn-by-turn navigation URLs with exact coordinates and district fallbacks', () => {
  // 1. Site with exact GPS coordinates
  const siteWithCoords = {
    latitude: 26.846712,
    longitude: 80.946234,
    district: 'Lucknow',
    facilityName: 'Collectorate Record Room',
    clientName: 'Lucknow Collectorate',
  };
  const navUrlExact = getGoogleMapsNavigationUrl(siteWithCoords);
  assert.equal(
    navUrlExact,
    'https://www.google.com/maps/dir/?api=1&destination=26.846712%2C80.946234&travelmode=driving',
  );

  // 2. Site with two-wheeler travel mode
  const bikeNavUrl = getGoogleMapsNavigationUrl(siteWithCoords, 'two_wheeler');
  assert.equal(
    bikeNavUrl,
    'https://www.google.com/maps/dir/?api=1&destination=26.846712%2C80.946234&travelmode=two_wheeler',
  );

  // 3. Site with missing or null coordinates falls back to District HQ coordinates (e.g. Varanasi: 25.3176, 82.9739)
  const siteWithoutCoords = {
    latitude: null,
    longitude: null,
    district: 'Varanasi',
    clientName: 'Varanasi Vikas Bhawan HQ',
  };
  const navUrlFallback = getGoogleMapsNavigationUrl(siteWithoutCoords);
  assert.match(navUrlFallback, /destination=25\.317600%2C82\.973900/);
  assert.match(navUrlFallback, /travelmode=driving/);

  // 4. Site with 0, 0 dummy coordinates falls back intelligently
  const siteWithZeroCoords = {
    latitude: 0,
    longitude: 0,
    district: 'Agra',
    clientName: 'Agra Tehsil Office',
  };
  const navUrlZeroFallback = getGoogleMapsNavigationUrl(siteWithZeroCoords);
  assert.match(navUrlZeroFallback, /destination=27\.176700%2C78\.008100/);

  // 5. Place search URL test
  const searchUrlExact = getGoogleMapsSearchUrl(siteWithCoords);
  assert.equal(
    searchUrlExact,
    'https://www.google.com/maps/search/?api=1&query=26.846712,80.946234',
  );

  const searchUrlText = getGoogleMapsSearchUrl({
    clientName: 'Ayodhya Smart Governance',
    district: 'Ayodhya',
  });
  assert.match(searchUrlText, /query=Ayodhya%20Smart%20Governance.*Ayodhya/);
});

test('SystemDocumentRecord supports default and custom SOP and Permission Letter types', () => {
  const sopTypes: SystemDocumentType[] = ['sop', 'permission_letter'];
  assert.equal(sopTypes.length, 2);

  const defaultSopDoc: SystemDocumentRecord = {
    id: 'sop',
    name: 'Standard_Operating_Procedure_UP_Tender_Deployment.pdf',
    sizeBytes: 154200,
    uploadedAt: new Date().toISOString(),
    mimeType: 'application/pdf',
    url: '/assets/Standard_Operating_Procedure_UP_Tender_Deployment.pdf',
    isCustom: false,
  };
  assert.equal(defaultSopDoc.id, 'sop');
  assert.equal(defaultSopDoc.isCustom, false);

  const customPermissionLetter: SystemDocumentRecord = {
    id: 'permission_letter',
    name: 'Official_Govt_Entry_Authorization_Pass_2026.pdf',
    sizeBytes: 245000,
    uploadedAt: new Date().toISOString(),
    uploadedBy: 'admin',
    mimeType: 'application/pdf',
    url: '/assets/uploads/custom_permission_letter_123.pdf',
    isCustom: true,
  };
  assert.equal(customPermissionLetter.id, 'permission_letter');
  assert.equal(customPermissionLetter.isCustom, true);
  assert.equal(customPermissionLetter.uploadedBy, 'admin');
});

test('checkTabAccess and checkAnyTabAccess enforce strict granular tab permissions', async () => {
  const { checkTabAccess, checkAnyTabAccess } = await import('./security-validation.ts');

  const superAdminAuth = {
    userId: 'usr-admin-1',
    userKey: 'piyush',
    email: 'piyush@aether.local',
    role: 'admin' as const,
  };

  const subAdminAuth = {
    userId: 'usr-subadmin-1',
    userKey: 'site_lead',
    email: 'site_lead@aether.local',
    role: 'sub_admin' as const,
    allowedTabs: ['users', 'analytics'] as any[],
  };

  const fieldAgentAuth = {
    userId: 'usr-agent-1',
    userKey: 'rahul',
    email: 'rahul@aether.local',
    role: 'agent' as const,
  };

  // 1. Super Admin has access to all tabs
  assert.equal(checkTabAccess(superAdminAuth, 'sites').allowed, true);
  assert.equal(checkTabAccess(superAdminAuth, 'add_user').allowed, true);
  assert.equal(checkTabAccess(superAdminAuth, 'documents').allowed, true);

  // 2. Sub-Admin access: strictly allowed ONLY for explicitly permitted tabs
  assert.equal(checkTabAccess(subAdminAuth, 'analytics').allowed, true);
  assert.equal(checkTabAccess(subAdminAuth, 'users').allowed, true);

  // CRITICAL SECURITY FIX: 'analytics' must NOT grant write/tab access to 'sites'
  const blockedSitesWrite = checkTabAccess(subAdminAuth, 'sites');
  assert.equal(blockedSitesWrite.allowed, false);
  assert.equal(blockedSitesWrite.statusCode, 403);

  // Shared read-only telemetry check succeeds for ['sites', 'analytics']
  assert.equal(checkAnyTabAccess(subAdminAuth, ['sites', 'analytics']).allowed, true);

  // Unauthorized tabs are blocked with 403 Forbidden
  const blockedAddUser = checkTabAccess(subAdminAuth, 'add_user');
  assert.equal(blockedAddUser.allowed, false);
  assert.equal(blockedAddUser.statusCode, 403);

  const blockedDocs = checkTabAccess(subAdminAuth, 'documents');
  assert.equal(blockedDocs.allowed, false);
  assert.equal(blockedDocs.statusCode, 403);

  // 3. Field Agent is denied access to all admin tabs
  const blockedAgent = checkTabAccess(fieldAgentAuth, 'sites');
  assert.equal(blockedAgent.allowed, false);
  assert.equal(blockedAgent.statusCode, 403);
});

test('RAM-based software guidance follows the SOP threshold and handles missing values', () => {
  assert.equal(getComputerSoftwarePlan(undefined), 'RAM not recorded');
  assert.equal(getComputerSoftwarePlan(0), 'RAM not recorded');
  assert.equal(getComputerSoftwarePlan(4), 'UEM only');
  assert.equal(getComputerSoftwarePlan(3.5), 'UEM only');
  assert.equal(getComputerSoftwarePlan(4.1), 'BigFix + Trend Micro');
  assert.equal(getComputerSoftwarePlan(8), 'BigFix + Trend Micro');
});

test('bulk uploads merge into the registry and never delete rows the file omits', () => {
  const site = (overrides: Partial<InstallationSite>): InstallationSite => ({
    id: 'fixture',
    siteCode: 'UP-FIX-100',
    clientName: 'Fixture',
    facilityName: 'Fixture',
    district: 'Agra',
    zone: 'Agra',
    address: 'Agra',
    contactPerson: '',
    contactPhone: '',
    softwarePackage: '',
    expectedHostnamePrefix: 'UP',
    sampleValidHostname: 'UP01',
    slaWindow: '24h',
    status: 'available',
    computerCount: 1,
    milestones: createDefaultMilestones(),
    hostnameVerifications: [],
    documents: [],
    ...overrides,
  });

  const live = site({
    id: 'live-1',
    siteCode: 'UP-AGR-101',
    clientName: 'Agra Office',
    status: 'in_progress',
    reservedByUser: 'ravi_captain',
    startedAt: '2026-01-01T00:00:00Z',
    documents: [
      {
        id: 'certificate',
        name: 'signed.pdf',
        docType: 'Sign-Off Certificate',
        sizeBytes: 10,
        uploadedAt: '2026-01-01T00:00:00Z',
        checksum: 'abc',
        storagePath: 'live-1/certificate',
      },
    ],
  });
  const untouched = site({ id: 'live-2', siteCode: 'UP-LKO-101', clientName: 'Lucknow Office' });

  const upload = [
    // Same site code, new contact details: identity, status and evidence must survive.
    site({
      id: 'incoming-a',
      siteCode: 'UP-AGR-101',
      clientName: 'Agra Office',
      contactPerson: 'New Contact',
      computerCount: 4,
    }),
    site({ id: 'incoming-b', siteCode: 'UP-VNS-901', clientName: 'Varanasi Office' }),
  ];

  const merged = mergeUploadedSites([live, untouched], upload);
  assert.deepEqual(
    merged.map((s) => s.siteCode).sort(),
    ['UP-AGR-101', 'UP-LKO-101', 'UP-VNS-901'],
    'sites the upload omits are kept',
  );
  const updated = merged.find((s) => s.siteCode === 'UP-AGR-101')!;
  assert.equal(updated.id, 'live-1', 'the live row keeps its database id');
  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.reservedByUser, 'ravi_captain');
  assert.equal(updated.contactPerson, 'New Contact');
  assert.equal(updated.computerCount, 4);
  assert.equal(updated.documents[0].storagePath, 'live-1/certificate');
  assert.equal(merged.find((s) => s.siteCode === 'UP-LKO-101')!.id, 'live-2');
  assert.equal(merged.find((s) => s.siteCode === 'UP-VNS-901')!.id, 'incoming-b');
});
