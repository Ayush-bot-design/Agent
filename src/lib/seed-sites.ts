import {
  createDefaultMilestones,
  generateSiteUuid,
  getDefaultCoordinatesForDistrict,
  type HostnameVerificationResult,
  type InstallationSite,
  type SiteStatus,
  type UploadedDocument,
} from '../utils/deployment-logic';

/**
 * Seeded demo worklist.
 *
 * The repository shipped without the database dump, so the console runs on a
 * deterministic local sample of Uttar Pradesh distribution offices. Every field
 * maps 1:1 onto a column of `public.sites` in the Supabase project, so the same
 * screens can be pointed at a real backend later without changing the domain
 * logic in `src/utils`.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface SeedDefinition {
  siteCode: string;
  district: string;
  clientName: string;
  facilityName: string;
  officeType: string;
  contactPerson: string;
  contactPhone: string;
  computerCount: number;
  status: SiteStatus;
  /** Which agent owns the seeded reservation / completion. */
  owner?: 'ravi' | 'neha' | 'sameer';
  startedHoursAgo?: number;
  completedDaysAgo?: number;
  milestonesDone?: number;
  note?: string;
}

const AGENTS = {
  ravi: { userKey: 'ravi', fullName: 'Ravi Pratap Singh', serialNo: 'SN-UP-1002' },
  neha: { userKey: 'neha', fullName: 'Neha Verma', serialNo: 'SN-UP-1003' },
  sameer: { userKey: 'sameer', fullName: 'Sameer Khan', serialNo: 'SN-UP-1004' },
} as const;

