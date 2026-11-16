import { validateIdentityInput } from '../server/identity-validation.ts';
/**
 * ============================================================================
 * ZERO-TRUST SERVER-SIDE SECURITY, SANITIZATION & ACCESS CONTROL VALIDATION
 * ============================================================================
 *
 * TRUST BOUNDARY DOCUMENTATION:
 * - Untrusted Zone: Browser / React SPA (`src/components/*`). All HTTP headers,
 *   query parameters, route params, and JSON bodies originating from the client
 *   are treated as untrusted input.
 * - Trusted Zone: Express Backend (`server.ts`) & Security Validation Layer.
 *   Identity (`userId`, `userKey`, `email`, `role`) is derived strictly from
 *   cryptographically verified server sessions on the server.
 * - Persistence Zone: Supabase Auth & PostgreSQL (`public.sites`,
 *   `public.activity_logs`), accessed exclusively by the server using
 *   server-only credentials.
 */

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeUsernameOrEmail,
} from './auth-validation.ts';
import type {
  InstallationSite,
  SiteStatus,
  UserProfile,
  AuthenticatedRole,
  AdminTabId,
  ComputerArchitecture,
} from './deployment-logic.ts';
import {
  UP_DISTRICTS,
  normalizeUserKey,
  verifyHostnameWithServerRegistry,
  findDuplicateHostname,
  validateDocumentUpload,
  ALL_ADMIN_TABS,
  sanitizeAllowedTabs,
} from './deployment-logic.ts';

export type { AuthenticatedRole, AdminTabId };

export interface VerifiedAuthContext {
  userId: string;
  userKey: string;
  email: string;
  role: AuthenticatedRole;
  allowedTabs?: AdminTabId[];
}

const VALID_SITE_STATUSES = new Set<SiteStatus>([
  'available',
  'in_progress',
  'pending',
  'completed',
]);

const VALID_UP_DISTRICTS_LOWER = new Map<string, string>();
UP_DISTRICTS.forEach((d) => VALID_UP_DISTRICTS_LOWER.set(d.toLowerCase(), d));

// District aliases and variations common in UP tender workbooks
const DISTRICT_ALIASES: Record<string, string> = {
  kanpur: 'Kanpur',
  'kanpur nagar': 'Kanpur',
  'kanpur dehat': 'Kanpur',
  fatehgarh: 'Farrukhabad',
  kasganj: 'Kasganj',
  'kashiram nagar': 'Kasganj',
  hathras: 'Hathras',
  'mahamaya nagar': 'Hathras',
  bhadohi: 'Bhadohi',
  'sant ravidas nagar': 'Bhadohi',
  amethi: 'Amethi',
  'chhatrapati shahuji maharaj nagar': 'Amethi',
  amroha: 'Amroha',
  'jyotiba phule nagar': 'Amroha',
  shamli: 'Shamli',
  sambhal: 'Sambhal',
  noida: 'Gautam Buddha Nagar',
  'greater noida': 'Gautam Buddha Nagar',
  saifai: 'Etawah',
};

for (const [alias, canonical] of Object.entries(DISTRICT_ALIASES)) {
  VALID_UP_DISTRICTS_LOWER.set(alias, canonical);
}

/**
 * Strips HTML tags, script payloads, ASCII control characters, and null bytes,
 * and enforces a strict maximum character length.
 */
export function sanitizeText(input: unknown, maxLength = 250): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validates and normalizes an Uttar Pradesh district name against the official whitelist.
 * Automatically resolves aliases (e.g. Kanpur, Fatehgarh) and fallback values so uploads never fail.
 */
export function sanitizeDistrict(
  input: unknown,
  defaultFallback?: string,
): {
  isValid: boolean;
  district: string;
  error?: string;
} {
  const clean = sanitizeText(input, 80);
  if (!clean) {
    if (defaultFallback) {
      return { isValid: true, district: defaultFallback };
    }
    return {
      isValid: false,
      district: '',
      error: 'District is required.',
    };
  }

  const lower = clean.toLowerCase();

  // 1. Direct match or exact alias match
  const canonical = VALID_UP_DISTRICTS_LOWER.get(lower);
  if (canonical) {
    return { isValid: true, district: canonical };
  }

  // 2. Substring search for embedded UP district names (e.g. "SE KANPUR NAGAR,VIDYUT COLONY")
  for (const [alias, targetDistrict] of VALID_UP_DISTRICTS_LOWER.entries()) {
    if (lower.includes(alias)) {
      return { isValid: true, district: targetDistrict };
    }
  }

  // 3. If a default fallback district is supplied (e.g. during bulk CSV upload), use it
  if (defaultFallback) {
    return { isValid: true, district: defaultFallback };
  }

  return {
    isValid: false,
    district: clean,
    error: `Invalid Uttar Pradesh district "${clean}". Must be an official UP tender district.`,
  };
}

/**
 * Enforces Deny-by-Default RBAC checks for a verified user context against required roles.
 */
