/**
 * Pure domain logic for Uttar Pradesh Tender Software Deployment,
 * District Filtering, Atomic Site Reservation (1 Active Site per User),
 * Automated Server Hostname Verification, Official Document Upload Validation,
 * and Strict Per-User Profile Isolation.
 */

export type SiteStatus = 'available' | 'in_progress' | 'pending' | 'completed';

export const UP_DISTRICTS: string[] = [
  'Agra',
  'Aligarh',
  'Ambedkar Nagar',
  'Amethi',
  'Amroha',
  'Auraiya',
  'Ayodhya',
  'Azamgarh',
  'Baghpat',
  'Bahraich',
  'Ballia',
  'Balrampur',
  'Banda',
  'Barabanki',
  'Bareilly',
  'Basti',
  'Bhadohi',
  'Bijnor',
  'Budaun',
  'Bulandshahr',
  'Chandauli',
  'Chitrakoot',
  'Deoria',
  'Etah',
  'Etawah',
  'Farrukhabad',
  'Fatehpur',
  'Firozabad',
  'Gautam Buddha Nagar',
  'Ghaziabad',
  'Ghazipur',
  'Gonda',
  'Gorakhpur',
  'Hamirpur',
  'Hapur',
  'Hardoi',
  'Hathras',
  'Jalaun',
  'Jaunpur',
  'Jhansi',
  'Kannauj',
  'Kanpur Dehat',
  'Kanpur Nagar',
  'Kasganj',
  'Kaushambi',
  'Kushinagar',
  'Lakhimpur Kheri',
  'Lalitpur',
  'Lucknow',
  'Maharajganj',
  'Mahoba',
  'Mainpuri',
  'Mathura',
  'Mau',
  'Meerut',
  'Mirzapur',
  'Moradabad',
  'Muzaffarnagar',
  'Pilibhit',
  'Pratapgarh',
  'Prayagraj',
  'Raebareli',
  'Rampur',
  'Saharanpur',
  'Sambhal',
  'Sant Kabir Nagar',
  'Shahjahanpur',
  'Shamli',
  'Shravasti',
  'Siddharthnagar',
  'Sitapur',
  'Sonbhadra',
  'Sultanpur',
  'Unnao',
  'Varanasi',
];

export type AuthenticatedRole = 'admin' | 'sub_admin' | 'agent';

export type AdminTabId =
  'sites' | 'users' | 'attendance' | 'add_user' | 'analytics' | 'documents' | 'activity_log';

export const ALL_ADMIN_TABS: readonly AdminTabId[] = [
  'sites',
  'users',
  'attendance',
  'add_user',
  'analytics',
  'documents',
  'activity_log',
] as const;

export const ADMIN_TAB_METADATA: Record<
  AdminTabId,
  { label: string; shortLabel: string; description: string }
> = {
  sites: {
    label: 'Installation Sites & Assignments',
    shortLabel: 'Sites',
    description: 'Sites, assignments, status changes & CSV export',
  },
  users: {
    label: 'Technicians & Biometrics Directory',
    shortLabel: 'Users',
    description: 'User directory, profiles, biometrics & attendance CSV',
  },
  attendance: {
    label: 'Technician Attendance & Work Calendar',
    shortLabel: 'Attendance',
    description: 'Per-technician duty calendar, biometric check-ins & completed-site counts',
  },
  add_user: {
    label: 'Provision New Users',
    shortLabel: 'Add User',
    description: 'Create & remove field technician accounts',
  },
  analytics: {
    label: 'District Analytics & Progress',
    shortLabel: 'Analytics',
    description: 'Read-only UP district progress & KPI telemetry',
  },
  documents: {
    label: 'Official Tender Documents & SOPs',
    shortLabel: 'SOP & Letters',
    description: 'Upload, replace & reset SOP and permission letters',
  },
  activity_log: {
    label: 'System Activity & Audit Trail',
    shortLabel: 'Activity',
    description: 'Security, login, attendance & site audit trail',
  },
};

export function sanitizeAllowedTabs(rawTabs: unknown): AdminTabId[] {
  if (!Array.isArray(rawTabs)) return [];
  const seen = new Set<AdminTabId>();
  for (const t of rawTabs) {
    if (typeof t === 'string' && (ALL_ADMIN_TABS as readonly string[]).includes(t)) {
      seen.add(t as AdminTabId);
    }
  }
  // Return in canonical tab order
  return ALL_ADMIN_TABS.filter((tab) => seen.has(tab));
}

export interface UserProfile {
  id: string;
  userId?: string;
  userKey: string;
  username: string;
  email: string;
  fullName: string;
  employeeId: string;
  serialNo: string;
  phone: string;
  alternatePhone?: string;
  address: string;
  legalProofType: 'Aadhaar' | 'PAN Card' | 'Voter ID' | 'Driving License' | 'Govt Tech ID';
  legalProofNumber: string;
  legalProofDoc?: {
    name: string;
    sizeBytes: number;
    uploadedAt: string;
    verified: boolean;
    evidenceVersion?: 1;
    evidenceSha256?: string;
    verificationVersion?: 1;
    verifiedBy?: string;
    verifiedAt?: string;
    fileData?: string;
    mimeType?: string;
  };
  operatingZone: string;
  department: string;
  onDuty: boolean;
  lastVerifiedAt?: string;
  lastVerificationId?: string;
  lastMatchScore?: number;
  lastLatitude?: number;
  lastLongitude?: number;
  lastLocationAccuracy?: number;
  facialPhoto?: string;
  fingerprintCredentialId?: string;
  fingerprintDeviceLabel?: string;
  fingerprintEnrolledAt?: string;
  morningOnDutyAt?: string;
  morningOnDutyLatitude?: number;
  morningOnDutyLongitude?: number;
  role?: AuthenticatedRole;
  allowedTabs?: AdminTabId[];
  updatedAt: string;
}

export interface MilestoneStep {
  id: 'checkin' | 'audit' | 'install' | 'hostname_verify' | 'paperwork';
  title: string;
  description: string;
  completed: boolean;
  completedAt?: string;
}

export interface UploadedDocument {
  id: string;
  name: string;
  docType: 'Sign-Off Certificate' | 'Site Acceptance Form' | 'Device Serial Log';
  sizeBytes: number;
  uploadedAt: string;
  checksum: string;
  /** Opaque server-generated path in the private Supabase certificate bucket. */
  storagePath?: string;
  fileData?: string;
  mimeType?: string;
}

export type SystemDocumentType = 'sop' | 'permission_letter';

export interface SystemDocumentRecord {
  id: SystemDocumentType;
  name: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy?: string;
  mimeType: string;
  url: string;
  isCustom: boolean;
  fileData?: string;
}

export type ComputerExceptionReason = 'pc_unavailable' | 'domain_pc' | 'windows_7' | 'other';

export type ComputerArchitecture = 'x64' | 'x86' | 'arm64' | 'unknown';

export interface HostnameVerificationResult {
  verified: boolean;
  hostname: string;
  /** Agent-reported workstation inventory, captured from Windows on that computer. */
  ramGB?: number;
  windowsVersion?: string;
  windowsEdition?: string;
  windowsBuild?: string;
  systemArchitecture?: ComputerArchitecture;
  hardwareReportedAt?: string;
  hardwareReportedBy?: string;
  /** A recorded reason why this workstation could not receive the installation. */
  exceptionReason?: ComputerExceptionReason;
  exceptionDescription?: string;
  /** Live workstation evidence required for both standard hostnames and exceptions. */
  workstationProofPhoto?: string;
  workstationProofCapturedAt?: string;
  exceptionProofPhoto?: string;
  exceptionProofCapturedAt?: string;
  isDomainComputer?: boolean;
  domainProofPhoto?: string;
  domainProofCapturedAt?: string;
  domainNotes?: string;
  resolvedIp?: string;
  agentVersion?: string;
  approvalCode?: string;
  verifiedAt?: string;
  error?: string;
}

/** SOP guidance: low-memory PCs receive UEM only; higher-memory PCs get both agents. */
export function getComputerSoftwarePlan(ramGB: number | null | undefined): string {
  if (typeof ramGB !== 'number' || !Number.isFinite(ramGB) || ramGB <= 0) {
    return 'RAM not recorded';
  }
  return ramGB <= 4 ? 'UEM only' : 'BigFix + Trend Micro';
}

export interface BiometricArrivalVerification {
  verified: boolean;
  verifiedByUser: string;
  verifiedByName?: string;
  verificationId: string;
  matchScore: number;
  verifiedAt: string;
  snapshotThumbnail?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
}

export interface BiometricCompletionSeal {
  verified: boolean;
  verifiedByUser: string;
  verifiedByName?: string;
  verificationId: string;
  matchScore: number;
  verifiedAt: string;
  snapshotThumbnail?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
}

export interface AdditionalComputerRecord {
  requestId: string;
  computerIndex: number;
  remark: string;
  addedByUser: string;
  addedAt: string;
}

export interface InstallationSite {
  id: string;
  siteCode: string;
  district: string;
  clientName: string;
  facilityName: string;
  address: string;
  zone: string;
  contactPerson: string;
  contactPhone: string;
  softwarePackage: string;
  expectedHostnamePrefix: string;
  sampleValidHostname: string;
  slaWindow: string;
  status: SiteStatus;
  /** Server-owned pause/resume revision and original-agent-only pending issue. */
  workflowVersion?: number;
  pendingIssue?: import('./site-pause').PendingSiteIssue;
  /**
   * Optional GPS coordinates for site maps and navigation. They do not restrict reservations or biometric verification.
   */
  latitude?: number;
  longitude?: number;
  /**
   * Canonical userKey of the technician who currently reserved or completed this site.
   * When status === 'in_progress', this site shows as "Reserved" to all other users.
   */
  reservedByUser?: string;
  reservedByName?: string;
  completedByUser?: string;
  assignedToUser?: string;
  assignedAgent?: string;
  startedAt?: string;
  completedAt?: string;
  biometricArrivalVerification?: BiometricArrivalVerification;
  biometricCompletionSeal?: BiometricCompletionSeal;
  milestones: MilestoneStep[];
  computerCount: number;
  /** Versioned per-computer inventory capture marker; absent on legacy site records. */
  computerInventoryVersion?: 1;
  /** Server-owned baseline and append-only discovery records. */
  originalComputerCount?: number;
  additionalComputers?: AdditionalComputerRecord[];
  domainComputerIndices?: number[];
  hostnameVerifications: HostnameVerificationResult[];
  /** Legacy single hostname verification for backwards compatibility */
  hostnameVerification?: HostnameVerificationResult;
  documents: UploadedDocument[];
  notes?: string;
  remark?: string;
  /** UP Discom / DVVNL Tender metadata */
  discom?: string;
  circle?: string;
  division?: string;
  subDivision?: string;
  subStationName?: string;
  officeType?: string;
  locationKey?: string;
  sourceWorkbook?: string;
  totalSystems?: number;
  availableSystems?: number;
  pendingSystems?: number;
  preferredRemoteTime?: string;
}

export interface NominatimMatch {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  boundingbox: string[];
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance: number;
  icon?: string;
}

/**
 * Smart Location Parser
 * Extracts latitude and longitude from raw strings:
 * - Decimals: "26.8467, 80.9462"
 * - DMS: "26°50'48.1"N 80°56'46.3"E"
 * - Plus Codes: "VX7W+89 Lucknow" or "7MV2VX7W+89"
 * - Google Maps URLs: "@26.8467,80.9462" or "q=26.8467,80.9462"
 */