const SEED_SITES: SeedDefinition[] = [
  {
    siteCode: 'UP-LKO-1042',
    district: 'Lucknow',
    clientName: '33/11 KV Sub Station, Gomti Nagar',
    facilityName: 'Sub Station — Gomti Nagar Sector 4',
    officeType: 'Sub Station',
    contactPerson: 'Er. Anil Kumar',
    contactPhone: '+91 94150 22104',
    computerCount: 3,
    status: 'available',
  },
  {
    siteCode: 'UP-LKO-1043',
    district: 'Lucknow',
    clientName: 'Sub Division Office, Alambagh',
    facilityName: 'Sub Division — Alambagh',
    officeType: 'Sub Division',
    contactPerson: 'Er. Sunita Mishra',
    contactPhone: '+91 94150 22187',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-LKO-1048',
    district: 'Lucknow',
    clientName: 'Division Office, Lucknow Central',
    facilityName: 'Division — Hazratganj',
    officeType: 'Division',
    contactPerson: 'Er. Rakesh Srivastava',
    contactPhone: '+91 94550 33321',
    computerCount: 4,
    status: 'available',
  },
  {
    siteCode: 'UP-KNP-2110',
    district: 'Kanpur Nagar',
    clientName: '33/11 KV Sub Station, Kidwai Nagar',
    facilityName: 'Sub Station — Kidwai Nagar',
    officeType: 'Sub Station',
    contactPerson: 'Er. Pooja Gupta',
    contactPhone: '+91 94150 55102',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-KNP-2115',
    district: 'Kanpur Nagar',
    clientName: 'Meter Test Lab, Kanpur',
    facilityName: 'Meter Test Lab — Panki',
    officeType: 'Meter Test Lab',
    contactPerson: 'Er. Vikas Yadav',
    contactPhone: '+91 94150 55188',
    computerCount: 3,
    status: 'available',
  },
  {
    siteCode: 'UP-AGR-3008',
    district: 'Agra',
    clientName: 'Sub Division Office, Sikandra',
    facilityName: 'Sub Division — Sikandra',
    officeType: 'Sub Division',
    contactPerson: 'Er. Meena Sharma',
    contactPhone: '+91 94150 77401',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-AGR-3011',
    district: 'Agra',
    clientName: '33/11 KV Sub Station, Dayalbagh',
    facilityName: 'Sub Station — Dayalbagh',
    officeType: 'Sub Station',
    contactPerson: 'Er. Deepak Chauhan',
    contactPhone: '+91 94150 77455',
    computerCount: 1,
    status: 'available',
  },
  {
    siteCode: 'UP-VNS-4021',
    district: 'Varanasi',
    clientName: 'Division Office, Varanasi',
    facilityName: 'Division — Sigra',
    officeType: 'Division',
    contactPerson: 'Er. Anjali Tiwari',
    contactPhone: '+91 94150 88201',
    computerCount: 4,
    status: 'available',
  },
  {
    siteCode: 'UP-VNS-4025',
    district: 'Varanasi',
    clientName: 'Sub Division Office, Ramnagar',
    facilityName: 'Sub Division — Ramnagar',
    officeType: 'Sub Division',
    contactPerson: 'Er. Hemant Patel',
    contactPhone: '+91 94150 88234',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-PRY-5009',
    district: 'Prayagraj',
    clientName: 'Store Office, Prayagraj',
    facilityName: 'Central Store — Naini',
    officeType: 'Store',
    contactPerson: 'Er. Shalini Dubey',
    contactPhone: '+91 94150 99102',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-PRY-5013',
    district: 'Prayagraj',
    clientName: '33/11 KV Sub Station, Jhunsi',
    facilityName: 'Sub Station — Jhunsi',
    officeType: 'Sub Station',
    contactPerson: 'Er. Mohit Agrawal',
    contactPhone: '+91 94150 99176',
    computerCount: 1,
    status: 'available',
  },
  {
    siteCode: 'UP-GZB-6102',
    district: 'Ghaziabad',
    clientName: 'Sub Division Office, Vaishali',
    facilityName: 'Sub Division — Vaishali',
    officeType: 'Sub Division',
    contactPerson: 'Er. Nitin Bhatia',
    contactPhone: '+91 94150 66201',
    computerCount: 3,
    status: 'available',
  },
  {
    siteCode: 'UP-GZB-6107',
    district: 'Ghaziabad',
    clientName: '33/11 KV Sub Station, Loni',
    facilityName: 'Sub Station — Loni',
    officeType: 'Sub Station',
    contactPerson: 'Er. Kavita Rani',
    contactPhone: '+91 94150 66288',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-MRT-7004',
    district: 'Mathura',
    clientName: 'Sub Division Office, Vrindavan',
    facilityName: 'Sub Division — Vrindavan',
    officeType: 'Sub Division',
    contactPerson: 'Er. Rajesh Pathak',
    contactPhone: '+91 94150 44302',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-JHS-8022',
    district: 'Jhansi',
    clientName: 'Division Office, Jhansi',
    facilityName: 'Division — Civil Lines',
    officeType: 'Division',
    contactPerson: 'Er. Alok Saxena',
    contactPhone: '+91 94150 33401',
    computerCount: 3,
    status: 'available',
  },
  {
    siteCode: 'UP-GKP-9031',
    district: 'Gorakhpur',
    clientName: '33/11 KV Sub Station, Golghar',
    facilityName: 'Sub Station — Golghar',
    officeType: 'Sub Station',
    contactPerson: 'Er. Manoj Pandey',
    contactPhone: '+91 94150 22601',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-BLY-1102',
    district: 'Bareilly',
    clientName: 'Test Division Office, Bareilly',
    facilityName: 'Test Division — Izzatnagar',
    officeType: 'Test Division',
    contactPerson: 'Er. Suman Lata',
    contactPhone: '+91 94150 11801',
    computerCount: 2,
    status: 'available',
  },
  {
    siteCode: 'UP-LKO-1039',
    district: 'Lucknow',
    clientName: '33/11 KV Sub Station, Chinhat',
    facilityName: 'Sub Station — Chinhat',
    officeType: 'Sub Station',
    contactPerson: 'Er. Ajay Kanojiya',
    contactPhone: '+91 94150 22118',
    computerCount: 2,
    status: 'in_progress',
    owner: 'ravi',
    startedHoursAgo: 5,
    milestonesDone: 2,
  },
  {
    siteCode: 'UP-KNP-2119',
    district: 'Kanpur Nagar',
    clientName: 'Sub Division Office, Kalyanpur',
    facilityName: 'Sub Division — Kalyanpur',
    officeType: 'Sub Division',
    contactPerson: 'Er. Reena Gupta',
    contactPhone: '+91 94150 55219',
    computerCount: 1,
    status: 'in_progress',
    owner: 'neha',
    startedHoursAgo: 11,
    milestonesDone: 1,
  },
  {
    siteCode: 'UP-VNS-4030',
    district: 'Varanasi',
    clientName: '33/11 KV Sub Station, Sarnath',
    facilityName: 'Sub Station — Sarnath',
    officeType: 'Sub Station',
    contactPerson: 'Er. Brijesh Singh',
    contactPhone: '+91 94150 88310',
    computerCount: 2,
    status: 'pending',
    owner: 'sameer',
    startedHoursAgo: 30,
    milestonesDone: 1,
    note: 'Department server room locked — awaiting key handover from the division office.',
  },
  {
    siteCode: 'UP-LKO-1004',
    district: 'Lucknow',
    clientName: 'Division Office, Lucknow North',
    facilityName: 'Division — Aliganj',
    officeType: 'Division',
    contactPerson: 'Er. Sarita Joshi',
    contactPhone: '+91 94150 22004',
    computerCount: 3,
    status: 'completed',
    owner: 'ravi',
    completedDaysAgo: 6,
  },
  {
    siteCode: 'UP-AGR-3002',
    district: 'Agra',
    clientName: 'Sub Division Office, Fatehabad',
    facilityName: 'Sub Division — Fatehabad Road',
    officeType: 'Sub Division',
    contactPerson: 'Er. Rajeev Lochan',
    contactPhone: '+91 94150 77302',
    computerCount: 2,
    status: 'completed',
    owner: 'neha',
    completedDaysAgo: 9,
  },
  {
    siteCode: 'UP-GZB-6091',
    district: 'Ghaziabad',
    clientName: '33/11 KV Sub Station, Sahibabad',
    facilityName: 'Sub Station — Sahibabad',
    officeType: 'Sub Station',
    contactPerson: 'Er. Anuradha Yadav',
    contactPhone: '+91 94150 66191',
    computerCount: 1,
    status: 'completed',
    owner: 'sameer',
    completedDaysAgo: 13,
  },
  {
    siteCode: 'UP-PRY-5002',
    district: 'Prayagraj',
    clientName: 'Workshop, Prayagraj',
    facilityName: 'Workshop — Teliyarganj',
    officeType: 'Workshop',
    contactPerson: 'Er. Ashok Kumar',
    contactPhone: '+91 94150 99002',
    computerCount: 2,
    status: 'completed',
    owner: 'ravi',
    completedDaysAgo: 18,
  },
];