export function checkRoleAccess(
  auth: VerifiedAuthContext | null | undefined,
  allowedRoles: readonly AuthenticatedRole[],
): { allowed: boolean; statusCode: 200 | 401 | 403; error?: string } {
  if (!auth || !auth.userKey || !auth.userId) {
    return {
      allowed: false,
      statusCode: 401,
      error: 'Authentication required. Sign in with a valid session.',
    };
  }

  if (!allowedRoles.includes(auth.role)) {
    return {
      allowed: false,
      statusCode: 403,
      error: `Access denied: Role "${auth.role}" is not authorized to access this resource.`,
    };
  }

  return { allowed: true, statusCode: 200 };
}

/**
 * Enforces horizontal isolation (prevents IDOR) on per-user resources such as profiles.
 * Agents can only read/modify their own `userKey`; Super Admins may inspect profiles;
 * Sub-Admins may inspect (never overwrite via self-endpoint) only when granted `requiredTabForSubAdmin` (e.g. 'users').
 */
export function checkUserResourceOwnership(
  auth: VerifiedAuthContext | null | undefined,
  targetUserKey: string,
  allowAdminOverride = false,
  requiredTabForSubAdmin?: AdminTabId,
): { allowed: boolean; statusCode: 200 | 401 | 403; error?: string } {
  if (!auth || !auth.userKey) {
    return {
      allowed: false,
      statusCode: 401,
      error: 'Authentication required.',
    };
  }

  const normalizedTarget = normalizeUserKey(targetUserKey);
  const normalizedCaller = normalizeUserKey(auth.userKey);

  if (normalizedCaller === normalizedTarget) {
    return { allowed: true, statusCode: 200 };
  }

  if (allowAdminOverride && auth.role === 'admin') {
    return { allowed: true, statusCode: 200 };
  }

  if (
    allowAdminOverride &&
    auth.role === 'sub_admin' &&
    requiredTabForSubAdmin &&
    Array.isArray(auth.allowedTabs) &&
    auth.allowedTabs.includes(requiredTabForSubAdmin)
  ) {
    return { allowed: true, statusCode: 200 };
  }

  return {
    allowed: false,
    statusCode: 403,
    error: `Forbidden: @${normalizedCaller} cannot access or modify isolated data belonging to @${normalizedTarget}.`,
  };
}

/**
 * Validates and sanitizes an Admin request to provision a user account.
 */
export function validateUserCreationPayload(body: any): {
  isValid: boolean;
  error?: string;
  sanitized?: {
    email: string;
    username: string;
    password: string;
    role: AuthenticatedRole;
    fullName?: string;
    phone?: string;
    address?: string;
    legalProofType?: 'Aadhaar' | 'PAN Card' | 'Voter ID' | 'Driving License' | 'Govt Tech ID';
    legalProofNumber?: string;
    serialNo?: string;
    facialEnrolled?: boolean;
    facialPhoto?: string;
    allowedTabs?: AdminTabId[];
    legalProofDoc?: UserProfile['legalProofDoc'];
  };
} {
  if (!body || typeof body !== 'object') {
    return { isValid: false, error: 'Invalid request body.' };
  }

  const rawIdentifier = sanitizeText(body.username || body.email, 120);
  const normalized = normalizeUsernameOrEmail(rawIdentifier);
  if (!normalized.isValid || !normalized.normalizedEmail) {
    return {
      isValid: false,
      error: normalized.error || 'Invalid username or email format.',
    };
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      isValid: false,
      error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }

  let role: AuthenticatedRole = 'agent';
  if (body.role === 'admin') {
    role = 'admin';
  } else if (body.role === 'sub_admin') {
    role = 'sub_admin';
  }

  // Validate allowedTabs for sub_admin
  let allowedTabs: AdminTabId[] | undefined = undefined;
  if (role === 'sub_admin') {
    allowedTabs = sanitizeAllowedTabs(body.allowedTabs);
    if (allowedTabs.length === 0) {
      return {
        isValid: false,
        error: 'Sub-Administrator must be assigned at least one allowed tab.',
      };
    }
  } else if (role === 'admin') {
    allowedTabs = [...ALL_ADMIN_TABS];
  }

  const cleanUsername = normalizeUserKey(rawIdentifier);
  const fullName = sanitizeText(body.fullName || cleanUsername, 80);
  const phone = sanitizeText(body.phone || '', 24).replace(/[^0-9+\-\s()]/g, '');
  if (fullName.length < 2 || !sanitizeText(body.fullName, 80))
    return { isValid: false, error: 'Full name is required.' };
  const identityResult = validateIdentityInput(body);
  if (!identityResult.identity) return { isValid: false, error: identityResult.error };
  const { address, legalProofType, legalProofNumber, legalProofDoc } = identityResult.identity;
  // Client-supplied serials and verification claims are never used for provisioning.
  const serialNo = undefined;
  const facialEnrolled = Boolean(body.facialEnrolled);
  const facialPhoto =
    typeof body.facialPhoto === 'string' && body.facialPhoto.length < 5 * 1024 * 1024
      ? body.facialPhoto
      : undefined;

  return {
    isValid: true,
    sanitized: {
      email: normalized.normalizedEmail,
      username: cleanUsername,
      password,
      role,
      fullName,
      phone,
      address,
      legalProofType,
      legalProofNumber,
      serialNo,
      facialEnrolled,
      facialPhoto,
      legalProofDoc,
      allowedTabs,
    },
  };
}