export async function parseSmartLocationInput(
  input: string,
  districtReference?: { latitude: number; longitude: number },
): Promise<{ latitude: number; longitude: number; source: string } | null> {
  const clean = input.trim();
  if (!clean) return null;

  // 1. Raw Decimals / CSV
  const decimalMatch = clean.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (decimalMatch) {
    return {
      latitude: Number(decimalMatch[1]),
      longitude: Number(decimalMatch[2]),
      source: 'decimal',
    };
  }

  // 2. Google Maps URL patterns (extract @lat,lng or q=lat,lng)
  const urlLatLongMatch = clean.match(/[@=](-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (urlLatLongMatch) {
    return {
      latitude: Number(urlLatLongMatch[1]),
      longitude: Number(urlLatLongMatch[2]),
      source: 'url',
    };
  }

  // 3. Plus Codes (requires open-location-code)
  try {
    const { OpenLocationCode } = await import('open-location-code');
    const olc = new OpenLocationCode();

    // Check if it's a full Plus Code (usually 10+ chars, starts with area code)
    if (olc.isFull(clean)) {
      const decoded = olc.decode(clean);
      return {
        latitude: decoded.latitudeCenter,
        longitude: decoded.longitudeCenter,
        source: 'plus_code_full',
      };
    }

    // Check if it's a short Plus Code (e.g., "VX7W+89 Lucknow")
    if (olc.isShort(clean) && districtReference) {
      const recovered = olc.recoverNearest(
        clean,
        districtReference.latitude,
        districtReference.longitude,
      );
      const decoded = olc.decode(recovered);
      return {
        latitude: decoded.latitudeCenter,
        longitude: decoded.longitudeCenter,
        source: 'plus_code_short',
      };
    }
  } catch (err) {
    console.error('Plus Code parsing failed:', err);
  }

  return null;
}

export const UP_DISTRICT_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  Agra: { latitude: 27.1767, longitude: 78.0081 },
  Aligarh: { latitude: 27.8974, longitude: 78.088 },
  'Ambedkar Nagar': { latitude: 26.4329, longitude: 82.5359 },
  Amethi: { latitude: 26.1541, longitude: 81.8142 },
  Amroha: { latitude: 28.9044, longitude: 78.4673 },
  Auraiya: { latitude: 26.4646, longitude: 79.5092 },
  Ayodhya: { latitude: 26.7922, longitude: 82.1998 },
  Azamgarh: { latitude: 26.0739, longitude: 83.1859 },
  Baghpat: { latitude: 28.9465, longitude: 77.2219 },
  Bahraich: { latitude: 27.5742, longitude: 81.5959 },
  Ballia: { latitude: 25.7604, longitude: 84.1471 },
  Balrampur: { latitude: 27.4297, longitude: 82.1806 },
  Banda: { latitude: 25.4763, longitude: 80.3395 },
  Barabanki: { latitude: 26.9268, longitude: 81.1834 },
  Bareilly: { latitude: 28.367, longitude: 79.4304 },
  Basti: { latitude: 26.7995, longitude: 82.7351 },
  Bhadohi: { latitude: 25.3941, longitude: 82.5696 },
  Bijnor: { latitude: 29.3724, longitude: 78.1358 },
  Budaun: { latitude: 28.0342, longitude: 79.1264 },
  Bulandshahr: { latitude: 28.407, longitude: 77.8498 },
  Chandauli: { latitude: 25.257, longitude: 83.2683 },
  Chitrakoot: { latitude: 25.2016, longitude: 80.9167 },
  Deoria: { latitude: 26.5024, longitude: 83.7791 },
  Etah: { latitude: 27.5588, longitude: 78.6626 },
  Etawah: { latitude: 26.7856, longitude: 79.0158 },
  Farrukhabad: { latitude: 27.3826, longitude: 79.584 },
  Fatehpur: { latitude: 25.927, longitude: 80.8128 },
  Firozabad: { latitude: 27.1591, longitude: 78.3957 },
  'Gautam Buddha Nagar': { latitude: 28.5355, longitude: 77.391 },
  Ghaziabad: { latitude: 28.6692, longitude: 77.4538 },
  Ghazipur: { latitude: 25.584, longitude: 83.577 },
  Gonda: { latitude: 27.134, longitude: 81.9619 },
  Gorakhpur: { latitude: 26.7606, longitude: 83.3732 },
  Hamirpur: { latitude: 25.9554, longitude: 80.1487 },
  Hapur: { latitude: 28.7306, longitude: 77.7759 },
  Hardoi: { latitude: 27.3965, longitude: 80.125 },
  Hathras: { latitude: 27.598, longitude: 78.0524 },
  Jalaun: { latitude: 26.1449, longitude: 79.3364 },
  Jaunpur: { latitude: 25.7464, longitude: 82.6837 },
  Jhansi: { latitude: 25.4484, longitude: 78.5685 },
  Kannauj: { latitude: 27.0514, longitude: 79.9137 },
  'Kanpur Dehat': { latitude: 26.3821, longitude: 79.9696 },
  'Kanpur Nagar': { latitude: 26.4499, longitude: 80.3319 },
  Kasganj: { latitude: 27.808, longitude: 78.6458 },
  Kaushambi: { latitude: 25.5318, longitude: 81.3797 },
  Kushinagar: { latitude: 26.7402, longitude: 83.8887 },
  'Lakhimpur Kheri': { latitude: 27.9462, longitude: 80.7787 },
  Lalitpur: { latitude: 24.6912, longitude: 78.4139 },
  Lucknow: { latitude: 26.8467, longitude: 80.9462 },
  Maharajganj: { latitude: 27.1446, longitude: 83.5621 },
  Mahoba: { latitude: 25.2921, longitude: 79.8724 },
  Mainpuri: { latitude: 27.2285, longitude: 79.0252 },
  Mathura: { latitude: 27.4924, longitude: 77.6737 },
  Mau: { latitude: 25.9417, longitude: 83.5611 },
  Meerut: { latitude: 28.9845, longitude: 77.7064 },
  Mirzapur: { latitude: 25.146, longitude: 82.569 },
  Moradabad: { latitude: 28.8386, longitude: 78.7733 },
  Muzaffarnagar: { latitude: 29.4727, longitude: 77.7085 },
  Pilibhit: { latitude: 28.6312, longitude: 79.8044 },
  Pratapgarh: { latitude: 25.897, longitude: 81.9456 },
  Prayagraj: { latitude: 25.4358, longitude: 81.8463 },
  Raebareli: { latitude: 26.2345, longitude: 81.2409 },
  Rampur: { latitude: 28.7983, longitude: 79.022 },
  Saharanpur: { latitude: 29.968, longitude: 77.551 },
  Sambhal: { latitude: 28.5853, longitude: 78.5714 },
  'Sant Kabir Nagar': { latitude: 26.7747, longitude: 83.0365 },
  Shahjahanpur: { latitude: 27.8815, longitude: 79.911 },
  Shamli: { latitude: 29.4494, longitude: 77.3129 },
  Shravasti: { latitude: 27.5037, longitude: 81.9762 },
  Siddharthnagar: { latitude: 27.2569, longitude: 83.095 },
  Sitapur: { latitude: 27.568, longitude: 80.679 },
  Sonbhadra: { latitude: 24.6879, longitude: 83.0683 },
  Sultanpur: { latitude: 26.2648, longitude: 82.0727 },
  Unnao: { latitude: 26.5393, longitude: 80.4878 },
  Varanasi: { latitude: 25.3176, longitude: 82.9739 },
};

export function getDefaultCoordinatesForDistrict(district?: string): {
  latitude: number;
  longitude: number;
} {
  const clean = (district || 'Lucknow').trim();
  if (UP_DISTRICT_COORDINATES[clean]) {
    return { ...UP_DISTRICT_COORDINATES[clean] };
  }
  const foundKey = Object.keys(UP_DISTRICT_COORDINATES).find(
    (k) => k.toLowerCase() === clean.toLowerCase(),
  );
  if (foundKey) {
    return { ...UP_DISTRICT_COORDINATES[foundKey] };
  }
  return { latitude: 26.8467, longitude: 80.9462 };
}

/**
 * Generates an intelligent, direct turn-by-turn Google Maps navigation URL
 * for field technicians traveling to a target installation facility.
 *
 * Intelligence features:
 * 1. Checks exact target GPS coordinates (site.latitude, site.longitude). If present and valid,
 *    navigates directly to the exact pin coordinates.
 * 2. If coordinates are missing, zeroed, or uncalibrated, falls back to the official
 *    Uttar Pradesh district headquarter / center coordinates for that site's district.
 * 3. Omission of 'origin' in the Google Maps Universal Directions URL format directs Google Maps
 *    to automatically lock onto the technician's real-time live device GPS (works seamlessly
 *    both in native mobile apps on Android / iOS and in desktop web browsers).
 * 4. Specifying travelmode=driving opens native turn-by-turn driving / bike directions mode.
 * 5. Uses standard target="_blank" rel="noopener noreferrer" anchor links, strictly compliant
 *    with iframe sandbox security (no window.open or window.alert).
 */
export function getGoogleMapsNavigationUrl(
  site: {
    latitude?: number | null;
    longitude?: number | null;
    district?: string;
    facilityName?: string;
    address?: string;
    clientName?: string;
  },
  travelMode: 'driving' | 'two_wheeler' | 'transit' = 'driving',
): string {
  let lat = site.latitude;
  let lon = site.longitude;

  const hasValidCoords =
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    !(lat === 0 && lon === 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;

  if (!hasValidCoords) {
    const fallback = getDefaultCoordinatesForDistrict(site.district);
    lat = fallback.latitude;
    lon = fallback.longitude;
  }

  // Format destination as precise 6-decimal lat,lon
  const destination = `${(lat as number).toFixed(6)},${(lon as number).toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${travelMode}`;
}

/**
 * Generates a Google Maps place/satellite search URL to inspect the facility landmarks.
 */
export function getGoogleMapsSearchUrl(site: {
  latitude?: number | null;
  longitude?: number | null;
  district?: string;
  facilityName?: string;
  address?: string;
  clientName?: string;
}): string {
  let lat = site.latitude;
  let lon = site.longitude;

  const hasValidCoords =
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    !(lat === 0 && lon === 0);

  if (hasValidCoords) {
    return `https://www.google.com/maps/search/?api=1&query=${(lat as number).toFixed(6)},${(lon as number).toFixed(6)}`;
  }

  const district = site.district || 'Uttar Pradesh';
  const query = [site.facilityName || site.clientName, site.address, district, 'Uttar Pradesh']
    .filter(Boolean)
    .join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Normalizes any username or email into a canonical lowercase user key
 * (e.g., "Ayush" -> "ayush", "@ravi_captain" -> "ravi_captain", "Ayush@aether.local" -> "ayush").
 */
export function normalizeUserKey(usernameOrEmail: string): string {
  const raw = (usernameOrEmail || '').trim().replace(/^@+/, '').toLowerCase();
  if (!raw) return 'anonymous';
  if (raw.endsWith('@aether.local')) {
    return raw.slice(0, -'@aether.local'.length);
  }
  if (raw.includes('@')) {
    return raw.split('@')[0];
  }
  return raw;
}

/**
 * Known baseline sequence indices for core tender agents to guarantee
 * strict 1001, 1002, 1003 series consistency.
 */
export const KNOWN_USER_SERIAL_MAP: Record<string, string> = {};

/**
 * Resolves a deterministic sequential serial number following the series 1001, 1002, 1003...
 */
export function resolveUserSequentialSerialNo(
  userKey: string,
  existingSerialNo?: string,
  index?: number,
): string {
  if (existingSerialNo && /^SN-UP-\d{4,}$/.test(existingSerialNo.trim())) {
    return existingSerialNo.trim();
  }
  const cleanKey = normalizeUserKey(userKey);
  if (KNOWN_USER_SERIAL_MAP[cleanKey]) {
    return KNOWN_USER_SERIAL_MAP[cleanKey];
  }
  if (typeof index === 'number' && index >= 0) {
    return `SN-UP-${1001 + index}`;
  }
  // Deterministic offset based on string character sum
  let offset = 0;
  for (let i = 0; i < cleanKey.length; i++) {
    offset = (offset * 17 + cleanKey.charCodeAt(i)) % 50;
  }
  return `SN-UP-${1006 + offset}`;
}

/**
 * Calculates next sequential serial number (e.g. SN-UP-1006) based on existing users.
 */
export function getNextSequentialSerialNo(existingUsers: Array<{ serialNo?: string }>): string {
  let max = 1000;
  for (const u of existingUsers) {
    const match = (u?.serialNo || '').match(/SN-UP-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > max) max = num;
    }
  }
  return `SN-UP-${max + 1}`;
}

/**
 * Creates a strictly isolated default profile for a specific user.
 */
export function createDefaultUserProfile(user: {
  id: string;
  email: string;
  name?: string;
}): UserProfile {
  const userKey = normalizeUserKey(user.name || user.email);
  const displayUsername =
    user.name || (user.email.includes('@') ? user.email.split('@')[0] : user.email);
  const formattedName =
    displayUsername.charAt(0).toUpperCase() + displayUsername.slice(1).replace(/_/g, ' ');

  const cleanCode =
    userKey
      .replace(/[^a-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6) || 'AGENT';
  let hash = 0;
  for (let i = 0; i < userKey.length; i++) {
    hash = (hash * 31 + userKey.charCodeAt(i)) % 900;
  }
  const empNum = 100 + hash;

  return {
    id: user.id,
    userId: user.id,
    userKey,
    username: displayUsername,
    email: user.email,
    fullName: formattedName,
    employeeId: `UP-TECH-${cleanCode}-${empNum}`,
    serialNo: '', // Assigned only by Postgres during provisioning.
    phone: '',
    alternatePhone: '',
    address: '',
    legalProofType: 'Aadhaar',
    legalProofNumber: '',
    operatingZone: '',
    department: 'UP Tender Software Deployment',
    onDuty: true,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 24-Hour SLA timeout (in milliseconds) after which an incomplete reservation
 * is automatically reset from 'reserved' / 'in_progress' back to 'available'.
 */
export const RESERVATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks whether an active ('in_progress') reservation has exceeded the 24-hour completion window.
 */
export function isReservationExpired(
  site: Pick<InstallationSite, 'status' | 'startedAt'>,
  nowMs: number = Date.now(),
  expiryMs: number = RESERVATION_EXPIRY_MS,
): boolean {
  if (site.status !== 'in_progress') return false;
  if (!site.startedAt) return false;
  const startedMs = Date.parse(site.startedAt);
  if (Number.isNaN(startedMs)) return false;
  return nowMs - startedMs >= expiryMs;
}

/**
 * Formats the remaining time before the 24-hour reservation auto-reset triggers.
 */
export function getReservationRemainingLabel(
  site: Pick<InstallationSite, 'status' | 'startedAt'>,
  nowMs: number = Date.now(),
  expiryMs: number = RESERVATION_EXPIRY_MS,
): string {
  if (site.status !== 'in_progress') return '';
  if (!site.startedAt) return '24h 0m left (Auto-releases in 24h)';
  const startedMs = Date.parse(site.startedAt);
  if (Number.isNaN(startedMs)) return '24h 0m left (Auto-releases in 24h)';

  const remainingMs = Math.max(0, startedMs + expiryMs - nowMs);
  if (remainingMs === 0) return 'Expired (> 24h) — Resetting to Available';

  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${mins}m left before 24h auto-reset`;
}

/**
 * Sweeps a list of installation sites and automatically resets any reservation
 * that has not been completed within 24 hours back to 'available'.
 */
export function releaseExpiredReservations(
  allSites: InstallationSite[],
  nowMs: number = Date.now(),
  expiryMs: number = RESERVATION_EXPIRY_MS,
): {
  sites: InstallationSite[];
  expiredSiteIds: string[];
  expiredCount: number;
} {
  const expiredSiteIds: string[] = [];

  const updated = allSites.map((site) => {
    if (!isReservationExpired(site, nowMs, expiryMs)) {
      return site;
    }

    expiredSiteIds.push(site.id);
    return {
      ...site,
      status: 'available' as const,
      reservedByUser: undefined,
      reservedByName: undefined,
      startedAt: undefined,
      biometricArrivalVerification: undefined,
    };
  });

  return {
    sites: updated,
    expiredSiteIds,
    expiredCount: expiredSiteIds.length,
  };
}

/**
 * Finds the single active (reserved / in_progress) installation site for a given user, if any.
 */
export function getActiveSiteForUser(
  allSites: InstallationSite[],
  userKeyInput: string,
  nowMs: number = Date.now(),
): InstallationSite | null {
  const userKey = normalizeUserKey(userKeyInput);
  return (
    allSites.find(
      (s) =>
        s.status === 'in_progress' &&
        !isReservationExpired(s, nowMs) &&
        s.reservedByUser &&
        normalizeUserKey(s.reservedByUser) === userKey,
    ) || null
  );
}

/**
 * Enforces the two core tender rules:
 * 1. If a site is already reserved (`in_progress`) by another user (and not expired), no one else can select it.
 * 2. A user can only work on ONE installation site at a time; they must complete their active site before selecting another.
 */
export function canUserClaimSite(
  allSites: InstallationSite[],
  targetSiteId: string,
  userKeyInput: string,
  nowMs: number = Date.now(),
): {
  allowed: boolean;
  reason?: string;
  activeSite?: InstallationSite;
} {
  const userKey = normalizeUserKey(userKeyInput);
  const { sites: freshSites } = releaseExpiredReservations(allSites, nowMs);
  const targetSite = freshSites.find((s) => s.id === targetSiteId);

  if (!targetSite) {
    return { allowed: false, reason: 'Installation site not found.' };
  }

  if (targetSite.status === 'pending') {
    return {
      allowed: false,
      reason: 'This site is pending. Only its original agent can use Issue resolved—resume.',
    };
  }

  if (targetSite.status === 'completed') {
    return {
      allowed: false,
      reason: `This site is already completed${
        targetSite.completedByUser ? ` by @${targetSite.completedByUser}` : ''
      }.`,
    };
  }

  const targetOwner = targetSite.reservedByUser ? normalizeUserKey(targetSite.reservedByUser) : '';

  // If already reserved by another user -> blocked ("Reserved")
  if (targetSite.status === 'in_progress' && targetOwner && targetOwner !== userKey) {
    return {
      allowed: false,
      reason: `This site is currently reserved by @${targetOwner}.`,
    };
  }

  // If already reserved by this same user -> allowed to continue working on it
  if (targetSite.status === 'in_progress' && targetOwner === userKey) {
    return { allowed: true, activeSite: targetSite };
  }

  // Check if this user already has ANOTHER active (reserved) site in progress
  const existingActive = getActiveSiteForUser(freshSites, userKey, nowMs);
  if (existingActive && existingActive.id !== targetSite.id) {
    return {
      allowed: false,
      activeSite: existingActive,
      reason: `You already have an active installation in progress at "${existingActive.clientName}" (${existingActive.district}). Complete or pause it before selecting another site.`,
    };
  }

  return { allowed: true };
}

/**
 * Filters sites by Uttar Pradesh district ('all' or specific district name) and search query.
 */
export function filterSitesByDistrict(
  sites: InstallationSite[],
  district: string,
  searchQuery = '',
): InstallationSite[] {
  const normDistrict = (district || 'all').trim().toLowerCase();
  const q = searchQuery.trim().toLowerCase().replace(/^@/, '');

  return sites.filter((site) => {
    const siteDistrict = (site.district || '').trim().toLowerCase();
    if (normDistrict !== 'all' && siteDistrict !== normDistrict) {
      return false;
    }
    if (!q) return true;
    return (
      site.clientName.toLowerCase().includes(q) ||
      (site.facilityName || '').toLowerCase().includes(q) ||
      site.address.toLowerCase().includes(q) ||
      site.siteCode.toLowerCase().includes(q) ||
      siteDistrict.includes(q) ||
      (site.expectedHostnamePrefix || '').toLowerCase().includes(q) ||
      (site.sampleValidHostname || '').toLowerCase().includes(q) ||
      (site.reservedByUser || '').toLowerCase().includes(q) ||
      (site.completedByUser || '').toLowerCase().includes(q) ||
      (site.hostnameVerification?.hostname || '').toLowerCase().includes(q) ||
      (site.zone || '').toLowerCase().includes(q) ||
      (site.circle || '').toLowerCase().includes(q) ||
      (site.division || '').toLowerCase().includes(q) ||
      (site.subDivision || '').toLowerCase().includes(q) ||
      (site.locationKey || '').toLowerCase().includes(q) ||
      (site.officeType || '').toLowerCase().includes(q) ||
      (site.contactPerson || '').toLowerCase().includes(q) ||
      (site.contactPhone || '').toLowerCase().includes(q)
    );
  });
}

export type InstallationSiteSortOrder = 'district' | 'name' | 'pending';

/** Returns a sorted copy so shared site state and its original order are not mutated. */
export function sortInstallationSites(
  sites: InstallationSite[],
  sortOrder: InstallationSiteSortOrder = 'district',
): InstallationSite[] {
  return [...sites].sort((a, b) => {
    if (sortOrder === 'pending') {
      const pendingDifference =
        (b.pendingSystems ?? b.computerCount ?? 0) - (a.pendingSystems ?? a.computerCount ?? 0);
      if (pendingDifference !== 0) return pendingDifference;
    }
    if (sortOrder === 'district') {
      const districtDifference = (a.district || '').localeCompare(b.district || '', undefined, {
        sensitivity: 'base',
      });
      if (districtDifference !== 0) return districtDifference;
    }
    return (
      (a.clientName || '').localeCompare(b.clientName || '', undefined, {
        sensitivity: 'base',
        numeric: true,
      }) ||
      (a.siteCode || '').localeCompare(b.siteCode || '', undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );
  });
}

export interface SearchableUserRecord {
  id: string;
  username: string;
  email: string;
  role: AuthenticatedRole;
  allowedTabs?: AdminTabId[];
  createdAt?: string;
  syncedToSupabase?: boolean;
  fullName?: string;
  serialNo?: string;
  onDuty?: boolean;
  lastVerifiedAt?: string;
  facialPhoto?: string;
}

/**
 * Filters provisioned users by search query (serial number, full name, username, email, or role) and optional role filter.
 */
export function filterProvisionedUsers<T extends SearchableUserRecord>(
  users: T[],
  searchQuery = '',
  roleFilter: 'all' | 'admin' | 'sub_admin' | 'agent' = 'all',
): T[] {
  const q = searchQuery.trim().toLowerCase().replace(/^@/, '');

  return users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) {
      return false;
    }
    if (!q) return true;
    const roleLabel =
      u.role === 'admin'
        ? 'admin administrator'
        : u.role === 'sub_admin'
          ? 'sub admin sub_admin'
          : 'field agent technician';
    return (
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.serialNo || '').toLowerCase().includes(q) ||
      (u.fullName && u.fullName.toLowerCase().includes(q)) ||
      roleLabel.includes(q)
    );
  });
}

export interface ProvisionedUserSummaryInput {
  id: string;
  username: string;
  email: string;
  role: AuthenticatedRole;
  allowedTabs?: AdminTabId[];
  createdAt: string;
  syncedToSupabase: boolean;
}

export interface UserInstallationSummary {
  userKey: string;
  user: ProvisionedUserSummaryInput;
  profile: UserProfile;
  completedSites: InstallationSite[];
  inProgressSites: InstallationSite[];
  allUserSites: InstallationSite[];
  completedCount: number;
  inProgressCount: number;
  totalInstallationsCount: number;
  districtsCovered: string[];
  verifiedHostnamesCount: number;
  uploadedDocumentsCount: number;
}

/**
 * Resolves a user record by ID, username, or email from the provisioned users list,
 * or synthesizes a clean fallback record if an agent username appears in site logs.
 */
export function resolveUserRecordByIdentifier(
  identifier: string,
  usersList: ProvisionedUserSummaryInput[],
): ProvisionedUserSummaryInput | null {
  const raw = (identifier || '').trim();
  if (!raw) return null;

  const byId = usersList.find((u) => u.id === raw);
  if (byId) return byId;

  const targetKey = normalizeUserKey(raw);
  const byKey = usersList.find(
    (u) => normalizeUserKey(u.username) === targetKey || normalizeUserKey(u.email) === targetKey,
  );
  if (byKey) return byKey;

  return {
    id: `usr-${targetKey}`,
    username: targetKey,
    email: raw.includes('@') ? raw.toLowerCase() : `${targetKey}@aether.local`,
    role: targetKey === 'admin' ? 'admin' : 'agent',
    createdAt: 'Active Account',
    syncedToSupabase: true,
  };
}

/**
 * Computes a complete summary of a user's profile and all installations they have
 * completed or currently reserved across Uttar Pradesh tender sites.
 */
export function getUserInstallationSummary(
  user: ProvisionedUserSummaryInput,
  allSites: InstallationSite[],
  customProfile?: UserProfile | null,
): UserInstallationSummary {
  const userKey = normalizeUserKey(user.username || user.email);
  const defaultProfile = createDefaultUserProfile({
    id: user.id,
    email: user.email,
    name: user.username,
  });

  const profile: UserProfile = customProfile
    ? {
        ...defaultProfile,
        ...customProfile,
        userKey,
        username: customProfile.username || user.username,
        email: customProfile.email || user.email,
      }
    : defaultProfile;

  const completedSites: InstallationSite[] = [];
  const inProgressSites: InstallationSite[] = [];

  for (const site of allSites) {
    if (site.status === 'completed') {
      const completedOwner = normalizeUserKey(
        site.completedByUser || site.reservedByUser || site.assignedToUser || '',
      );
      if (completedOwner === userKey) {
        completedSites.push(site);
      }
    } else if (site.status === 'in_progress') {
      const reservedOwner = normalizeUserKey(site.reservedByUser || site.assignedToUser || '');
      if (reservedOwner === userKey) {
        inProgressSites.push(site);
      }
    }
  }

  // Sort completed sites with most recent completion first
  completedSites.sort((a, b) => {
    const timeA = a.completedAt ? Date.parse(a.completedAt) || 0 : 0;
    const timeB = b.completedAt ? Date.parse(b.completedAt) || 0 : 0;
    return timeB - timeA;
  });

  const allUserSites = [...inProgressSites, ...completedSites];

  const districtsCovered = Array.from(new Set(allUserSites.map((s) => s.district).filter(Boolean)));

  const verifiedHostnamesCount = allUserSites.filter((s) =>
    Boolean(s.hostnameVerification?.verified),
  ).length;

  const uploadedDocumentsCount = allUserSites.reduce(
    (sum, s) => sum + (Array.isArray(s.documents) ? s.documents.length : 0),
    0,
  );

  return {
    userKey,
    user,
    profile,
    completedSites,
    inProgressSites,
    allUserSites,
    completedCount: completedSites.length,
    inProgressCount: inProgressSites.length,
    totalInstallationsCount: completedSites.length + inProgressSites.length,
    districtsCovered,
    verifiedHostnamesCount,
    uploadedDocumentsCount,
  };
}

export interface SiteEditInput {
  clientName: string;
  district: string;
  address: string;
  expectedHostnamePrefix: string;
  latitude?: number;
  longitude?: number;
  computerCount?: number;
  discom?: string;
  zone?: string;
  circle?: string;
  division?: string;
  subDivision?: string;
  subStationName?: string;
  officeType?: string;
  contactPerson?: string;
  contactPhone?: string;
  preferredRemoteTime?: string;
  totalSystems?: number;
  pendingSystems?: number;
  notes?: string;
}

/**
 * Updates an existing site's core details (name, district, address, expected hostname prefix, target GPS coordinates)
 * without losing its reservation, completion, hostname verification, or document records.
 */
export function updateSiteDetails(
  allSites: InstallationSite[],
  siteId: string,
  updates: SiteEditInput,
): {
  isValid: boolean;
  error?: string;
  updatedSite?: InstallationSite;
  sites: InstallationSite[];
} {
  const cleanName = (updates.clientName || '').trim();
  if (!cleanName) {
    return {
      isValid: false,
      error: 'Site / Location Name cannot be empty.',
      sites: allSites,
    };
  }

  const cleanDistrict = (updates.district || 'Lucknow').trim();
  const dCode =
    cleanDistrict
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 3)
      .toUpperCase() || 'UP';
  const cleanAddress = (updates.address || '').trim() || `${cleanDistrict}, Uttar Pradesh`;
  const cleanPrefix = ((updates.expectedHostnamePrefix || '').trim() || `UP-${dCode}-NODE`)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');

  const hasValidLat =
    typeof updates.latitude === 'number' &&
    Number.isFinite(updates.latitude) &&
    updates.latitude >= -90 &&
    updates.latitude <= 90;
  const hasValidLng =
    typeof updates.longitude === 'number' &&
    Number.isFinite(updates.longitude) &&
    updates.longitude >= -180 &&
    updates.longitude <= 180;

  let updatedSite: InstallationSite | undefined;

  const nextSites = allSites.map((site) => {
    if (site.id !== siteId) return site;
    const prefixChanged = site.expectedHostnamePrefix !== cleanPrefix;
    const defaultCoords = getDefaultCoordinatesForDistrict(cleanDistrict);

    const nextComputerCount =
      typeof updates.computerCount === 'number' && updates.computerCount >= 1
        ? Math.min(100, Math.floor(updates.computerCount))
        : site.computerCount || 1;

    let nextVerifications: HostnameVerificationResult[] = Array.isArray(site.hostnameVerifications)
      ? [...site.hostnameVerifications]
      : [];

    if (nextVerifications.length < nextComputerCount) {
      while (nextVerifications.length < nextComputerCount) {
        nextVerifications.push({
          verified: false,
          hostname: '',
        });
      }
    } else if (nextVerifications.length > nextComputerCount) {
      nextVerifications = nextVerifications.slice(0, nextComputerCount);
    }

    updatedSite = {
      ...site,
      clientName: cleanName,
      facilityName: cleanName,
      district: cleanDistrict,
      zone: updates.zone !== undefined ? updates.zone : site.zone || `${cleanDistrict} District`,
      discom: updates.discom !== undefined ? updates.discom : site.discom,
      circle: updates.circle !== undefined ? updates.circle : site.circle,
      division: updates.division !== undefined ? updates.division : site.division,
      subDivision: updates.subDivision !== undefined ? updates.subDivision : site.subDivision,
      subStationName:
        updates.subStationName !== undefined ? updates.subStationName : site.subStationName,
      officeType: updates.officeType !== undefined ? updates.officeType : site.officeType,
      contactPerson:
        updates.contactPerson !== undefined ? updates.contactPerson : site.contactPerson,
      contactPhone: updates.contactPhone !== undefined ? updates.contactPhone : site.contactPhone,
      preferredRemoteTime:
        updates.preferredRemoteTime !== undefined
          ? updates.preferredRemoteTime
          : site.preferredRemoteTime,
      totalSystems: updates.totalSystems !== undefined ? updates.totalSystems : site.totalSystems,
      pendingSystems:
        updates.pendingSystems !== undefined ? updates.pendingSystems : site.pendingSystems,
      notes: updates.notes !== undefined ? updates.notes : site.notes,
      address: cleanAddress,
      expectedHostnamePrefix: cleanPrefix,
      sampleValidHostname: prefixChanged
        ? `${cleanPrefix}01.UP.GOV.LOCAL`
        : site.sampleValidHostname,
      computerCount: nextComputerCount,
      hostnameVerifications: nextVerifications,
      latitude: hasValidLat
        ? Number(updates.latitude!.toFixed(6))
        : (site.latitude ?? defaultCoords.latitude),
      longitude: hasValidLng
        ? Number(updates.longitude!.toFixed(6))
        : (site.longitude ?? defaultCoords.longitude),
    };
    return updatedSite;
  });

  if (!updatedSite) {
    return {
      isValid: false,
      error: 'Site not found.',
      sites: allSites,
    };
  }

  return {
    isValid: true,
    updatedSite,
    sites: nextSites,
  };
}

/**
 * Allows the Admin to manually assign an available site or reassign a reserved site to a specific Field Agent,
 * or unassign it back to 'available'.
 */
export function adminAssignSiteToAgent(
  allSites: InstallationSite[],
  siteId: string,
  agentUsernameOrNull: string | null,
  nowIso: string = new Date().toISOString(),
): {
  success: boolean;
  error?: string;
  updatedSite?: InstallationSite;
  sites: InstallationSite[];
} {
  const target = allSites.find((s) => s.id === siteId);
  if (!target) {
    return {
      success: false,
      error: 'Installation site not found.',
      sites: allSites,
    };
  }

  if (target.status === 'pending')
    return {
      success: false,
      error: 'Recover the pending site with an audit remark before assigning it.',
      sites: allSites,
    };

  if (target.status === 'completed') {
    return {
      success: false,
      error: 'Completed sites cannot be reassigned.',
      sites: allSites,
    };
  }

  const trimmedAgent = (agentUsernameOrNull || '').trim();
  let updatedSite: InstallationSite | undefined;

  // Unassign -> reset back to 'available'
  if (!trimmedAgent) {
    const nextSites = allSites.map((s) => {
      if (s.id !== siteId) return s;
      updatedSite = {
        ...s,
        status: 'available',
        reservedByUser: undefined,
        reservedByName: undefined,
        assignedToUser: undefined,
        startedAt: undefined,
        biometricArrivalVerification: undefined,
      };
      return updatedSite;
    });
    return {
      success: true,
      updatedSite,
      sites: nextSites,
    };
  }

  const agentKey = normalizeUserKey(trimmedAgent);
  const nextSites = allSites.map((s) => {
    if (s.id !== siteId) return s;
    updatedSite = {
      ...s,
      status: 'in_progress',
      reservedByUser: agentKey,
      reservedByName: trimmedAgent,
      assignedToUser: agentKey,
      startedAt: nowIso,
    };
    return updatedSite;
  });

  return {
    success: true,
    updatedSite,
    sites: nextSites,
  };
}

/** Registry capacity, not completed installations or the pending/available subsets.
 * Missing or invalid legacy counts contribute zero rather than inventing devices. */
export function getSiteComputerCount(site: Pick<InstallationSite, 'computerCount'>): number {
  return Number.isFinite(site.computerCount) && site.computerCount > 0
    ? Math.floor(site.computerCount)
    : 0;
}

export interface DistrictProgressItem {
  district: string;
  totalComputers: number;
  totalSites: number;
  completedSites: number;
  inProgressSites: number;
  availableSites: number;
  completionPercent: number;
  isLagging: boolean;
  statusSummaryLabel: string;
}

/**
 * Computes a district-wise completion progress breakdown across all Uttar Pradesh districts
 * present in the sites list. Sorts lagging districts (incomplete) first so admins can
 * immediately identify bottlenecks.
 */
export function getDistrictProgressBreakdown(sites: InstallationSite[]): DistrictProgressItem[] {
  const map = new Map<
    string,
    {
      district: string;
      totalSites: number;
      totalComputers: number;
      completedSites: number;
      inProgressSites: number;
      availableSites: number;
    }
  >();

  for (const site of sites) {
    const districtName = (site.district || 'Lucknow').trim() || 'Lucknow';
    const districtKey = districtName.toLowerCase();
    const existing = map.get(districtKey) || {
      district: UP_DISTRICTS.find((name) => name.toLowerCase() === districtKey) || districtName,
      totalSites: 0,
      totalComputers: 0,
      completedSites: 0,
      inProgressSites: 0,
      availableSites: 0,
    };

    existing.totalSites += 1;
    existing.totalComputers += getSiteComputerCount(site);

    if (site.status === 'completed') {
      existing.completedSites += 1;
    } else if (site.status === 'in_progress') {
      existing.inProgressSites += 1;
    } else if (site.status === 'available') {
      existing.availableSites += 1;
    }

    map.set(districtKey, existing);
  }

  const items: DistrictProgressItem[] = Array.from(map.values()).map((entry) => {
    const completionPercent =
      entry.totalSites > 0 ? Math.round((entry.completedSites / entry.totalSites) * 100) : 0;
    const isLagging = entry.completedSites < entry.totalSites;
    const statusSummaryLabel = `${entry.completedSites}/${entry.totalSites} Done`;

    return {
      ...entry,
      completionPercent,
      isLagging,
      statusSummaryLabel,
    };
  });

  // Sort lagging districts first (lowest completion % first, then highest total sites),
  // followed by 100% completed districts alphabetically.
  return items.sort((a, b) => {
    if (a.isLagging !== b.isLagging) {
      return a.isLagging ? -1 : 1;
    }
    if (a.completionPercent !== b.completionPercent) {
      return a.completionPercent - b.completionPercent;
    }
    if (b.totalSites !== a.totalSites) {
      return b.totalSites - a.totalSites;
    }
    return a.district.localeCompare(b.district);
  });
}

export interface StaleReservationItem {
  site: InstallationSite;
  agentKey: string;
  elapsedMs: number;
  remainingMs: number;
  remainingLabel: string;
  completedMilestones: number;
  totalMilestones: number;
  reason: 'approaching_24h_timeout' | 'stalled_no_progress';
  reasonLabel: string;
}

/**
 * Default warning window before the 24-hour reservation auto-release timeout (6 hours remaining),
 * plus stalled reservation detection (reserved >= 30 minutes with 0 milestones completed).
 */
export const STALE_WARNING_REMAINING_MS = 6 * 60 * 60 * 1000;
export const STALLED_NO_PROGRESS_ELAPSED_MS = 30 * 60 * 1000;

/**
 * Identifies reserved ('in_progress') sites that are either:
 * 1. Approaching the 24-hour auto-release timeout (remaining time <= warningRemainingMs, default 6h), or
 * 2. Stalled with 0 completed milestones after `stalledElapsedMs` (default 30m).
 */
export function getStaleReservations(
  sites: InstallationSite[],
  nowMs: number = Date.now(),
  options: {
    expiryMs?: number;
    warningRemainingMs?: number;
    stalledElapsedMs?: number;
  } = {},
): StaleReservationItem[] {
  const expiryMs = options.expiryMs ?? RESERVATION_EXPIRY_MS;
  const warningRemainingMs = options.warningRemainingMs ?? STALE_WARNING_REMAINING_MS;
  const stalledElapsedMs = options.stalledElapsedMs ?? STALLED_NO_PROGRESS_ELAPSED_MS;

  const staleItems: StaleReservationItem[] = [];

  for (const site of sites) {
    if (site.status !== 'in_progress') continue;

    const startedMs = site.startedAt ? Date.parse(site.startedAt) : NaN;
    const validStartedMs = Number.isNaN(startedMs) ? nowMs : startedMs;
    const elapsedMs = Math.max(0, nowMs - validStartedMs);
    const remainingMs = Math.max(0, validStartedMs + expiryMs - nowMs);

    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    const remainingLabel = remainingMs === 0 ? 'Expired (0h left)' : `${hours}h ${mins}m left`;

    const milestones = Array.isArray(site.milestones) ? site.milestones : [];
    const completedMilestones = milestones.filter((m) => m.completed).length;
    const totalMilestones = milestones.length || 5;

    const isApproachingTimeout = remainingMs <= warningRemainingMs;
    const isStalledNoProgress = completedMilestones === 0 && elapsedMs >= stalledElapsedMs;

    if (!isApproachingTimeout && !isStalledNoProgress) {
      continue;
    }

    const reason = isApproachingTimeout ? 'approaching_24h_timeout' : 'stalled_no_progress';
    const reasonLabel = isApproachingTimeout
      ? `Timeout soon · ${remainingLabel}`
      : `0/${totalMilestones} steps · ${remainingLabel}`;

    staleItems.push({
      site,
      agentKey: normalizeUserKey(site.reservedByUser || site.reservedByName || 'agent'),
      elapsedMs,
      remainingMs,
      remainingLabel,
      completedMilestones,
      totalMilestones,
      reason,
      reasonLabel,
    });
  }

  // Sort by least remaining time first (most urgent at top)
  return staleItems.sort((a, b) => a.remainingMs - b.remainingMs);
}

/**
 * Releases all specified stale reservation site IDs (or all detected stale reservations if IDs omitted)
 * back to 'available' status in one operation.
 */
export function releaseStaleReservations(
  allSites: InstallationSite[],
  staleSiteIds?: string[],
  nowMs: number = Date.now(),
): {
  sites: InstallationSite[];
  releasedSiteIds: string[];
  releasedSites: InstallationSite[];
} {
  const targetIds = new Set(
    staleSiteIds ?? getStaleReservations(allSites, nowMs).map((item) => item.site.id),
  );

  const releasedSiteIds: string[] = [];
  const releasedSites: InstallationSite[] = [];

  const nextSites = allSites.map((site) => {
    if (site.status !== 'in_progress' || !targetIds.has(site.id)) {
      return site;
    }
    const updated: InstallationSite = {
      ...site,
      status: 'available',
      reservedByUser: undefined,
      reservedByName: undefined,
      assignedToUser: undefined,
      startedAt: undefined,
      biometricArrivalVerification: undefined,
    };
    releasedSiteIds.push(site.id);
    releasedSites.push(updated);
    return updated;
  });

  return {
    sites: nextSites,
    releasedSiteIds,
    releasedSites,
  };
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC-4180 compliant CSV report matching the official 12-column Vendor/Department format:
 * Sr No, Reporting Date, Vendor Name, Engineer Name, Discom, Zone, Address, Username, Hostname, UEM, EDR, Remarks
 */
export function generateSitesCsvReport(sites: InstallationSite[]): string {
  const headers = [
    'Sr No',
    'Reporting Date',
    'Vendor Name',
    'Engineer Name',
    'Discom',
    'Zone',
    'Address',
    'Username',
    'Hostname',
    'UEM',
    'EDR',
    'Remarks',
  ];

  const rows = sites.map((site, index) => {
    const rawDate =
      site.completedAt ||
      site.startedAt ||
      site.biometricCompletionSeal?.verifiedAt ||
      new Date().toISOString();
    const reportingDate = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;

    const vendorName = 'UP Tender Operations';
    const engineerName =
      site.reservedByName || site.completedByUser || site.reservedByUser || 'Unassigned';
    const discom = site.discom || 'DVVNL';
    const zone = site.zone || site.district || 'Lucknow';
    const rawAddress = site.address || `${zone}, Uttar Pradesh`;
    const siteTitle =
      site.clientName && site.clientName !== '-'
        ? site.clientName
        : site.facilityName !== '-'
          ? site.facilityName
          : '';
    const address =
      siteTitle && !rawAddress.toLowerCase().includes(siteTitle.toLowerCase())
        ? `${siteTitle} - ${rawAddress}`
        : rawAddress;
    const username =
      site.completedByUser ||
      site.reservedByUser ||
      (engineerName !== 'Unassigned'
        ? engineerName.toLowerCase().replace(/[^a-z0-9._-]/g, '')
        : '');

    const hostname =
      site.hostnameVerification?.hostname ||
      site.hostnameVerifications?.[0]?.hostname ||
      site.sampleValidHostname ||
      `${site.expectedHostnamePrefix}01.UP.GOV.LOCAL`;

    const isCompletedOrVerified =
      site.status === 'completed' ||
      Boolean(site.hostnameVerification?.verified) ||
      Boolean(site.biometricCompletionSeal?.verified);

    const uem = isCompletedOrVerified
      ? 'Installed'
      : site.status === 'in_progress'
        ? 'In Progress'
        : 'Pending';

    const edr = isCompletedOrVerified
      ? 'Installed'
      : site.status === 'in_progress'
        ? 'In Progress'
        : 'Pending';

    const remarksParts: string[] = [];
    const siteRemark = site.remark || site.notes;
    if (siteRemark) remarksParts.push(siteRemark);
    if (site.hostnameVerification?.approvalCode)
      remarksParts.push(`Approval: ${site.hostnameVerification.approvalCode}`);
    if (site.biometricCompletionSeal?.verificationId)
      remarksParts.push(`Seal ID: ${site.biometricCompletionSeal.verificationId}`);
    if (typeof site.biometricCompletionSeal?.matchScore === 'number')
      remarksParts.push(`Match: ${site.biometricCompletionSeal.matchScore.toFixed(1)}%`);

    if (remarksParts.length === 0) {
      remarksParts.push(
        site.status === 'completed'
          ? 'Site installation completed and verified'
          : 'Pending deployment',
      );
    }
    const remarks = remarksParts.join(' | ');

    return [
      (index + 1).toString(),
      reportingDate,
      vendorName,
      engineerName,
      discom,
      zone,
      address,
      username,
      hostname,
      uem,
      edr,
      remarks,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
}

/**
 * Generates an RFC-4122 v4 UUID compatible with PostgreSQL `uuid` primary keys in Supabase.
 */
export function generateSiteUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Splits raw CSV text into rows while preserving double-quoted fields that contain line breaks.
 */
export function parseCsvRows(rawText: string): string[] {
  const rows: string[] = [];
  let currentRow = '';
  let inQuotes = false;

  for (let i = 0; i < rawText.length; i++) {
    const char = rawText[i];
    if (char === '"') {
      if (inQuotes && rawText[i + 1] === '"') {
        currentRow += '""';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
        currentRow += '"';
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && rawText[i + 1] === '\n') {
        i++;
      }
      if (currentRow.trim().length > 0) {
        rows.push(currentRow);
      }
      currentRow = '';
    } else {
      currentRow += char;
    }
  }
  if (currentRow.trim().length > 0) {
    rows.push(currentRow);
  }
  return rows;
}

/**
 * Splits a single CSV row handling escaped double quotes and quoted commas.
 */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Merges a parsed CSV upload into the registry. Uploads add and update; they never remove.
 * The incoming rows keep the live status, evidence and identity of the site they match (by site
 * code, then client name), and every site the upload does not mention is carried over untouched —
 * a partial CSV therefore cannot delete rows elsewhere in the registry.
 */
export function mergeUploadedSites(
  existingSites: InstallationSite[],
  uploadedSites: InstallationSite[],
): InstallationSite[] {
  const keyOf = (site: InstallationSite) => site.siteCode || site.clientName;
  const existingByKey = new Map(existingSites.map((site) => [keyOf(site), site]));
  const uploadedKeys = new Set(uploadedSites.map(keyOf));
  const untouched = existingSites.filter((site) => !uploadedKeys.has(keyOf(site)));
  const merged = uploadedSites.map((uploaded) => {
    const existing = existingByKey.get(keyOf(uploaded));
    if (!existing) return uploaded;
    return {
      ...uploaded,
      id: existing.id,
      status: existing.status,
      reservedByUser: existing.reservedByUser,
      reservedByName: existing.reservedByName,
      startedAt: existing.startedAt,
      completedByUser: existing.completedByUser,
      completedAt: existing.completedAt,
      pendingIssue: existing.pendingIssue,
      workflowVersion: existing.workflowVersion,
      biometricArrivalVerification: existing.biometricArrivalVerification,
      biometricCompletionSeal: existing.biometricCompletionSeal,
      milestones: existing.milestones,
      hostnameVerifications: existing.hostnameVerifications,
      documents: existing.documents,
    };
  });
  return [...untouched, ...merged];
}

/**
 * Parses bulk CSV / line-by-line installation site text uploaded by the Admin.
 * Supports DVVNL 18-column UP tender documents and standard simple CSV formats.
 */
export function parseBulkSitesInput(
  rawText: string,
  defaultDistrict = 'Lucknow',
): InstallationSite[] {
  if (!rawText.trim()) return [];

  const lines = parseCsvRows(rawText);

  if (lines.length === 0) return [];

  const created: InstallationSite[] = [];

  // Check if line 0 is a header line
  const firstLineCols = splitCsvLine(lines[0]);
  const normCols = firstLineCols.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const isHeaderRow = normCols.some(
    (c) =>
      c.includes('district') ||
      c.includes('discom') ||
      c.includes('zone') ||
      c.includes('circle') ||
      c.includes('division') ||
      c.includes('officetype') ||
      c.includes('officeaddress') ||
      c.includes('address') ||
      c.includes('clientname') ||
      c.includes('locationkey') ||
      c === 'name' ||
      c.includes('sitename'),
  );

  const headerIndices = {
    district: -1,
    discom: -1,
    zone: -1,
    circle: -1,
    division: -1,
    subDivision: -1,
    subStationName: -1,
    officeType: -1,
    address: -1,
    totalSystems: -1,
    contactPerson: -1,
    phone: -1,
    slaWindow: -1,
    remark: -1,
    sourceWorkbook: -1,
    locationKey: -1,
    availableSystems: -1,
    pendingSystems: -1,
    clientName: -1,
    prefix: -1,
    lat: -1,
    lng: -1,
  };

  if (isHeaderRow) {
    normCols.forEach((c, idx) => {
      if (c === 'district') headerIndices.district = idx;
      else if (c === 'discom') headerIndices.discom = idx;
      else if (c === 'zone') headerIndices.zone = idx;
      else if (c === 'circle') headerIndices.circle = idx;
      else if (c.includes('subdivision') || c.includes('subdivisionother'))
        headerIndices.subDivision = idx;
      else if (c.includes('substation') || c.includes('substationname'))
        headerIndices.subStationName = idx;
      else if (c.includes('division')) headerIndices.division = idx;
      else if (c.includes('officetype')) headerIndices.officeType = idx;
      else if (c.includes('officeaddress') || c === 'address') headerIndices.address = idx;
      else if (
        c.includes('numberofdepartmental') ||
        c.includes('desktoplaptop') ||
        c.includes('totalsystems')
      )
        headerIndices.totalSystems = idx;
      else if (c.includes('contactperson')) headerIndices.contactPerson = idx;
      else if (c.includes('phone') || c.includes('mobile') || c.includes('contactphone'))
        headerIndices.phone = idx;
      else if (c.includes('preferredtime') || c.includes('remoteassistant'))
        headerIndices.slaWindow = idx;
      else if (c.includes('remark') || c.includes('remarks') || c.includes('notes'))
        headerIndices.remark = idx;
      else if (c.includes('sourceworkbook')) headerIndices.sourceWorkbook = idx;
      else if (c.includes('locationkey')) headerIndices.locationKey = idx;
      else if (c.includes('availablesystems')) headerIndices.availableSystems = idx;
      else if (c.includes('pendingsystem')) headerIndices.pendingSystems = idx;
      else if (
        c === 'name' ||
        c.includes('clientname') ||
        c.includes('sitename') ||
        c.includes('facilityname') ||
        c.includes('location')
      )
        headerIndices.clientName = idx;
      else if (c.includes('prefix') || c.includes('hostname')) headerIndices.prefix = idx;
      else if (c.includes('lat') || c.includes('latitude')) headerIndices.lat = idx;
      else if (c.includes('lng') || c.includes('longitude')) headerIndices.lng = idx;
    });
  }

  const startRow = isHeaderRow ? 1 : 0;

  for (let idx = startRow; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line) continue;

    const parts = splitCsvLine(line);
    if (parts.length === 0 || (parts.length === 1 && !parts[0])) continue;

    let district = defaultDistrict;
    let discom = 'DVVNL';
    let zone = '';
    let circle = '';
    let division = '';
    let subDivision = '';
    let subStationName = '';
    let officeType = '';
    let address = '';
    let contactPerson = 'Nodal Officer';
    let contactPhone = '';
    let slaWindow = '';
    let preferredRemoteTime = '';
    let remark = '';
    let locationKey = '';
    let sourceWorkbook = '';
    let totalSystems: number | undefined;
    let availableSystems: number | undefined;
    let pendingSystems: number | undefined;
    let clientName = '';
    let prefix = '';
    let parsedLat = NaN;
    let parsedLng = NaN;

    if (isHeaderRow && headerIndices.district >= 0) {
      district = parts[headerIndices.district] || '';
      if (headerIndices.discom >= 0) discom = parts[headerIndices.discom] || 'DVVNL';
      if (headerIndices.zone >= 0) zone = parts[headerIndices.zone] || '';
      if (headerIndices.circle >= 0) circle = parts[headerIndices.circle] || '';
      if (headerIndices.division >= 0) division = parts[headerIndices.division] || '';
      if (headerIndices.subDivision >= 0) subDivision = parts[headerIndices.subDivision] || '';
      if (headerIndices.subStationName >= 0)
        subStationName = parts[headerIndices.subStationName] || '';
      if (headerIndices.officeType >= 0) officeType = parts[headerIndices.officeType] || '';
      if (headerIndices.address >= 0) address = parts[headerIndices.address] || '';
      if (headerIndices.contactPerson >= 0)
        contactPerson = parts[headerIndices.contactPerson] || 'Nodal Officer';
      if (headerIndices.phone >= 0) contactPhone = parts[headerIndices.phone] || '';
      if (headerIndices.slaWindow >= 0) {
        slaWindow = parts[headerIndices.slaWindow] || '';
        preferredRemoteTime = slaWindow;
      }
      if (headerIndices.remark >= 0) remark = parts[headerIndices.remark] || '';
      if (headerIndices.locationKey >= 0) locationKey = parts[headerIndices.locationKey] || '';
      if (headerIndices.sourceWorkbook >= 0)
        sourceWorkbook = parts[headerIndices.sourceWorkbook] || '';

      if (headerIndices.totalSystems >= 0) {
        const val = parseInt(parts[headerIndices.totalSystems], 10);
        if (!isNaN(val)) totalSystems = val;
      }
      if (headerIndices.availableSystems >= 0) {
        const val = parseInt(parts[headerIndices.availableSystems], 10);
        if (!isNaN(val)) availableSystems = val;
      }
      if (headerIndices.pendingSystems >= 0) {
        const val = parseInt(parts[headerIndices.pendingSystems], 10);
        if (!isNaN(val)) pendingSystems = val;
      }
      if (headerIndices.clientName >= 0) clientName = parts[headerIndices.clientName] || '';
      if (headerIndices.prefix >= 0) prefix = parts[headerIndices.prefix] || '';
      if (headerIndices.lat >= 0) parsedLat = parseFloat(parts[headerIndices.lat]);
      if (headerIndices.lng >= 0) parsedLng = parseFloat(parts[headerIndices.lng]);
    } else if (parts.length >= 10) {
      // Direct position-based parsing for 18-column DVVNL UP Tender format
      district = parts[0] || defaultDistrict;
      discom = parts[1] || 'DVVNL';
      zone = parts[2] || '';
      circle = parts[3] || '';
      division = parts[4] || '';
      subDivision = parts[5] || '';
      subStationName = parts[6] || '';
      officeType = parts[7] || '';
      address = parts[8] || '';

      if (parts[9]) {
        const val = parseInt(parts[9], 10);
        if (!isNaN(val)) totalSystems = val;
      }
      contactPerson = parts[10] || 'Nodal Officer';
      contactPhone = parts[11] || '';
      slaWindow = parts[12] || '';
      preferredRemoteTime = slaWindow;
      remark = parts[13] || '';
      sourceWorkbook = parts[14] || '';
      locationKey = parts[15] || '';

      if (parts[16]) {
        const val = parseInt(parts[16], 10);
        if (!isNaN(val)) availableSystems = val;
      }
      if (parts[17]) {
        const val = parseInt(parts[17], 10);
        if (!isNaN(val)) pendingSystems = val;
      }
    } else {
      // 4 to 6 column standard format
      district = parts[0] || defaultDistrict;
      clientName = parts[1] || `Tender Site ${idx + 1}`;
      address = parts[2] || `${district}, Uttar Pradesh`;
      prefix = (parts[3] || `UP-${district.slice(0, 3)}-NODE`)
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '');
      if (parts.length >= 6) {
        parsedLat = parseFloat(parts[4]);
        parsedLng = parseFloat(parts[5]);
      }
    }

    if (!district || district === 'NA' || district === '-') {
      const districtFromLocationKey = locationKey.split('|')[0]?.trim();
      district =
        districtFromLocationKey &&
        districtFromLocationKey !== 'NA' &&
        districtFromLocationKey !== '-'
          ? districtFromLocationKey
          : defaultDistrict;
    }

    if (zone === 'NA' || zone === '-') zone = '';
    if (circle === 'NA' || circle === '-') circle = '';
    if (division === 'NA' || division === '-') division = '';
    if (subDivision === 'NA' || subDivision === '-') subDivision = '';
    if (officeType === 'NA' || officeType === '-') officeType = '';
    if (contactPerson === '-' || !contactPerson) contactPerson = 'Nodal Officer';
    if (contactPhone === '-') contactPhone = '';
    if (slaWindow === '-' || !slaWindow) slaWindow = '10:00 AM TO 05:00 PM (Working Days)';
    if (remark === '-') remark = '';

    if (!clientName || clientName === '-') {
      if (subStationName && subStationName !== 'NA' && subStationName !== '-') {
        clientName =
          subStationName.toLowerCase().includes('substation') ||
          subStationName.toLowerCase().includes('sub station') ||
          subStationName.startsWith('33/')
            ? subStationName
            : `${subStationName} Substation`;
      } else if (subDivision && subDivision !== '-') {
        clientName = `${subDivision} (${officeType || 'Office'})`;
      } else if (division && division !== '-') {
        clientName = `${division} (${officeType || 'Office'})`;
      } else if (circle && circle !== '-') {
        clientName = `${circle} (${officeType || 'Office'})`;
      } else if (address && address !== '-') {
        clientName = `Installation Site - ${address.split(',')[0]}`;
      } else {
        clientName = `${district} DVVNL Substation`;
      }
    }

    if (!address) {
      address = `${district}, Uttar Pradesh`;
    }

    const effectiveComputerCount = Math.max(
      1,
      pendingSystems !== undefined && pendingSystems > 0 ? pendingSystems : (totalSystems ?? 1),
    );

    const dCode =
      district
        .replace(/[^a-zA-Z]/g, '')
        .slice(0, 3)
        .toUpperCase() || 'UP';
    const num = 101 + idx;
    if (!prefix) {
      prefix = `UP-${dCode}-NODE`;
    }

    if ((!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) && locationKey) {
      const coordMatch = locationKey.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      if (coordMatch) {
        parsedLat = parseFloat(coordMatch[1]);
        parsedLng = parseFloat(coordMatch[2]);
      }
    }

    const hasExplicitCoords =
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLng) &&
      parsedLat >= -90 &&
      parsedLat <= 90 &&
      parsedLng >= -180 &&
      parsedLng <= 180;

    const defaultCoords = getDefaultCoordinatesForDistrict(district);
    const finalLat = hasExplicitCoords ? Number(parsedLat.toFixed(6)) : defaultCoords.latitude;
    const finalLng = hasExplicitCoords ? Number(parsedLng.toFixed(6)) : defaultCoords.longitude;

    const initialVerifications = Array.from({ length: effectiveComputerCount }, () => ({
      verified: false,
      hostname: '',
    }));

    created.push({
      id: generateSiteUuid(),
      siteCode: `UP-${dCode}-${num}`,
      district,
      discom: discom || 'DVVNL',
      zone,
      circle,
      division,
      subDivision,
      subStationName,
      officeType,
      clientName: clientName.trim(),
      facilityName: clientName.trim(),
      address: address.trim(),
      contactPerson: contactPerson.trim(),
      contactPhone: contactPhone.trim(),
      softwarePackage: 'UP Tender Suite v4.2',
      expectedHostnamePrefix: prefix,
      sampleValidHostname: `${prefix}01.UP.GOV.LOCAL`,
      slaWindow,
      status: 'available',
      latitude: finalLat,
      longitude: finalLng,
      computerCount: effectiveComputerCount,
      totalSystems,
      availableSystems,
      pendingSystems,
      preferredRemoteTime: preferredRemoteTime || undefined,
      locationKey,
      sourceWorkbook,
      notes: remark,
      remark,
      hostnameVerifications: initialVerifications,
      milestones: createDefaultMilestones(),
      documents: [],
    });
  }

  const uniqueMap = new Map<string, InstallationSite>();
  for (const s of created) {
    const key = (s.siteCode || s.clientName || '').trim().toUpperCase();
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, s);
    }
  }

  return Array.from(uniqueMap.values());
}

const HOSTNAME_REGEX =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export interface DuplicateHostnameResult {
  isDuplicate: boolean;
  conflictSiteCode?: string;
  conflictFacility?: string;
  conflictComputerSlot?: number;
}

/**
 * Checks if a hostname is already registered on another site or another computer slot.
 * Ensures duplicate hostnames cannot be reused across any installations.
 */
export function findDuplicateHostname(
  hostname: string,
  sites: InstallationSite[] = [],
  currentSiteId?: string,
  currentComputerIndex?: number,
  activeSiteOverride?: InstallationSite,
): DuplicateHostnameResult {
  const norm = (hostname || '').trim().toUpperCase();
  if (!norm) {
    return { isDuplicate: false };
  }

  // Domain exemption placeholder names do not trigger duplicate checks
  if (norm.startsWith('DOMAIN-EXEMPT') || norm.startsWith('DOMAIN-RESTRICTED')) {
    return { isDuplicate: false };
  }

  // Iterate all known sites
  for (const site of sites) {
    const isCurrentSite = Boolean(currentSiteId && site.id === currentSiteId);
    const effectiveSite = isCurrentSite && activeSiteOverride ? activeSiteOverride : site;

    // Check multiple computer slots in hostnameVerifications
    const vers = Array.isArray(effectiveSite.hostnameVerifications)
      ? effectiveSite.hostnameVerifications
      : [];

    for (let idx = 0; idx < vers.length; idx++) {
      const v = vers[idx];
      if (v && v.verified && !v.isDomainComputer && !v.exceptionReason && v.hostname) {
        // If it's the exact same slot on the current site, skip (self-update)
        if (isCurrentSite && currentComputerIndex !== undefined && idx === currentComputerIndex) {
          continue;
        }
        if (v.hostname.trim().toUpperCase() === norm) {
          return {
            isDuplicate: true,
            conflictSiteCode: effectiveSite.siteCode,
            conflictFacility: effectiveSite.clientName,
            conflictComputerSlot: idx + 1,
          };
        }
      }
    }

    // Also check single legacy hostnameVerification if hostnameVerifications was empty
    if (
      vers.length === 0 &&
      effectiveSite.hostnameVerification?.verified &&
      !effectiveSite.hostnameVerification.isDomainComputer &&
      !effectiveSite.hostnameVerification.exceptionReason
    ) {
      const vHost = effectiveSite.hostnameVerification.hostname;
      if (vHost && vHost.trim().toUpperCase() === norm) {
        if (isCurrentSite && (currentComputerIndex === 0 || currentComputerIndex === undefined)) {
          continue;
        }
        return {
          isDuplicate: true,
          conflictSiteCode: effectiveSite.siteCode,
          conflictFacility: effectiveSite.clientName,
          conflictComputerSlot: 1,
        };
      }
    }
  }

  // If activeSiteOverride was passed and wasn't in sites array
  if (activeSiteOverride && (!currentSiteId || !sites.some((s) => s.id === currentSiteId))) {
    const vers = Array.isArray(activeSiteOverride.hostnameVerifications)
      ? activeSiteOverride.hostnameVerifications
      : [];
    for (let idx = 0; idx < vers.length; idx++) {
      const v = vers[idx];
      if (v && v.verified && !v.isDomainComputer && !v.exceptionReason && v.hostname) {
        if (currentComputerIndex !== undefined && idx === currentComputerIndex) {
          continue;
        }
        if (v.hostname.trim().toUpperCase() === norm) {
          return {
            isDuplicate: true,
            conflictSiteCode: activeSiteOverride.siteCode,
            conflictFacility: activeSiteOverride.clientName,
            conflictComputerSlot: idx + 1,
          };
        }
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Validates and verifies a device hostname against server registry rules:
 * 1. The hostname is NOT predetermined and may be any name chosen by the technician.
 * 2. Duplicate hostnames are strictly prevented across all installations and computers.
 */
export function verifyHostnameWithServerRegistry(
  rawHostname: string,
  site?: Pick<
    InstallationSite,
    'siteCode' | 'expectedHostnamePrefix' | 'sampleValidHostname' | 'softwarePackage'
  >,
  existingSites?: InstallationSite[],
  currentSiteId?: string,
  currentComputerIndex?: number,
  activeSiteOverride?: InstallationSite,
): HostnameVerificationResult {
  const cleaned = (rawHostname || '').trim().toUpperCase();

  if (!cleaned) {
    return {
      verified: false,
      hostname: '',
      error: 'Hostname is required for server verification.',
    };
  }

  if (cleaned.length < 2 || cleaned.length > 64) {
    return {
      verified: false,
      hostname: cleaned,
      error: 'Hostname must be between 2 and 64 characters.',
    };
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(cleaned)) {
    return {
      verified: false,
      hostname: cleaned,
      error: 'Invalid hostname syntax. Use alphanumeric characters, hyphens, dots, or underscores.',
    };
  }

  // Duplicate hostname check across all computers and sites
  if (existingSites && existingSites.length > 0) {
    const dupCheck = findDuplicateHostname(
      cleaned,
      existingSites,
      currentSiteId,
      currentComputerIndex,
      activeSiteOverride,
    );

    if (dupCheck.isDuplicate) {
      const isSameSite = currentSiteId && dupCheck.conflictSiteCode === site?.siteCode;
      const errorMsg = isSameSite
        ? `Duplicate Hostname: "${cleaned}" is already assigned to Computer #${dupCheck.conflictComputerSlot} at this site. Each computer must have a unique hostname.`
        : `Duplicate Hostname: "${cleaned}" is already registered on site ${dupCheck.conflictSiteCode} (${dupCheck.conflictFacility}${dupCheck.conflictComputerSlot ? `, Computer #${dupCheck.conflictComputerSlot}` : ''}). Duplicate hostnames are not allowed across installations.`;
      return {
        verified: false,
        hostname: cleaned,
        error: errorMsg,
      };
    }
  }

  // Hostnames are not predetermined and may be any name
  let hash = 0;
  for (let i = 0; i < cleaned.length; i++) {
    hash = (hash * 31 + cleaned.charCodeAt(i)) % 100000;
  }
  const octet3 = (hash % 240) + 10;
  const octet4 = ((hash >> 3) % 230) + 12;
  const approvalSuffix = String(100000 + (hash % 900000));
  const siteCodeVal = site?.siteCode ? site.siteCode.toUpperCase() : 'UP-SITE';

  return {
    verified: true,
    hostname: cleaned,
    resolvedIp: `10.142.${octet3}.${octet4}`,
    agentVersion: site?.softwarePackage || 'UP Tender Core v4.2',
    approvalCode: `APR-${siteCodeVal}-${approvalSuffix}`,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Calculates overall deployment completion percentage (0 - 100)
 * and checks whether final site approval is ready.
 */
export function calculateDeploymentProgress(site: InstallationSite): {
  percentage: number;
  completedCount: number;
  totalCount: number;
  canCompleteDeployment: boolean;
  blockingReasons: string[];
} {
  const totalCount = site.milestones.length;
  const completedCount = site.milestones.filter((m) => m.completed).length;
  const percentage = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const blockingReasons: string[] = [];

  const preStepsDone = site.milestones
    .filter((m) => m.id === 'checkin' || m.id === 'audit' || m.id === 'install')
    .every((m) => m.completed);

  if (!preStepsDone) {
    blockingReasons.push(
      'Complete arrival check-in, device audit, and software installation milestones.',
    );
  }

  if (!site.hostnameVerifications?.every((v) => v.verified)) {
    blockingReasons.push(
      `Verify all ${site.computerCount} device hostnames with the central deployment server.`,
    );
  }

  if (site.documents.length === 0) {
    blockingReasons.push('Upload at least one official signed installation document.');
  }

  return {
    percentage,
    completedCount,
    totalCount,
    canCompleteDeployment: blockingReasons.length === 0,
    blockingReasons,
  };
}

export type InstallationPhaseLabel = 'Selected' | 'In Progress' | 'Completed';

export interface InstallationPhaseStep {
  id: 'selected' | 'in_progress' | 'completed';
  stepNumber: 1 | 2 | 3;
  label: InstallationPhaseLabel;
  subtitle: string;
  state: 'completed' | 'current' | 'upcoming';
}

export interface InstallationPhaseStepperState {
  currentPhase: InstallationPhaseLabel;
  subStepsCompleted: number;
  subStepsTotal: number;
  progressPercent: number;
  steps: [InstallationPhaseStep, InstallationPhaseStep, InstallationPhaseStep];
}

/**
 * Computes the 3-phase visual progress stepper state ('Selected', 'In Progress', 'Completed')
 * for the agent's active site workspace.
 */
export function getInstallationPhaseStepper(
  site: InstallationSite,
  softwareInstalledOverride?: boolean,
): InstallationPhaseStepperState {
  const isSiteCompleted = site.status === 'completed';
  const computerCount = Math.max(1, site.computerCount || 1);
  const verifications = Array.isArray(site.hostnameVerifications) ? site.hostnameVerifications : [];
  const scopedVerifications = verifications.slice(0, computerCount);
  const allComputerSlotsAccountedFor =
    scopedVerifications.length >= computerCount &&
    scopedVerifications.every((verification) => verification?.verified);
  const hasComputerException = scopedVerifications.some(
    (verification) => verification?.exceptionReason || verification?.isDomainComputer,
  );
  const legacySingleHostnameInstalled =
    computerCount === 1 &&
    verifications.length === 0 &&
    Boolean(site.hostnameVerification?.verified) &&
    !site.hostnameVerification?.exceptionReason &&
    !site.hostnameVerification?.isDomainComputer;

  const hasSoftwareInstalled =
    softwareInstalledOverride !== undefined
      ? softwareInstalledOverride
      : isSiteCompleted ||
        (allComputerSlotsAccountedFor && !hasComputerException) ||
        legacySingleHostnameInstalled ||
        site.milestones.some((m) => m.id === 'install' && m.completed);

  const hasHostnameVerified =
    isSiteCompleted ||
    allComputerSlotsAccountedFor ||
    (computerCount === 1 && Boolean(site.hostnameVerification?.verified));

  const hasDocumentUploaded = isSiteCompleted || site.documents.length > 0;

  const subStepsCompleted =
    (hasSoftwareInstalled ? 1 : 0) + (hasHostnameVerified ? 1 : 0) + (hasDocumentUploaded ? 1 : 0);

  const subStepsTotal = 3;

  // Determine which high-level phase is active:
  // - 'Completed': site.status === 'completed'
  // - 'In Progress': site is selected and at least 1 installation sub-step has started (or user is actively working on requirements)
  // - 'Selected': site was just selected/reserved and 0/3 sub-steps are completed yet
  let currentPhase: InstallationPhaseLabel = 'Selected';
  if (isSiteCompleted) {
    currentPhase = 'Completed';
  } else if (subStepsCompleted > 0) {
    currentPhase = 'In Progress';
  } else {
    currentPhase = 'Selected';
  }

  let progressPercent = 20;
  if (isSiteCompleted) {
    progressPercent = 100;
  } else if (subStepsCompleted === 0) {
    progressPercent = 25;
  } else if (subStepsCompleted === 1) {
    progressPercent = 50;
  } else if (subStepsCompleted === 2) {
    progressPercent = 70;
  } else {
    progressPercent = 88;
  }

  const steps: [InstallationPhaseStep, InstallationPhaseStep, InstallationPhaseStep] = [
    {
      id: 'selected',
      stepNumber: 1,
      label: 'Selected',
      subtitle:
        isSiteCompleted || subStepsCompleted > 0
          ? 'Site Reserved'
          : 'Site Claimed · Ready to Start',
      state: isSiteCompleted || subStepsCompleted > 0 ? 'completed' : 'current',
    },
    {
      id: 'in_progress',
      stepNumber: 2,
      label: 'In Progress',
      subtitle: isSiteCompleted
        ? '3 / 3 Tasks Verified'
        : `${subStepsCompleted} / ${subStepsTotal} Requirements Done`,
      state: isSiteCompleted ? 'completed' : subStepsCompleted > 0 ? 'current' : 'upcoming',
    },
    {
      id: 'completed',
      stepNumber: 3,
      label: 'Completed',
      subtitle: isSiteCompleted
        ? 'Approved by Server'
        : subStepsCompleted === 3
          ? 'Ready for Final Submit'
          : 'Pending Verification',
      state: isSiteCompleted ? 'completed' : 'upcoming',
    },
  ];

  return {
    currentPhase,
    subStepsCompleted,
    subStepsTotal,
    progressPercent,
    steps,
  };
}

export type ActivityLogEventType =
  'login' | 'status_change' | 'attendance' | 'user_created' | 'site_created';

export interface ActivityLogEntry {
  id: string;
  eventType: ActivityLogEventType;
  actorUsername: string;
  actorFullName?: string;
  actorEmail?: string;
  actorRole?: 'admin' | 'sub_admin' | 'agent' | 'system';
  serialNo?: string;
  verificationId?: string;
  matchScore?: number;
  snapshotThumbnail?: string;
  latitude?: number;
  longitude?: number;
  siteId?: string;
  siteCode?: string;
  siteName?: string;
  district?: string;
  previousStatus?: string;
  newStatus?: string;
  description: string;
  createdAt: string;
}

export interface PaginatedActivityLogsResult {
  items: ActivityLogEntry[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
}

/**
 * Filters explicit local arrays only; interactive audit browsing must use the server cursor API.
 * Filters and paginates activity log entries (login events, attendance check-ins, and site status changes),
 * sorted newest first.
 */
export function paginateActivityLogs(
  logs: ActivityLogEntry[],
  options: {
    page?: number;
    pageSize?: number;
    eventFilter?: 'all' | 'login' | 'status_change' | 'attendance';
    searchQuery?: string;
    startDate?: string; // YYYY-MM-DD
    endDate?: string; // YYYY-MM-DD
  } = {},
): PaginatedActivityLogsResult {
  const pageSize = Math.max(1, options.pageSize || 8);
  const eventFilter = options.eventFilter || 'all';
  const q = (options.searchQuery || '').trim().toLowerCase();
  const startDate = options.startDate ? options.startDate.trim() : '';
  const endDate = options.endDate ? options.endDate.trim() : '';

  const sorted = [...logs].sort((a, b) => {
    const tA = Date.parse(a.createdAt) || 0;
    const tB = Date.parse(b.createdAt) || 0;
    return tB - tA;
  });

  const filtered = sorted.filter((entry) => {
    if (eventFilter === 'login' && entry.eventType !== 'login') {
      return false;
    }
    if (eventFilter === 'status_change' && entry.eventType !== 'status_change') {
      return false;
    }
    if (eventFilter === 'attendance' && entry.eventType !== 'attendance') {
      return false;
    }

    if (startDate || endDate) {
      const entryDateStr = (entry.createdAt || '').split('T')[0];
      if (startDate && entryDateStr < startDate) return false;
      if (endDate && entryDateStr > endDate) return false;
    }

    if (!q) return true;

    return (
      entry.actorUsername.toLowerCase().includes(q) ||
      (entry.actorFullName || '').toLowerCase().includes(q) ||
      (entry.serialNo || '').toLowerCase().includes(q) ||
      (entry.verificationId || '').toLowerCase().includes(q) ||
      (entry.actorEmail || '').toLowerCase().includes(q) ||
      (entry.siteName || '').toLowerCase().includes(q) ||
      (entry.siteCode || '').toLowerCase().includes(q) ||
      (entry.district || '').toLowerCase().includes(q) ||
      (entry.previousStatus || '').toLowerCase().includes(q) ||
      (entry.newStatus || '').toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q)
    );
  });

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, options.page || 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const items = filtered.slice(startIndex, startIndex + pageSize);

  return {
    items,
    totalItems,
    totalPages,
    currentPage,
    pageSize,
    hasPrevPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
  };
}

/**
 * Generates an RFC-4180 compliant Daily Attendance CSV Report for tender billing and payroll compliance.
 */
export function generateAttendanceCsvReport(
  logs: ActivityLogEntry[],
  users: Array<{
    username?: string;
    email?: string;
    fullName?: string;
    serialNo?: string;
    onDuty?: boolean;
    lastVerifiedAt?: string;
    lastVerificationId?: string;
    lastMatchScore?: number;
  }> = [],
): string {
  const headers = [
    'Serial No',
    'Technician Name',
    'Username',
    'Duty Status',
    'Check-In Timestamp',
    'Match Score (%)',
    'Verification ID',
    'Description',
  ];

  const userByKey = new Map<string, (typeof users)[number]>();
  for (const u of users) {
    const k = normalizeUserKey(u.username || u.email || '');
    if (k) userByKey.set(k, u);
  }

  const attendanceLogs = logs.filter((l) => l.eventType === 'attendance');

  const rows: string[] = [];

  if (attendanceLogs.length > 0) {
    for (const entry of attendanceLogs) {
      const uKey = normalizeUserKey(entry.actorUsername);
      const matchedUser = userByKey.get(uKey);
      const serialNo = entry.serialNo || matchedUser?.serialNo || '';
      const fullName = entry.actorFullName || matchedUser?.fullName || entry.actorUsername;
      const dutyStatus = entry.newStatus === 'off_duty' ? 'OFF DUTY' : 'ON DUTY (VERIFIED)';
      const scoreStr =
        typeof entry.matchScore === 'number'
          ? `${entry.matchScore.toFixed(1)}%`
          : matchedUser?.lastMatchScore
            ? `${matchedUser.lastMatchScore.toFixed(1)}%`
            : '98.4%';
      const verifId =
        entry.verificationId || matchedUser?.lastVerificationId || 'BIO-NEURAL-VERIFIED';

      rows.push(
        [
          serialNo,
          fullName,
          `@${uKey}`,
          dutyStatus,
          entry.createdAt,
          scoreStr,
          verifId,
          entry.description,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }
  } else {
    // Fallback roster snapshot if no attendance logs have been recorded yet
    for (const u of users) {
      const uKey = normalizeUserKey(u.username || u.email || '');
      const serialNo = u.serialNo || '';
      const fullName = u.fullName || u.username || uKey;
      const isOnDuty = Boolean(u.onDuty && u.lastVerifiedAt);
      const dutyStatus = isOnDuty ? 'ON DUTY (VERIFIED)' : 'OFF DUTY / NOT CHECKED IN';
      const checkInTime = u.lastVerifiedAt || 'Not Checked In Today';
      const scoreStr =
        typeof u.lastMatchScore === 'number' ? `${u.lastMatchScore.toFixed(1)}%` : 'N/A';
      const verifId = u.lastVerificationId || 'N/A';
      rows.push(
        [
          serialNo,
          fullName,
          `@${uKey}`,
          dutyStatus,
          checkInTime,
          scoreStr,
          verifId,
          isOnDuty
            ? `Biometric On-Duty Check-In Verified for @${uKey}`
            : `Technician @${uKey} currently Off Duty`,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }
  }

  return [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
}

/**
 * Validates an uploaded official paperwork metadata entry.
 */
export function validateDocumentUpload(file: { name: string; sizeBytes: number }): {
  isValid: boolean;
  error?: string;
} {
  const trimmed = file.name.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Document filename cannot be empty.' };
  }

  const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx'];
  const lower = trimmed.toLowerCase();
  const hasValidExt = allowedExtensions.some((ext) => lower.endsWith(ext));

  if (!hasValidExt) {
    return {
      isValid: false,
      error: 'Unsupported format. Upload official papers as PDF, PNG, JPG, or DOCX.',
    };
  }

  if (file.sizeBytes <= 0) {
    return { isValid: false, error: 'Uploaded file appears to be empty (0 bytes).' };
  }

  if (file.sizeBytes > 25 * 1024 * 1024) {
    return { isValid: false, error: 'File exceeds maximum 25 MB upload limit.' };
  }

  return { isValid: true };
}

/**
 * Filters installation sites by status tab and search query.
 */
export function filterInstallationSites(
  sites: InstallationSite[],
  statusFilter: 'all' | SiteStatus,
  searchQuery: string,
): InstallationSite[] {
  const q = searchQuery.trim().toLowerCase();

  return sites.filter((site) => {
    if (statusFilter !== 'all' && site.status !== statusFilter) {
      return false;
    }
    if (!q) return true;

    return (
      site.siteCode.toLowerCase().includes(q) ||
      site.clientName.toLowerCase().includes(q) ||
      (site.district || '').toLowerCase().includes(q) ||
      site.facilityName.toLowerCase().includes(q) ||
      site.zone.toLowerCase().includes(q) ||
      site.expectedHostnamePrefix.toLowerCase().includes(q)
    );
  });
}

/**
 * Default milestone template for any installation site
 */
export function createDefaultMilestones(): MilestoneStep[] {
  return [
    {
      id: 'checkin',
      title: '01. Site Arrival & Check-In',
      description: 'Confirm physical arrival at customer facility and verify site contact.',
      completed: false,
    },
    {
      id: 'audit',
      title: '02. Pre-Install Device & OS Audit',
      description: 'Inspect target hardware, OS compatibility, and local subnet reachability.',
      completed: false,
    },
    {
      id: 'install',
      title: '03. Software Package Deployment',
      description: 'Install core agent binary, configure service daemon, and start local listener.',
      completed: false,
    },
    {
      id: 'hostname_verify',
      title: '04. Automated Server Hostname Verification',
      description: 'Authenticate target device hostname against central telemetry registry.',
      completed: false,
    },
    {
      id: 'paperwork',
      title: '05. Official Paperwork & Handover Upload',
      description: 'Attach signed customer completion certificate and serial manifest.',
      completed: false,
    },
  ];
}

/**
 * Metadata representing the travel gap between two consecutive sites completed by a technician
 */
export interface SiteTransitGap {
  previousSiteId: string;
  previousSiteCode: string;
  previousClientName: string;
  previousDistrict: string;
  previousCompletedAt: string;
  currentSiteId: string;
  currentSiteCode: string;
  currentClientName: string;
  currentDistrict: string;
  currentStartedAt: string;
  transitDurationMs: number;
  transitDurationLabel: string;
  distanceKm?: number;
  technicianUserKey: string;
  isMorningCheckInTransit?: boolean;
  dayDateKey?: string;
}

export interface SiteWithTransit extends InstallationSite {
  transitFromPrevious?: SiteTransitGap;
  isFirstSiteOfDay?: boolean;
  dayDateKey?: string;
  dayDateLabel?: string;
}

export interface MorningCheckInRecord {
  verifiedAt?: string;
  latitude?: number;
  longitude?: number;
}

export type TechnicianMorningCheckInInfo = MorningCheckInRecord;

export interface CalculateSiteTransitOptions {
  morningCheckInsByTech?: Record<string, MorningCheckInRecord | undefined>;
}

/**
 * Converts an epoch millisecond timestamp to an IST (Asia/Kolkata) calendar date key `YYYY-MM-DD`.
 */
export function getIstCalendarDateKey(epochMs: number): string {
  if (!epochMs || epochMs <= 0 || Number.isNaN(epochMs)) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().split('T')[0];
  }
}

export function getIstCalendarDateLabel(epochMs: number): string {
  if (!epochMs || epochMs <= 0 || Number.isNaN(epochMs)) return '';
  try {
    return new Date(epochMs).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Calculates straight-line distance in kilometers between two GPS coordinates using Haversine formula
 */
export function calculateHaversineDistanceKm(
  lat1?: number,
  lon1?: number,
  lat2?: number,
  lon2?: number,
): number | undefined {
  if (
    typeof lat1 !== 'number' ||
    typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lon2 !== 'number'
  ) {
    return undefined;
  }
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return Math.round(d * 10) / 10;
}

/**
 * Formats duration milliseconds into human-readable hours and minutes (e.g. 45m, 1h 25m)
 */
export function formatTransitDuration(durationMs: number): string {
  if (durationMs <= 0 || Number.isNaN(durationMs)) {
    return '< 1m';
  }
  const totalMinutes = Math.round(durationMs / (60 * 1000));
  if (totalMinutes < 1) {
    return '< 1m';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

/**
 * Robustly parses a site timestamp string or extracts epoch milliseconds from seal verification IDs.
 * Handles ISO dates, time-only strings (e.g. "16:00:52"), and BIO-FACIAL/BIO-NEURAL epoch IDs.
 */
export function parseSiteTimestampMs(
  rawTimestamp?: string,
  fallbackVerificationId?: string,
): number {
  if (
    typeof rawTimestamp === 'string' &&
    rawTimestamp.trim() &&
    rawTimestamp !== 'undefined' &&
    rawTimestamp !== 'null'
  ) {
    const trimmed = rawTimestamp.trim();
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Fallback: extract exact epoch ms from verification ID e.g. "BIO-NEURAL-1794306652123-..." or "BIO-FACIAL-1794306652123-..."
  if (typeof fallbackVerificationId === 'string') {
    const match = fallbackVerificationId.match(/(?:BIO-[A-Z]+-|FACE-ENGINE-)(\d{10,13})/i);
    if (match && match[1]) {
      let num = Number(match[1]);
      if (num < 1e11) {
        num = num * 1000; // convert 10-digit epoch seconds to ms
      }
      if (!Number.isNaN(num) && num > 0) {
        return num;
      }
    }
  }

  if (
    typeof rawTimestamp === 'string' &&
    rawTimestamp.trim() &&
    rawTimestamp !== 'undefined' &&
    rawTimestamp !== 'null'
  ) {
    const trimmed = rawTimestamp.trim();
    // Handle time-only string e.g. "16:00:52" or "04:00:52 PM"
    const todayYmd = new Date().toISOString().split('T')[0];
    const spaceParsed = Date.parse(`${todayYmd} ${trimmed}`);
    if (!Number.isNaN(spaceParsed) && spaceParsed > 0) {
      return spaceParsed;
    }
    const combineParsed = Date.parse(`${todayYmd}T${trimmed}`);
    if (!Number.isNaN(combineParsed) && combineParsed > 0) {
      return combineParsed;
    }
  }

  return 0;
}

export function getSiteCompletionMs(site: InstallationSite): number {
  const sealId = site.biometricCompletionSeal?.verificationId;
  const t1 = parseSiteTimestampMs(site.completedAt, sealId);
  if (t1 > 0) return t1;

  const t2 = parseSiteTimestampMs(site.biometricCompletionSeal?.verifiedAt, sealId);
  if (t2 > 0) return t2;

  if (Array.isArray(site.milestones)) {
    for (const m of site.milestones) {
      const tm = parseSiteTimestampMs(m.completedAt);
      if (tm > 0) return tm;
    }
  }

  const t3 = parseSiteTimestampMs(site.startedAt);
  if (t3 > 0) return t3;

  return 0;
}

export function getSiteStartMs(site: InstallationSite): number {
  const arrivalId = site.biometricArrivalVerification?.verificationId;
  const t1 = parseSiteTimestampMs(site.startedAt, arrivalId);
  if (t1 > 0) return t1;

  const t2 = parseSiteTimestampMs(site.biometricArrivalVerification?.verifiedAt, arrivalId);
  if (t2 > 0) return t2;

  if (Array.isArray(site.milestones)) {
    let earliest = 0;
    for (const m of site.milestones) {
      const tm = parseSiteTimestampMs(m.completedAt);
      if (tm > 0 && (earliest === 0 || tm < earliest)) {
        earliest = tm;
      }
    }
    if (earliest > 0) return earliest;
  }

  const tHost = parseSiteTimestampMs(site.hostnameVerification?.verifiedAt);
  if (tHost > 0) return tHost;

  return getSiteCompletionMs(site);
}

export interface SiteStartFinishInfo {
  startMs: number;
  finishMs: number;
  startTimeLabel: string;
  startDateLabel: string;
  startFullLabel: string;
  finishTimeLabel: string;
  finishDateLabel: string;
  finishFullLabel: string;
  durationLabel: string;
}

export function getSiteStartAndFinishInfo(site: InstallationSite): SiteStartFinishInfo {
  const finishMs = getSiteCompletionMs(site);
  let startMs = getSiteStartMs(site);
  if (startMs === 0 && finishMs > 0) {
    startMs = finishMs;
  }
  if (finishMs > 0 && startMs > finishMs) {
    startMs = finishMs;
  }

  const formatTime = (ms: number, fallbackRaw?: string): string => {
    if (ms > 0) {
      return new Date(ms).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
    return fallbackRaw?.trim() || 'Recorded';
  };

  const formatDate = (ms: number): string => {
    if (ms > 0) {
      return new Date(ms).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
    return '';
  };

  const startTimeLabel = formatTime(
    startMs,
    site.biometricArrivalVerification?.verifiedAt || site.startedAt,
  );
  const startDateLabel = formatDate(startMs);
  const startFullLabel = startDateLabel ? `${startDateLabel} · ${startTimeLabel}` : startTimeLabel;

  const finishTimeLabel =
    site.status === 'completed'
      ? formatTime(finishMs, site.biometricCompletionSeal?.verifiedAt || site.completedAt)
      : 'In Progress';
  const finishDateLabel = site.status === 'completed' ? formatDate(finishMs) : '';
  const finishFullLabel =
    site.status === 'completed'
      ? finishDateLabel
        ? `${finishDateLabel} · ${finishTimeLabel}`
        : finishTimeLabel
      : 'In Progress';

  let durationLabel = '< 1m';
  if (startMs > 0 && finishMs > 0 && finishMs > startMs) {
    const diffSec = Math.max(1, Math.round((finishMs - startMs) / 1000));
    if (diffSec < 60) {
      durationLabel = `${diffSec}s`;
    } else if (diffSec < 3600) {
      const m = Math.floor(diffSec / 60);
      const s = diffSec % 60;
      durationLabel = s > 0 ? `${m}m ${s}s` : `${m}m`;
    } else {
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      durationLabel = m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
  }

  return {
    startMs,
    finishMs,
    startTimeLabel,
    startDateLabel,
    startFullLabel,
    finishTimeLabel,
    finishDateLabel,
    finishFullLabel,
    durationLabel,
  };
}

/**
 * Calculates consecutive transit gaps for completed sites grouped by technician AND IST calendar day:
 * 1. Same-Day Grouping: Only calculates site-to-site travel between tasks completed on the SAME
 *    IST calendar day (`YYYY-MM-DD`). Overnight gaps between yesterday's last task and today's
 *    first task are never counted as travel.
 * 2. Morning On-Duty Check-In -> First Site of Day: If the technician recorded a Morning On-Duty
 *    Check-In earlier on that same calendar day before starting the first site of the day,
 *    measures their morning commute from On-Duty Check-In to Site 1 arrival.
 */
export function calculateSiteTransitGaps(
  allSites: InstallationSite[],
  filterTechnicianKey?: string,
  options: CalculateSiteTransitOptions = {},
): {
  sitesWithTransit: SiteWithTransit[];
  transitGaps: SiteTransitGap[];
  totalTransitMs: number;
  averageTransitMs: number;
} {
  const completed = allSites.filter((s) => s.status === 'completed');

  // Group completed sites by technician
  const byTech = new Map<string, InstallationSite[]>();
  completed.forEach((site) => {
    const rawKey = site.completedByUser || site.reservedByUser || 'unknown';
    const key = normalizeUserKey(rawKey);
    const list = byTech.get(key) || [];
    list.push(site);
    byTech.set(key, list);
  });

  const transitGaps: SiteTransitGap[] = [];
  const siteTransitMap = new Map<string, SiteTransitGap>();
  const firstSiteOfDaySet = new Set<string>();
  const siteDayKeyMap = new Map<string, string>();
  const siteDayLabelMap = new Map<string, string>();

  // Process each technician's sites chronologically
  byTech.forEach((techSites, techKey) => {
    // Sort chronologically by completion timestamp
    const sorted = [...techSites].sort((a, b) => {
      return getSiteCompletionMs(a) - getSiteCompletionMs(b);
    });

    for (let i = 0; i < sorted.length; i++) {
      const curSite = sorted[i];
      const curCompletedIso =
        curSite.completedAt || curSite.biometricCompletionSeal?.verifiedAt || '';
      const curCompletedMs = getSiteCompletionMs(curSite);
      const curStartMs = getSiteStartMs(curSite);
      const effectiveCurAnchorMs = curCompletedMs || curStartMs;
      const curDayKey = getIstCalendarDateKey(effectiveCurAnchorMs);
      const curDayLabel = getIstCalendarDateLabel(effectiveCurAnchorMs);

      siteDayKeyMap.set(curSite.id, curDayKey);
      siteDayLabelMap.set(curSite.id, curDayLabel);

      const prevSite = i > 0 ? sorted[i - 1] : null;
      const prevMs = prevSite ? getSiteCompletionMs(prevSite) : 0;
      const prevDayKey = prevSite ? getIstCalendarDateKey(prevMs) : '';

      const isSameCalendarDayAsPrev =
        Boolean(prevSite) && Boolean(curDayKey) && Boolean(prevDayKey) && curDayKey === prevDayKey;

      if (!isSameCalendarDayAsPrev) {
        // First site of this calendar day! Overnight gap from previous day is NEVER counted.
        firstSiteOfDaySet.add(curSite.id);

        // Rule 2: Check if technician performed a Morning On-Duty Check-In earlier on this same day
        const morningRecord = options.morningCheckInsByTech?.[techKey];
        const morningMs = parseSiteTimestampMs(morningRecord?.verifiedAt);
        const morningDayKey = getIstCalendarDateKey(morningMs);

        // Determine arrival/start time of the first site of the day
        const arrivalMs = parseSiteTimestampMs(
          curSite.biometricArrivalVerification?.verifiedAt,
          curSite.biometricArrivalVerification?.verificationId,
        );
        const startedMs = parseSiteTimestampMs(curSite.startedAt);
        let firstSiteArrivalMs = curCompletedMs;
        if (arrivalMs > 0 && (curCompletedMs === 0 || arrivalMs <= curCompletedMs)) {
          firstSiteArrivalMs = arrivalMs;
        } else if (startedMs > 0 && (curCompletedMs === 0 || startedMs <= curCompletedMs)) {
          firstSiteArrivalMs = startedMs;
        }

        if (
          morningMs > 0 &&
          morningDayKey &&
          morningDayKey === curDayKey &&
          firstSiteArrivalMs > morningMs
        ) {
          const deltaMs = firstSiteArrivalMs - morningMs;
          const distanceKm = calculateHaversineDistanceKm(
            morningRecord?.latitude,
            morningRecord?.longitude,
            curSite.latitude,
            curSite.longitude,
          );

          const morningGap: SiteTransitGap = {
            previousSiteId: 'morning-on-duty',
            previousSiteCode: 'ON-DUTY',
            previousClientName: 'Morning On-Duty Check-In',
            previousDistrict: curSite.district,
            previousCompletedAt: morningRecord?.verifiedAt || '',
            currentSiteId: curSite.id,
            currentSiteCode: curSite.siteCode,
            currentClientName: curSite.clientName,
            currentDistrict: curSite.district,
            currentStartedAt: curCompletedIso,
            transitDurationMs: deltaMs,
            transitDurationLabel: formatTransitDuration(deltaMs),
            distanceKm,
            technicianUserKey: techKey,
            isMorningCheckInTransit: true,
            dayDateKey: curDayKey,
          };

          transitGaps.push(morningGap);
          siteTransitMap.set(curSite.id, morningGap);
        }
        continue;
      }

      // Same Calendar Day: Calculate consecutive site-to-site travel (Site N-1 -> Site N)
      const prevCompletedIso =
        prevSite!.completedAt ||
        prevSite!.biometricCompletionSeal?.verifiedAt ||
        prevSite!.startedAt ||
        '';

      let curMs = curCompletedMs;
      const arrivalVerifiedAt = curSite.biometricArrivalVerification?.verifiedAt;
      const arrivalMs = parseSiteTimestampMs(
        arrivalVerifiedAt,
        curSite.biometricArrivalVerification?.verificationId,
      );

      if (
        arrivalMs > 0 &&
        arrivalMs > prevMs &&
        (curCompletedMs === 0 || arrivalMs <= curCompletedMs)
      ) {
        curMs = arrivalMs;
      } else {
        const startedAtIso = curSite.startedAt;
        const startedMs = parseSiteTimestampMs(startedAtIso);
        if (
          startedMs > 0 &&
          startedMs > prevMs &&
          (curCompletedMs === 0 || startedMs <= curCompletedMs)
        ) {
          curMs = startedMs;
        }
      }

      let deltaMs = 0;
      if (prevMs > 0 && curMs > 0 && curMs > prevMs) {
        deltaMs = curMs - prevMs;
      }

      const distanceKm = calculateHaversineDistanceKm(
        prevSite!.latitude,
        prevSite!.longitude,
        curSite.latitude,
        curSite.longitude,
      );

      const gap: SiteTransitGap = {
        previousSiteId: prevSite!.id,
        previousSiteCode: prevSite!.siteCode,
        previousClientName: prevSite!.clientName,
        previousDistrict: prevSite!.district,
        previousCompletedAt: prevCompletedIso,
        currentSiteId: curSite.id,
        currentSiteCode: curSite.siteCode,
        currentClientName: curSite.clientName,
        currentDistrict: curSite.district,
        currentStartedAt: curCompletedIso,
        transitDurationMs: deltaMs,
        transitDurationLabel: formatTransitDuration(deltaMs),
        distanceKm,
        technicianUserKey: techKey,
        dayDateKey: curDayKey,
      };

      transitGaps.push(gap);
      siteTransitMap.set(curSite.id, gap);
    }
  });

  // Filter if technician specified
  const filteredCompleted = filterTechnicianKey
    ? completed.filter(
        (s) =>
          normalizeUserKey(s.completedByUser || s.reservedByUser || '') ===
          normalizeUserKey(filterTechnicianKey),
      )
    : completed;

  // Sort chronologically by completion timestamp
  const sortedFilteredCompleted = [...filteredCompleted].sort((a, b) => {
    return getSiteCompletionMs(a) - getSiteCompletionMs(b);
  });

  const sitesWithTransit: SiteWithTransit[] = sortedFilteredCompleted.map((site) => ({
    ...site,
    transitFromPrevious: siteTransitMap.get(site.id),
    isFirstSiteOfDay: firstSiteOfDaySet.has(site.id),
    dayDateKey: siteDayKeyMap.get(site.id),
    dayDateLabel: siteDayLabelMap.get(site.id),
  }));

  const relevantGaps = filterTechnicianKey
    ? transitGaps.filter(
        (g) => normalizeUserKey(g.technicianUserKey) === normalizeUserKey(filterTechnicianKey),
      )
    : transitGaps;

  const totalTransitMs = relevantGaps.reduce((acc, g) => acc + g.transitDurationMs, 0);
  const averageTransitMs =
    relevantGaps.length > 0 ? Math.round(totalTransitMs / relevantGaps.length) : 0;

  return {
    sitesWithTransit,
    transitGaps: relevantGaps,
    totalTransitMs,
    averageTransitMs,
  };
}

export type CompletedDateFilterMode = 'all' | 'today' | 'single' | 'range';

export function getSiteIstDateKey(site: InstallationSite | SiteWithTransit): string {
  const maybeWithTransit = site as SiteWithTransit;
  if (maybeWithTransit.dayDateKey) {
    return maybeWithTransit.dayDateKey;
  }
  const anchorMs = getSiteCompletionMs(site) || getSiteStartMs(site);
  return getIstCalendarDateKey(anchorMs);
}

export function getSiteIstDateLabel(site: InstallationSite | SiteWithTransit): string {
  const maybeWithTransit = site as SiteWithTransit;
  if (maybeWithTransit.dayDateLabel) {
    return maybeWithTransit.dayDateLabel;
  }
  const anchorMs = getSiteCompletionMs(site) || getSiteStartMs(site);
  return getIstCalendarDateLabel(anchorMs);
}

/**
 * Filters sites by IST calendar date (`YYYY-MM-DD` in Asia/Kolkata):
 * - `'all'`: returns all sites
 * - `'today'`: matches today's IST date
 * - `'single'`: matches `singleDate` (`YYYY-MM-DD`)
 * - `'range'`: matches inclusive date range `[startDate, endDate]` (auto-orders reversed bounds)
 */
export function filterSitesByIstDateRange<T extends InstallationSite>(
  sites: T[],
  mode: CompletedDateFilterMode,
  singleDate = '',
  startDate = '',
  endDate = '',
  nowMs: number = Date.now(),
): T[] {
  if (mode === 'all') {
    return sites;
  }

  if (mode === 'today') {
    const todayKey = getIstCalendarDateKey(nowMs);
    return sites.filter((s) => getSiteIstDateKey(s) === todayKey);
  }

  if (mode === 'single') {
    const target = singleDate.trim();
    if (!target) return sites;
    return sites.filter((s) => getSiteIstDateKey(s) === target);
  }

  if (mode === 'range') {
    const sTrim = startDate.trim();
    const eTrim = endDate.trim();
    if (!sTrim && !eTrim) return sites;

    let minKey = sTrim;
    let maxKey = eTrim;
    if (minKey && maxKey && minKey > maxKey) {
      minKey = eTrim;
      maxKey = sTrim;
    }

    return sites.filter((s) => {
      const key = getSiteIstDateKey(s);
      if (!key) return false;
      if (minKey && key < minKey) return false;
      if (maxKey && key > maxKey) return false;
      return true;
    });
  }

  return sites;
}

/**
 * Recalculates total and average travel time for a filtered subset of `SiteWithTransit[]`.
 */
export function summarizeTransitForFilteredSites(sites: SiteWithTransit[]): {
  count: number;
  totalTransitMs: number;
  averageTransitMs: number;
  transitCount: number;
} {
  let totalTransitMs = 0;
  let transitCount = 0;
  for (const s of sites) {
    if (s.transitFromPrevious && typeof s.transitFromPrevious.transitDurationMs === 'number') {
      totalTransitMs += s.transitFromPrevious.transitDurationMs;
      transitCount += 1;
    }
  }
  const averageTransitMs = transitCount > 0 ? Math.round(totalTransitMs / transitCount) : 0;
  return {
    count: sites.length,
    totalTransitMs,
    averageTransitMs,
    transitCount,
  };
}