function hostnamePrefixFor(district: string, siteCode: string): string {
  const districtToken = district.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'UPP';
  return `UP-${districtToken}-${siteCode.split('-').pop() || 'DTL'}`;
}

function verifiedComputer(prefix: string, index: number, verifiedAt: string): HostnameVerificationResult {
  const hostname = `${prefix}-PC${String(index + 1).padStart(2, '0')}.UP.GOV.LOCAL`;
  return {
    verified: true,
    hostname,
    ramGB: index % 2 === 0 ? 8 : 4,
    windowsVersion: 'Windows 11 Pro',
    windowsEdition: '22H2',
    windowsBuild: '22621.4169',
    systemArchitecture: 'x64',
    hardwareReportedAt: verifiedAt,
    hardwareReportedBy: 'agent-console',
    workstationProofPhoto: 'demo://workstation-photo',
    workstationProofCapturedAt: verifiedAt,
    resolvedIp: `10.24.${index + 11}.${40 + index}`,
    agentVersion: '4.8.2',
    approvalCode: `APR-${prefix.slice(-4)}-${String(index + 1).padStart(2, '0')}`,
    verifiedAt,
  };
}

function completedDocuments(siteCode: string, completedAt: string): UploadedDocument[] {
  return [
    {
      id: `${siteCode}-doc-1`,
      name: `${siteCode}-signoff-certificate.pdf`,
      docType: 'Sign-Off Certificate',
      sizeBytes: 412_884,
      uploadedAt: completedAt,
      checksum: 'demo-checksum-signed-copy',
      storagePath: `private/documents/${siteCode}/signoff.pdf`,
    },
    {
      id: `${siteCode}-doc-2`,
      name: `${siteCode}-device-serial-log.csv`,
      docType: 'Device Serial Log',
      sizeBytes: 18_231,
      uploadedAt: completedAt,
      checksum: 'demo-checksum-serial-log',
      storagePath: `private/documents/${siteCode}/serial-log.csv`,
    },
  ];
}