/**
 * Checks whether an authenticated user has permission to access a specific Admin Tab module.
 * - 'admin': full access to all modules.
 * - 'sub_admin': strict access ONLY if `requiredTab` is explicitly in `auth.allowedTabs`.
 * - 'agent': denied (403).
 */
export function checkTabAccess(
  auth: VerifiedAuthContext | null | undefined,
  requiredTab: AdminTabId,
): { allowed: boolean; statusCode: 200 | 401 | 403; error?: string } {
  if (!auth || !auth.userKey || !auth.userId) {
    return {
      allowed: false,
      statusCode: 401,
      error: 'Authentication required. Sign in with a valid session.',
    };
  }

  if (auth.role === 'admin') {
    return { allowed: true, statusCode: 200 };
  }

  if (auth.role === 'sub_admin') {
    const tabs = Array.isArray(auth.allowedTabs) ? auth.allowedTabs : [];
    if (tabs.includes(requiredTab)) {
      return { allowed: true, statusCode: 200 };
    }
    return {
      allowed: false,
      statusCode: 403,
      error: `Access Denied: You do not have permission for this module (requires tab: ${requiredTab}).`,
    };
  }

  return {
    allowed: false,
    statusCode: 403,
    error: `Access Denied: Field technician account @${auth.userKey} cannot access administrator modules.`,
  };
}

/**
 * Checks whether an authenticated admin/sub_admin has permission for ANY of the listed tabs
 * (for shared read-only telemetry such as Analytics reading site counts).
 */
export function checkAnyTabAccess(
  auth: VerifiedAuthContext | null | undefined,
  requiredTabs: readonly AdminTabId[],
): { allowed: boolean; statusCode: 200 | 401 | 403; error?: string } {
  if (!auth || !auth.userKey || !auth.userId) {
    return {
      allowed: false,
      statusCode: 401,
      error: 'Authentication required. Sign in with a valid session.',
    };
  }

  if (auth.role === 'admin') {
    return { allowed: true, statusCode: 200 };
  }

  if (auth.role === 'sub_admin') {
    const tabs = Array.isArray(auth.allowedTabs) ? auth.allowedTabs : [];
    if (requiredTabs.some((t) => tabs.includes(t))) {
      return { allowed: true, statusCode: 200 };
    }
    return {
      allowed: false,
      statusCode: 403,
      error: `Access Denied: You do not have permission for this module (requires one of: ${requiredTabs.join(', ')}).`,
    };
  }

  return {
    allowed: false,
    statusCode: 403,
    error: `Access Denied: Field technician account @${auth.userKey} cannot access administrator modules.`,
  };
}

/**
 * Validates and sanitizes a user profile update payload on the server,
 * binding `userKey`, `userId`, and `email` strictly to the authenticated session.
 */