export function createSeedSites(nowMs: number = Date.now()): InstallationSite[] {
  return SEED_SITES.map((seed) => {
    const prefix = hostnamePrefixFor(seed.district, seed.siteCode);
    const coords = getDefaultCoordinatesForDistrict(seed.district);
    const owner = seed.owner ? AGENTS[seed.owner] : undefined;

    const startedAt =
      seed.status === 'in_progress' || seed.status === 'pending'
        ? new Date(nowMs - (seed.startedHoursAgo ?? 3) * HOUR).toISOString()
        : undefined;
    const completedAt = seed.completedDaysAgo
      ? new Date(nowMs - seed.completedDaysAgo * DAY).toISOString()
      : undefined;

    const milestones = createDefaultMilestones();
    if (seed.status === 'completed' && completedAt) {
      milestones.forEach((milestone, index) => {
        milestone.completed = true;
        milestone.completedAt = new Date(
          Date.parse(completedAt) - (milestones.length - index) * 13 * MINUTE,
        ).toISOString();
      });
    } else if (seed.milestonesDone) {
      milestones.slice(0, seed.milestonesDone).forEach((milestone) => {
        milestone.completed = true;
        milestone.completedAt = startedAt;
      });
    }

    const hostnameVerifications: HostnameVerificationResult[] =
      seed.status === 'completed' && completedAt
        ? Array.from({ length: seed.computerCount }, (_, index) =>
            verifiedComputer(prefix, index, completedAt),
          )
        : [];

    return {
      id: generateSiteUuid(),
      siteCode: seed.siteCode,
      district: seed.district,
      clientName: seed.clientName,
      facilityName: seed.facilityName,
      address: `${seed.facilityName}, ${seed.district}, Uttar Pradesh`,
      zone: seed.district,
      contactPerson: seed.contactPerson,
      contactPhone: seed.contactPhone,
      softwarePackage: 'BigFix + Trend Micro (UEM for ≤4 GB RAM)',
      expectedHostnamePrefix: prefix,
      sampleValidHostname: `${prefix}-PC01.UP.GOV.LOCAL`,
      slaWindow: '24h reservation · complete on site',
      status: seed.status,
      workflowVersion: 1,
      latitude: coords.latitude,
      longitude: coords.longitude,
      reservedByUser: owner?.userKey,
      reservedByName: owner?.fullName,
      completedByUser: seed.status === 'completed' ? owner?.userKey : undefined,
      startedAt,
      completedAt,
      biometricArrivalVerification: startedAt
        ? {
            verified: true,
            verifiedByUser: owner?.userKey || 'agent',
            verifiedByName: owner?.fullName,
            verificationId: `ARR-${seed.siteCode}`,
            matchScore: 96,
            verifiedAt: startedAt,
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracyMeters: 18,
          }
        : undefined,
      biometricCompletionSeal:
        seed.status === 'completed' && completedAt
          ? {
              verified: true,
              verifiedByUser: owner?.userKey || 'agent',
              verifiedByName: owner?.fullName,
              verificationId: `SEAL-${seed.siteCode}`,
              matchScore: 97,
              verifiedAt: completedAt,
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracyMeters: 12,
            }
          : undefined,
      milestones,
      computerCount: seed.computerCount,
      originalComputerCount: seed.computerCount,
      additionalComputers: [],
      domainComputerIndices: [],
      hostnameVerifications,
      hostnameVerification: hostnameVerifications[0],
      documents:
        seed.status === 'completed' && completedAt
          ? completedDocuments(seed.siteCode, completedAt)
          : [],
      notes: seed.note,
      remark: seed.note,
      discom: 'DVVNL',
      circle: seed.district,
      division: seed.facilityName.split('—')[0]?.trim() || seed.district,
      subDivision: seed.facilityName.split('—')[1]?.trim() || seed.district,
      subStationName: seed.officeType === 'Sub Station' ? seed.facilityName : undefined,
      officeType: seed.officeType,
      locationKey: `${seed.district}|${seed.officeType}|${seed.siteCode}`,
      sourceWorkbook: 'DVVNL_Aayush_pending_location_with_name.csv',
      totalSystems: seed.computerCount,
      availableSystems: seed.status === 'completed' ? seed.computerCount : 0,
      pendingSystems: seed.status === 'completed' ? 0 : seed.computerCount,
      preferredRemoteTime: '10:00 – 18:00 IST',
    } satisfies InstallationSite;
  });
}