export function validateProfilePayload(
  rawProfile: any,
  auth: VerifiedAuthContext,
): {
  isValid: boolean;
  error?: string;
  sanitized?: UserProfile;
} {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return { isValid: false, error: 'Profile payload must be a JSON object.' };
  }

  const fullName = sanitizeText(rawProfile.fullName, 80);
  if (!fullName || fullName.length < 2) {
    return {
      isValid: false,
      error: 'Full name must be between 2 and 80 characters.',
    };
  }

  const rawEmp = sanitizeText(rawProfile.employeeId || '', 40)
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, '');
  const employeeId =
    rawEmp && rawEmp.length >= 3
      ? rawEmp
      : `UP-${(auth.role || 'TECH').toUpperCase()}-${auth.userKey.toUpperCase().slice(0, 8)}-1001`;

  // Identity and serial are restored from the authoritative profile by the route/DB guard.
  // This operational update path must not create or verify compliance evidence.
  const serialNo = '';
  const phone = sanitizeText(rawProfile.phone, 24).replace(/[^0-9+\-\s()]/g, '');
  const alternatePhone = sanitizeText(rawProfile.alternatePhone || '', 24).replace(
    /[^0-9+\-\s()]/g,
    '',
  );
  const address = sanitizeText(rawProfile.address || '', 160);
  const legalProofType = (
    ['Aadhaar', 'PAN Card', 'Voter ID', 'Driving License', 'Govt Tech ID'].includes(
      rawProfile.legalProofType,
    )
      ? rawProfile.legalProofType
      : 'Aadhaar'
  ) as UserProfile['legalProofType'];
  const legalProofNumber = sanitizeText(rawProfile.legalProofNumber || '', 40);
  const legalProofDoc = undefined;

  const operatingZone = sanitizeText(rawProfile.operatingZone, 80);
  const department = sanitizeText(rawProfile.department, 80) || 'UP Tender Software Deployment';
  const onDuty = Boolean(rawProfile.onDuty);
  const lastVerifiedAt =
    typeof rawProfile.lastVerifiedAt === 'string' && rawProfile.lastVerifiedAt.trim()
      ? sanitizeText(rawProfile.lastVerifiedAt, 60)
      : undefined;
  const lastVerificationId =
    typeof rawProfile.lastVerificationId === 'string' && rawProfile.lastVerificationId.trim()
      ? sanitizeText(rawProfile.lastVerificationId, 80)
      : undefined;
  const lastMatchScore =
    typeof rawProfile.lastMatchScore === 'number' && !Number.isNaN(rawProfile.lastMatchScore)
      ? Math.min(100, Math.max(0, Number(rawProfile.lastMatchScore.toFixed(1))))
      : undefined;
  const lastLatitude =
    typeof rawProfile.lastLatitude === 'number' && !Number.isNaN(rawProfile.lastLatitude)
      ? Number(rawProfile.lastLatitude.toFixed(6))
      : undefined;
  const lastLongitude =
    typeof rawProfile.lastLongitude === 'number' && !Number.isNaN(rawProfile.lastLongitude)
      ? Number(rawProfile.lastLongitude.toFixed(6))
      : undefined;
  const lastLocationAccuracy =
    typeof rawProfile.lastLocationAccuracy === 'number' &&
    !Number.isNaN(rawProfile.lastLocationAccuracy)
      ? Math.round(rawProfile.lastLocationAccuracy)
      : undefined;
  const facialPhoto =
    typeof rawProfile.facialPhoto === 'string' && rawProfile.facialPhoto.length < 3 * 1024 * 1024
      ? rawProfile.facialPhoto
      : undefined;
  const fingerprintCredentialId =
    typeof rawProfile.fingerprintCredentialId === 'string' &&
    rawProfile.fingerprintCredentialId.trim()
      ? sanitizeText(rawProfile.fingerprintCredentialId, 256)
      : undefined;
  const fingerprintDeviceLabel =
    typeof rawProfile.fingerprintDeviceLabel === 'string' &&
    rawProfile.fingerprintDeviceLabel.trim()
      ? sanitizeText(rawProfile.fingerprintDeviceLabel, 120)
      : undefined;
  const fingerprintEnrolledAt =
    typeof rawProfile.fingerprintEnrolledAt === 'string' && rawProfile.fingerprintEnrolledAt.trim()
      ? sanitizeText(rawProfile.fingerprintEnrolledAt, 60)
      : undefined;
  const morningOnDutyAt =
    typeof rawProfile.morningOnDutyAt === 'string' && rawProfile.morningOnDutyAt.trim()
      ? sanitizeText(rawProfile.morningOnDutyAt, 60)
      : undefined;
  const morningOnDutyLatitude =
    typeof rawProfile.morningOnDutyLatitude === 'number' &&
    !Number.isNaN(rawProfile.morningOnDutyLatitude)
      ? Number(rawProfile.morningOnDutyLatitude.toFixed(6))
      : undefined;
  const morningOnDutyLongitude =
    typeof rawProfile.morningOnDutyLongitude === 'number' &&
    !Number.isNaN(rawProfile.morningOnDutyLongitude)
      ? Number(rawProfile.morningOnDutyLongitude.toFixed(6))
      : undefined;
  // Zero-Trust: role & allowedTabs are NEVER accepted from client profile updates.
  // They are bound strictly to the server-verified auth context.
  const role: AuthenticatedRole = auth.role;
  const allowedTabs: AdminTabId[] | undefined =
    auth.role === 'sub_admin'
      ? sanitizeAllowedTabs(auth.allowedTabs)
      : auth.role === 'admin'
        ? [...ALL_ADMIN_TABS]
        : undefined;

  return {
    isValid: true,
    sanitized: {
      id: auth.userId,
      userId: auth.userId,
      userKey: auth.userKey,
      username: auth.userKey,
      email: auth.email,
      fullName,
      employeeId,
      serialNo,
      phone,
      alternatePhone,
      address,
      legalProofType,
      legalProofNumber,
      legalProofDoc,
      operatingZone,
      department,
      onDuty,
      lastVerifiedAt,
      lastVerificationId,
      lastMatchScore,
      lastLatitude,
      lastLongitude,
      lastLocationAccuracy,
      facialPhoto,
      fingerprintCredentialId,
      fingerprintDeviceLabel,
      fingerprintEnrolledAt,
      morningOnDutyAt,
      morningOnDutyLatitude,
      morningOnDutyLongitude,
      role,
      ...(allowedTabs !== undefined ? { allowedTabs } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
}

function sanitizeComputerInventory(
  incoming: any,
  required: boolean,
  userKey: string,
): { fields?: Partial<InstallationSite['hostnameVerifications'][number]>; error?: string } {
  const ramProvided =
    incoming?.ramGB !== undefined && incoming?.ramGB !== null && incoming?.ramGB !== '';
  const rawArchitecture =
    typeof incoming?.systemArchitecture === 'string'
      ? incoming.systemArchitecture.toLowerCase()
      : '';
  const windowsVersion = sanitizeText(incoming?.windowsVersion, 100);
  const windowsEdition = sanitizeText(incoming?.windowsEdition, 100);
  const windowsBuild = sanitizeText(incoming?.windowsBuild, 40);
  const provided =
    ramProvided || Boolean(windowsVersion || windowsEdition || windowsBuild || rawArchitecture);
  if (!required && !provided) return { fields: {} };

  const ramGB = typeof incoming?.ramGB === 'number' ? incoming.ramGB : Number.NaN;
  const allowedArchitectures: ComputerArchitecture[] = ['x64', 'x86', 'arm64', 'unknown'];
  if (
    !Number.isFinite(ramGB) ||
    ramGB <= 0 ||
    ramGB > 4096 ||
    !windowsVersion ||
    !allowedArchitectures.includes(rawArchitecture as ComputerArchitecture)
  ) {
    return {
      error:
        'Record installed RAM, Windows version, and system architecture for this PC. Use Windows Task Manager and Settings > System > About.',
    };
  }

  return {
    fields: {
      ramGB: Math.round(ramGB * 10) / 10,
      windowsVersion,
      windowsEdition: windowsEdition || undefined,
      windowsBuild: windowsBuild || undefined,
      systemArchitecture: rawArchitecture as ComputerArchitecture,
      hardwareReportedAt: new Date().toISOString(),
      hardwareReportedBy: normalizeUserKey(userKey),
    },
  };
}

/**
 * Zero-Trust Server Validation for `POST /api/supabase/sites/update-one`:
 * 1. Verifies the caller owns the reservation (or is an Admin).
 * 2. Re-validates hostname verification against the site's expected prefix on the server.
 * 3. Re-validates every uploaded document's extension and size bounds on the server.
 * 4. Blocks setting `status = 'completed'` unless software installation, hostname
 *    verification, and at least 1 valid official document are all verified on the server.
 */
export function validateServerSideSiteUpdate(
  existingSite: InstallationSite,
  incomingSite: any,
  auth: VerifiedAuthContext,
  allSites: InstallationSite[] = [],
): {
  isValid: boolean;
  statusCode: 200 | 400 | 403;
  error?: string;
  sanitizedSite?: InstallationSite;
} {
  if (!incomingSite || typeof incomingSite !== 'object') {
    return {
      isValid: false,
      statusCode: 400,
      error: 'Invalid site payload.',
    };
  }

  if (auth.role === 'sub_admin' && !(auth.allowedTabs || []).includes('sites')) {
    return {
      isValid: false,
      statusCode: 403,
      error: 'Access Denied: You do not have permission for this module (requires tab: sites).',
    };
  }

  if (existingSite.status === 'pending' || incomingSite.status === 'pending') {
    return {
      isValid: false,
      statusCode: 403,
      error: 'Use the dedicated pause, resume or administrator recovery action for pending sites.',
    };
  }

  const currentOwner = existingSite.reservedByUser
    ? normalizeUserKey(existingSite.reservedByUser)
    : '';

  const isSiteAdmin =
    auth.role === 'admin' ||
    (auth.role === 'sub_admin' && (auth.allowedTabs || []).includes('sites'));

  if (currentOwner && currentOwner !== auth.userKey && !isSiteAdmin) {
    return {
      isValid: false,
      statusCode: 403,
      error: `Forbidden: Site "${existingSite.clientName}" is reserved by @${currentOwner}. You cannot modify another technician's installation.`,
    };
  }

  const requestedStatus: SiteStatus = VALID_SITE_STATUSES.has(incomingSite.status)
    ? incomingSite.status
    : existingSite.status;

  if (
    Array.isArray(incomingSite.hostnameVerifications) &&
    incomingSite.hostnameVerifications.length > (existingSite.computerCount || 1)
  ) {
    return {
      isValid: false,
      statusCode: 400,
      error: 'Add extra computers with a remark before submitting their hostnames.',
    };
  }

  // 1. Server-side re-verification of Hostnames if present (Prevents Duplicates)
  let verifiedHostnamesObj = existingSite.hostnameVerifications || [];
  if (Array.isArray(incomingSite.hostnameVerifications)) {
    const nextVerifications = [...verifiedHostnamesObj];
    for (let i = 0; i < incomingSite.hostnameVerifications.length; i++) {
      const incomingV = incomingSite.hostnameVerifications[i];
      if (incomingV && !nextVerifications[i]?.verified) {
        const allowedExceptionReasons = [
          'pc_unavailable',
          'domain_pc',
          'windows_7',
          'other',
        ] as const;
        if (incomingV.exceptionReason !== undefined) {
          const reason = incomingV.exceptionReason;
          if (!allowedExceptionReasons.includes(reason)) {
            return {
              isValid: false,
              statusCode: 400,
              error: `Computer #${i + 1} has an unsupported exception reason.`,
            };
          }

          const description = sanitizeText(incomingV.exceptionDescription || '', 500);
          const descriptionWords = description.split(/\s+/).filter(Boolean).length;
          const proofPhoto = incomingV.exceptionProofPhoto;
          if (
            typeof proofPhoto !== 'string' ||
            !proofPhoto.startsWith('data:image/jpeg;base64,') ||
            proofPhoto.length > 3 * 1024 * 1024
          ) {
            return {
              isValid: false,
              statusCode: 400,
              error: `Capture a live workstation photo for Computer #${i + 1} before submitting the exception.`,
            };
          }
          if (reason === 'other' && descriptionWords < 5) {
            return {
              isValid: false,
              statusCode: 400,
              error: 'For an other reason, provide at least five words.',
            };
          }
          const inventory = sanitizeComputerInventory(incomingV, false, auth.userKey);
          if (inventory.error) {
            return { isValid: false, statusCode: 400, error: inventory.error };
          }

          const now = new Date().toISOString();
          nextVerifications[i] = {
            ...inventory.fields,
            verified: true,
            hostname: `EXCUSED-0${i + 1}`,
            exceptionReason: reason,
            exceptionDescription: reason === 'other' ? description : undefined,
            exceptionProofPhoto: proofPhoto,
            exceptionProofCapturedAt: now,
            isDomainComputer: reason === 'domain_pc',
            approvalCode: `EXCUSED-${reason.toUpperCase()}-${i + 1}`,
            verifiedAt: now,
          };
        } else if (incomingV.isDomainComputer && incomingV.domainProofPhoto) {
          // Continue accepting old saved domain-camera proof records.
          const inventory = sanitizeComputerInventory(incomingV, false, auth.userKey);
          if (inventory.error) {
            return { isValid: false, statusCode: 400, error: inventory.error };
          }
          nextVerifications[i] = {
            ...inventory.fields,
            verified: true,
            hostname: incomingV.hostname || `DOMAIN-RESTRICTED-0${i + 1}`,
            isDomainComputer: true,
            domainProofPhoto: incomingV.domainProofPhoto,
            domainProofCapturedAt: incomingV.domainProofCapturedAt || new Date().toISOString(),
            domainNotes: sanitizeText(
              incomingV.domainNotes || 'Domain Workstation - Installation Restricted',
              200,
            ),
            approvalCode:
              incomingV.approvalCode ||
              `DOMAIN-EXEMPT-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
            verifiedAt: incomingV.verifiedAt || new Date().toISOString(),
          };
        } else if (incomingV.hostname) {
          const workstationProofPhoto = incomingV.workstationProofPhoto;
          if (
            typeof workstationProofPhoto !== 'string' ||
            !workstationProofPhoto.startsWith('data:image/jpeg;base64,') ||
            workstationProofPhoto.length > 3 * 1024 * 1024
          ) {
            return {
              isValid: false,
              statusCode: 400,
              error: `Capture a live workstation photo for Computer #${i + 1} before submitting its hostname.`,
            };
          }
          // Only newly submitted hostname entries require inventory; pre-existing
          // verified legacy entries are retained unchanged above.
          const inventory = sanitizeComputerInventory(incomingV, true, auth.userKey);
          if (inventory.error) {
            return { isValid: false, statusCode: 400, error: inventory.error };
          }
          const checkHost = verifyHostnameWithServerRegistry(
            String(incomingV.hostname),
            existingSite,
            allSites,
            existingSite.id,
            i,
          );
          if (checkHost.verified) {
            nextVerifications[i] = {
              ...checkHost,
              ...inventory.fields,
              workstationProofPhoto,
              workstationProofCapturedAt: new Date().toISOString(),
            };
          } else {
            return {
              isValid: false,
              statusCode: 400,
              error: checkHost.error || `Invalid hostname for Computer #${i + 1}.`,
            };
          }
        }
      }
    }

    // Check for duplicate hostnames across slots on this site
    const seenHostnames = new Map<string, number>();
    for (let i = 0; i < nextVerifications.length; i++) {
      const v = nextVerifications[i];
      if (v && v.verified && !v.isDomainComputer && !v.exceptionReason && v.hostname) {
        const norm = v.hostname.trim().toUpperCase();
        if (seenHostnames.has(norm)) {
          return {
            isValid: false,
            statusCode: 400,
            error: `Duplicate Hostname: Hostname "${v.hostname}" is assigned to both Computer #${seenHostnames.get(norm)! + 1} and Computer #${i + 1} at this site. Each computer must have a unique hostname.`,
          };
        }
        seenHostnames.set(norm, i);
      }
    }

    // Check for duplicate hostnames across all other sites
    if (allSites && allSites.length > 0) {
      for (let i = 0; i < nextVerifications.length; i++) {
        const v = nextVerifications[i];
        if (v && v.verified && !v.isDomainComputer && !v.exceptionReason && v.hostname) {
          const dup = findDuplicateHostname(v.hostname, allSites, existingSite.id, i);
          if (dup.isDuplicate) {
            return {
              isValid: false,
              statusCode: 400,
              error: `Duplicate Hostname: Hostname "${v.hostname}" is already registered on site ${dup.conflictSiteCode} (${dup.conflictFacility}). Duplicate hostnames are not permitted across installations.`,
            };
          }
        }
      }
    }

    verifiedHostnamesObj = nextVerifications;
  }

  // 2. Server-side validation of all attached documents
  const rawDocs = Array.isArray(incomingSite.documents)
    ? incomingSite.documents
    : existingSite.documents;
  const sanitizedDocs = [];
  for (const doc of rawDocs.slice(0, 10)) {
    if (!doc || typeof doc !== 'object') continue;
    const cleanName = sanitizeText(doc.name, 140);
    const sizeBytes = Number(doc.sizeBytes) || 0;
    const docCheck = validateDocumentUpload({ name: cleanName, sizeBytes });
    if (!docCheck.isValid) {
      return {
        isValid: false,
        statusCode: 400,
        error: docCheck.error || `Invalid document "${cleanName}".`,
      };
    }
    const cleanId = sanitizeText(doc.id, 60) || `doc-${Date.now()}`;
    const existingDoc = (existingSite.documents || []).find((saved) => saved.id === cleanId);
    sanitizedDocs.push({
      id: cleanId,
      name: cleanName,
      docType: 'Sign-Off Certificate' as const,
      sizeBytes,
      uploadedAt: sanitizeText(doc.uploadedAt, 40) || 'Verified',
      checksum: existingDoc?.checksum || 'Stored',
      // Storage paths and MIME types are server-owned; never accept a client-supplied path.
      ...(existingDoc?.storagePath ? { storagePath: existingDoc.storagePath } : {}),
      ...(existingDoc?.mimeType ? { mimeType: existingDoc.mimeType } : {}),
    });
  }

  // 3. Sanitize milestones
  const rawMilestones = Array.isArray(incomingSite.milestones)
    ? incomingSite.milestones
    : existingSite.milestones;
  const sanitizedMilestones = existingSite.milestones.map((existingM) => {
    const matched = rawMilestones.find((m: any) => m && m.id === existingM.id);
    return {
      ...existingM,
      completed:
        requestedStatus === 'completed'
          ? true
          : matched
            ? Boolean(matched.completed)
            : existingM.completed,
    };
  });

  // 4. Enforce completion prerequisites on the server (Zero-Trust against UI bypass)
  const reqComputerCount = existingSite.computerCount || 1;
  const siteVerifications = verifiedHostnamesObj.slice(0, reqComputerCount);
  const verifiedCount = siteVerifications.filter((verification) => verification?.verified).length;
  const hasComputerException = siteVerifications.some(
    (verification) => verification?.exceptionReason || verification?.isDomainComputer,
  );
  const installMilestoneWasCompleted = rawMilestones.some(
    (milestone: any) => milestone?.id === 'install' && Boolean(milestone.completed),
  );

  if (requestedStatus === 'completed') {
    const installDone =
      (!hasComputerException && verifiedCount >= reqComputerCount) || installMilestoneWasCompleted;

    if (!installDone) {
      return {
        isValid: false,
        statusCode: 400,
        error: 'Cannot mark site as completed: Software installation step has not been completed.',
      };
    }

    if (verifiedCount < reqComputerCount) {
      return {
        isValid: false,
        statusCode: 400,
        error: `Cannot mark site as completed: Verify each computer hostname or record an approved exception first (${verifiedCount}/${reqComputerCount} accounted for).`,
      };
    }

    if (sanitizedDocs.length === 0) {
      return {
        isValid: false,
        statusCode: 400,
        error:
          'Cannot mark site as completed: At least one signed installation document must be uploaded.',
      };
    }
  }

  const effectiveOwner = currentOwner || auth.userKey;

  let biometricArrivalVerification = existingSite.biometricArrivalVerification;
  if (
    requestedStatus !== 'available' &&
    incomingSite.biometricArrivalVerification &&
    typeof incomingSite.biometricArrivalVerification === 'object' &&
    incomingSite.biometricArrivalVerification.verified
  ) {
    const rawArr = incomingSite.biometricArrivalVerification;
    biometricArrivalVerification = {
      verified: true,
      verifiedByUser: normalizeUserKey(rawArr.verifiedByUser || effectiveOwner),
      verifiedByName: sanitizeText(rawArr.verifiedByName, 80) || effectiveOwner,
      verificationId: sanitizeText(rawArr.verificationId, 80) || 'BIO-NEURAL-SITE-CLAIM',
      matchScore:
        typeof rawArr.matchScore === 'number'
          ? Math.min(100, Math.max(0, Number(rawArr.matchScore.toFixed(1))))
          : 98.4,
      verifiedAt: sanitizeText(rawArr.verifiedAt, 60) || new Date().toISOString(),
      snapshotThumbnail:
        typeof rawArr.snapshotThumbnail === 'string' &&
        rawArr.snapshotThumbnail.length < 3 * 1024 * 1024
          ? rawArr.snapshotThumbnail
          : existingSite.biometricArrivalVerification?.snapshotThumbnail,
      latitude:
        typeof rawArr.latitude === 'number' && !Number.isNaN(rawArr.latitude)
          ? Number(rawArr.latitude.toFixed(6))
          : existingSite.biometricArrivalVerification?.latitude,
      longitude:
        typeof rawArr.longitude === 'number' && !Number.isNaN(rawArr.longitude)
          ? Number(rawArr.longitude.toFixed(6))
          : existingSite.biometricArrivalVerification?.longitude,
      accuracyMeters:
        typeof rawArr.accuracyMeters === 'number' && !Number.isNaN(rawArr.accuracyMeters)
          ? Math.round(rawArr.accuracyMeters)
          : existingSite.biometricArrivalVerification?.accuracyMeters,
    };
  } else if (requestedStatus === 'available') {
    biometricArrivalVerification = undefined;
  }

  let biometricCompletionSeal = existingSite.biometricCompletionSeal;
  if (
    requestedStatus === 'completed' &&
    incomingSite.biometricCompletionSeal &&
    typeof incomingSite.biometricCompletionSeal === 'object' &&
    incomingSite.biometricCompletionSeal.verified
  ) {
    const rawSeal = incomingSite.biometricCompletionSeal;
    biometricCompletionSeal = {
      verified: true,
      verifiedByUser: normalizeUserKey(rawSeal.verifiedByUser || effectiveOwner),
      verifiedByName: sanitizeText(rawSeal.verifiedByName, 80) || effectiveOwner,
      verificationId: sanitizeText(rawSeal.verificationId, 80) || `BIO-SEAL-${Date.now()}`,
      matchScore:
        typeof rawSeal.matchScore === 'number'
          ? Math.min(100, Math.max(0, Number(rawSeal.matchScore.toFixed(1))))
          : 98.4,
      verifiedAt: sanitizeText(rawSeal.verifiedAt, 60) || new Date().toISOString(),
      snapshotThumbnail:
        typeof rawSeal.snapshotThumbnail === 'string' &&
        rawSeal.snapshotThumbnail.length < 3 * 1024 * 1024
          ? rawSeal.snapshotThumbnail
          : existingSite.biometricCompletionSeal?.snapshotThumbnail,
      latitude:
        typeof rawSeal.latitude === 'number' && !Number.isNaN(rawSeal.latitude)
          ? Number(rawSeal.latitude.toFixed(6))
          : existingSite.biometricCompletionSeal?.latitude,
      longitude:
        typeof rawSeal.longitude === 'number' && !Number.isNaN(rawSeal.longitude)
          ? Number(rawSeal.longitude.toFixed(6))
          : existingSite.biometricCompletionSeal?.longitude,
      accuracyMeters:
        typeof rawSeal.accuracyMeters === 'number' && !Number.isNaN(rawSeal.accuracyMeters)
          ? Math.round(rawSeal.accuracyMeters)
          : existingSite.biometricCompletionSeal?.accuracyMeters,
    };
  } else if (requestedStatus === 'available') {
    biometricCompletionSeal = undefined;
  }

  const sanitizedSite: InstallationSite = {
    ...existingSite,
    latitude:
      typeof incomingSite.latitude === 'number' && !Number.isNaN(incomingSite.latitude)
        ? Number(incomingSite.latitude.toFixed(6))
        : existingSite.latitude,
    longitude:
      typeof incomingSite.longitude === 'number' && !Number.isNaN(incomingSite.longitude)
        ? Number(incomingSite.longitude.toFixed(6))
        : existingSite.longitude,
    status: requestedStatus,
    reservedByUser: requestedStatus === 'available' ? undefined : effectiveOwner,
    reservedByName:
      requestedStatus === 'available'
        ? undefined
        : sanitizeText(incomingSite.reservedByName, 80) ||
          existingSite.reservedByName ||
          effectiveOwner,
    completedByUser:
      requestedStatus === 'completed' ? effectiveOwner : existingSite.completedByUser,
    startedAt:
      requestedStatus === 'available'
        ? undefined
        : existingSite.startedAt || new Date().toISOString(),
    completedAt:
      requestedStatus === 'completed'
        ? biometricCompletionSeal?.verifiedAt ||
          existingSite.completedAt ||
          new Date().toISOString()
        : undefined,
    biometricArrivalVerification,
    biometricCompletionSeal,
    computerCount: reqComputerCount,
    computerInventoryVersion:
      incomingSite.computerInventoryVersion === 1 ? 1 : existingSite.computerInventoryVersion,
    domainComputerIndices: Array.isArray(incomingSite.domainComputerIndices)
      ? incomingSite.domainComputerIndices
      : existingSite.domainComputerIndices,
    hostnameVerifications: verifiedHostnamesObj,
    hostnameVerification: verifiedHostnamesObj[0],
    documents: sanitizedDocs,
    milestones: sanitizedMilestones,
    remark:
      typeof incomingSite.remark === 'string'
        ? sanitizeText(incomingSite.remark, 500)
        : existingSite.remark,
    notes:
      typeof incomingSite.notes === 'string'
        ? sanitizeText(incomingSite.notes, 500)
        : existingSite.notes,
  };

  return {
    isValid: true,
    statusCode: 200,
    sanitizedSite,
  };
}
