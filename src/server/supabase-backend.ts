import type { PrivateResource } from '../lib/private-cache.ts';
import { measuredDatabaseFetch } from './request-performance.ts';
import { parseSiteSummaryQuery, siteSummaryCursor } from './site-summary-query.ts';
import type {
  SiteSummaryQuery,
  SiteSummaryPage,
  DashboardSiteContext,
} from '../utils/site-summary';
import { readAllKeysetRows } from './paginated-read.ts';
import { parseActivityLogQuery, activityLogCursor, isActivityLogId } from './activity-log-query.ts';
import type { ActivityLogQuery, CursorActivityLogPage } from '../utils/activity-log-pagination.ts';
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type {
  ActivityLogEntry,
  InstallationSite,
  SystemDocumentRecord,
  SystemDocumentType,
  UserProfile,
} from '../utils/deployment-logic.ts';
import { normalizeUserKey, sanitizeAllowedTabs } from '../utils/deployment-logic.ts';
import type { AuthenticatedRole, VerifiedAuthContext } from '../utils/security-validation.ts';

export interface UserDirectorySummary {
  userKey: string;
  completed: number;
  inProgress: number;
  facialEnrolled: boolean;
  facialPhoto: string | null;
}

export interface FaceTemplateRecord {
  personId: string;
  personName: string;
  embedding: number[];
  enrolledAt: string;
  photoThumbnail?: string;
  modelName: string;
}

export interface SoftwareDeliverySettings {
  driveFileId: string;
  fileName: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SoftwareDownloadLinkRecord {
  site_id: string;
  agent_user_key: string;
  drive_file_id: string;
  file_name: string;
}

export interface SoftwarePcDownloadSessionRecord {
  pc_session_hash: string;
  pairing_hash: string;
  site_id: string | null;
  site_code: string | null;
  agent_user_key: string | null;
  drive_file_id: string | null;
  file_name: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
}

export interface SoftwarePcDownloadRecord {
  site_id: string;
  site_code: string;
  agent_user_key: string;
  drive_file_id: string;
  file_name: string;
}

export class BackendError extends Error {
  constructor(
    message: string,
    public statusCode = 503,
  ) {
    super(message);
  }
}

function checked<T>(result: { data: T; error: any }): NonNullable<T> {
  if (result.error) {
    const status =
      (
        { PGRST116: 404, '23505': 409, PT400: 400, PT403: 403, PT404: 404, PT409: 409 } as Record<
          string,
          number
        >
      )[result.error.code] || 503;
    throw new BackendError(result.error.message || 'Supabase request failed.', status);
  }
  return result.data as NonNullable<T>;
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
const roleOf = (value: unknown): AuthenticatedRole =>
  value === 'admin' || value === 'sub_admin' ? value : 'agent';

export function profileToRow(profile: UserProfile) {
  const key = normalizeUserKey(profile.userKey || profile.username);
  if (!key) throw new BackendError('A canonical user key is required.', 400);
  return {
    id: key,
    user_key: key,
    user_id: uuid(profile.userId) ? profile.userId : null,
    username: key,
    email: profile.email.toLowerCase(),
    full_name: profile.fullName,
    role: roleOf(profile.role),
    employee_id: profile.employeeId,
    serial_no: profile.serialNo,
    phone: profile.phone,
    address: profile.address,
    legal_proof_type: profile.legalProofType,
    legal_proof_number: profile.legalProofNumber,
    operating_zone: profile.operatingZone,
    department: profile.department,
    on_duty: Boolean(profile.onDuty),
    facial_photo: profile.facialPhoto || null,
    last_verified_at: timestamp(profile.lastVerifiedAt),
    last_verification_id: profile.lastVerificationId || null,
    last_match_score: profile.lastMatchScore ?? null,
    // The reconciled profiles schema already provides this extension column.
    // Fingerprint lock, legal-proof attachment and attendance metadata live here.
    profile_data: { ...profile, userKey: key },
    updated_at: timestamp(profile.updatedAt) || new Date().toISOString(),
  };
}

export function rowToProfile(row: any): UserProfile {
  const key = normalizeUserKey(row.user_key || row.username || row.id);
  return {
    ...row.profile_data,
    id: row.id || key,
    userId: row.user_id || row.profile_data?.userId,
    userKey: key,
    username: row.username || key,
    email: row.email,
    fullName: row.full_name || key,
    role: roleOf(row.role),
    allowedTabs:
      row.role === 'sub_admin' ? sanitizeAllowedTabs(row.profile_data?.allowedTabs) : undefined,
    employeeId: row.employee_id || '',
    serialNo: row.serial_no || '',
    phone: row.phone || '',
    address: row.address || '',
    legalProofType: row.legal_proof_type || 'Aadhaar',
    legalProofNumber: row.legal_proof_number || '',
    operatingZone: row.operating_zone || '',
    department: row.department || '',
    onDuty: Boolean(row.on_duty),
    facialPhoto: row.facial_photo || row.profile_data?.facialPhoto,
    lastVerifiedAt: row.last_verified_at || undefined,
    lastVerificationId: row.last_verification_id || undefined,
    lastMatchScore: row.last_match_score == null ? undefined : Number(row.last_match_score),
    updatedAt: row.updated_at || row.profile_data?.updatedAt || new Date().toISOString(),
  } as UserProfile;
}

export function siteToRow(site: InstallationSite) {
  const active = site.status === 'in_progress';
  return {
    id: site.id,
    site_code: site.siteCode,
    location: site.facilityName || site.clientName,
    district: site.district,
    status: site.status,
    assigned_user_id: active ? normalizeUserKey(site.reservedByUser || '') || null : null,
    client_name: site.clientName,
    address: site.address,
    expected_hostname_prefix: site.expectedHostnamePrefix,
    target_devices: site.computerCount || 0,
    reserved_at: active ? timestamp(site.startedAt) || new Date().toISOString() : null,
    site_data: site,
    workflow_version: site.workflowVersion || 0,
    pending_issue: site.pendingIssue || null,
  };
}
export function rowToSite(row: any): InstallationSite {
  return {
    ...row.site_data,
    id: row.id,
    siteCode: row.site_code,
    district: row.district,
    clientName: row.client_name,
    address: row.address,
    expectedHostnamePrefix: row.expected_hostname_prefix,
    computerCount: row.target_devices,
    status: row.status === 'reserved' ? 'in_progress' : row.status,
    workflowVersion: Number(row.workflow_version || 0),
    pendingIssue: row.pending_issue || undefined,
    reservedByUser:
      row.status === 'available'
        ? undefined
        : row.assigned_user_id || row.site_data?.reservedByUser,
    reservedByName: row.status === 'available' ? undefined : row.site_data?.reservedByName,
    startedAt: row.status === 'available' ? undefined : row.reserved_at || row.site_data?.startedAt,
    biometricArrivalVerification:
      row.status === 'available' ? undefined : row.site_data?.biometricArrivalVerification,
  };
}

function rowToLog(row: any): ActivityLogEntry {
  return {
    ...row.metadata,
    id: row.id,
    eventType: row.event_type,
    actorUsername: row.actor_username,
    actorEmail: row.actor_email || undefined,
    actorRole: row.actor_role || undefined,
    siteId: row.site_id || undefined,
    siteCode: row.site_code || undefined,
    siteName: row.site_name || undefined,
    district: row.district || undefined,
    previousStatus: row.previous_status || undefined,
    newStatus: row.new_status || undefined,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function validServiceKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  try {
    const parts = key.split('.');
    return (
      parts.length === 3 &&
      parts[0].startsWith('eyJ') &&
      JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'service_role'
    );
  } catch {
    return false;
  }
}

export interface BackendOptions {
  url: string;
  serviceRoleKey: string;
  anonKey?: string;
  fetch?: typeof fetch;
}

/** All persistent application reads and writes go through this Supabase-only adapter. */
export class SupabaseBackend {
  readonly admin: SupabaseClient;
  readonly authClient: SupabaseClient;
  readonly url: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl?: typeof fetch;
  static fromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseBackend {
    const url = (env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BackendError('SUPABASE_URL must be a valid HTTPS project URL.');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      /your-project|xyzcompany|example\.supabase/i.test(url)
    ) {
      throw new BackendError('SUPABASE_URL must be your real HTTPS Supabase project URL.');
    }
    if (!validServiceKey(key))
      throw new BackendError(
        'SUPABASE_SERVICE_ROLE_KEY must be a service-role JWT or sb_secret key.',
      );
    return new SupabaseBackend({
      url,
      serviceRoleKey: key,
      anonKey: env.SUPABASE_ANON_KEY?.trim(),
    });
  }
  constructor(options: BackendOptions) {
    this.url = options.url;
    this.serviceRoleKey = options.serviceRoleKey;
    this.fetchImpl = options.fetch;
    const config = {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: measuredDatabaseFetch(options.fetch || globalThis.fetch) },
    };
    this.admin = createClient(options.url, options.serviceRoleKey, config);
    this.authClient = createClient(options.url, options.anonKey || options.serviceRoleKey, config);
  }

  async signIn(email: string, password: string) {
    const result = await this.authClient.auth.signInWithPassword({ email, password });
    if (result.error || !result.data.user)
      throw new BackendError('Invalid username/email or password.', 401);
    return result.data.user;
  }
  async verifyAccessToken(token: string): Promise<User> {
    const { data, error } = await this.authClient.auth.getUser(token);
    if (error || !data.user)
      throw new BackendError('Invalid or expired authentication token.', 401);
    return data.user;
  }
  async resetPassword(email: string, redirectTo: string) {
    const { error } = await this.authClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new BackendError(error.message);
  }
  async updatePassword(userId: string, password: string) {
    await this.updateAuthUser(userId, { password });
  }
  async createAuthUser(input: {
    email: string;
    password: string;
    username: string;
    fullName: string;
    role: AuthenticatedRole;
    allowedTabs?: string[];
  }) {
    const result = await this.admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { username: input.username, full_name: input.fullName },
      app_metadata: { role: input.role, allowed_tabs: input.allowedTabs || [] },
    });
    if (result.error || !result.data.user)
      throw new BackendError(result.error?.message || 'Could not create Supabase Auth user.', 400);
    return result.data.user;
  }
  async updateAuthPermissions(userId: string, role: AuthenticatedRole, tabs: string[]) {
    await this.updateAuthUser(userId, { app_metadata: { role, allowed_tabs: tabs } });
  }
  private async updateAuthUser(userId: string, attributes: object) {
    const result = await this.admin.auth.admin.updateUserById(userId, attributes);
    if (result.error) throw new BackendError(result.error.message);
    return result.data.user;
  }
  async deleteAuthUser(userId: string) {
    const result = await this.admin.auth.admin.deleteUser(userId);
    if (result.error) throw new BackendError(result.error.message);
  }

  async getAuthProfile(key: string): Promise<UserProfile | null> {
    const data = checked(
      await this.admin
        .from('profiles')
        .select('user_key,user_id,email,role,allowed_tabs:profile_data->allowedTabs')
        .eq('user_key', normalizeUserKey(key))
        .maybeSingle(),
    );
    return data
      ? rowToProfile({ ...data, profile_data: { allowedTabs: data.allowed_tabs } })
      : null;
  }
  async dashboardContext(key: string): Promise<DashboardSiteContext> {
    const data = checked(
      await this.admin
        .rpc('dashboard_site_context', { p_user_key: normalizeUserKey(key) })
        .retry(false),
    );
    if (
      !data ||
      !Number.isSafeInteger(data.total) ||
      !Number.isSafeInteger(data.completed) ||
      !Number.isSafeInteger(data.pending) ||
      data.total < 0 ||
      data.completed < 0 ||
      data.pending < 0 ||
      !Array.isArray(data.pendingItems) ||
      data.pendingItems.length > 20 ||
      typeof data.pendingHasMore !== 'boolean'
    )
      throw new BackendError('Invalid dashboard context.');
    return data;
  }
  async siteSummaryPage(input: SiteSummaryQuery, key: string): Promise<SiteSummaryPage> {
    const q = parseSiteSummaryQuery(input, key);
    const data = checked(
      await this.admin
        .rpc('page_site_summaries', {
          p_user_key: key,
          p_scope: q.scope,
          p_district: q.district,
          p_status: q.status,
          p_search: q.search,
          p_sort: q.sort,
          p_start_date: q.startDate || null,
          p_end_date: q.endDate || null,
          p_page_size: q.pageSize,
          p_after: q.after,
        })
        .retry(false),
    );
    if (
      !data ||
      !Array.isArray(data.items) ||
      data.items.length > q.pageSize + 1 ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0 ||
      data.items.some(
        (r: any) =>
          !r ||
          typeof r.id !== 'string' ||
          !Array.isArray(r._keys) ||
          r._keys.length !== 3 ||
          r._keys.some((k: any) => typeof k !== 'string'),
      )
    )
      throw new BackendError('Invalid site summary page.');
    const visible = data.items.slice(0, q.pageSize);
    return {
      items: visible.map(({ _keys, ...item }: any) => item),
      total: data.total,
      nextCursor:
        data.items.length > q.pageSize
          ? siteSummaryCursor(visible.at(-1)._keys, q.fingerprint)
          : null,
    };
  }

  async getProfile(key: string): Promise<UserProfile | null> {
    const result = await this.admin
      .from('profiles')
      .select('*')
      .eq('user_key', normalizeUserKey(key))
      .maybeSingle();
    if (result.error) throw new BackendError(result.error.message);
    return result.data ? rowToProfile(result.data) : null;
  }
  private async completeRows(
    table: string,
    key: string,
    columns = '*',
    filter?: { column: string; values: string[] },
  ) {
    try {
      return await readAllKeysetRows<any>(
        async (after, limit) => {
          let query = this.admin
            .from(table)
            .select(columns)
            .order(key, { ascending: true })
            .range(0, limit - 1);
          if (after !== null) query = query.gt(key, after);
          if (filter) query = query.in(filter.column, filter.values);
          return checked(await query) as any[];
        },
        (row) => row[key],
        table,
      );
    } catch (error: any) {
      throw new BackendError(error?.message || `Unable to read complete ${table} dataset.`, 503);
    }
  }

  async analyticsSites(): Promise<InstallationSite[]> {
    const rows = await this.completeRows('sites', 'id', 'id,status,district');
    return rows.map(
      (row: any) =>
        ({
          id: row.id,
          district: row.district,
          status: row.status === 'reserved' ? 'in_progress' : row.status,
        }) as InstallationSite,
    );
  }
  async profiles(): Promise<Record<string, UserProfile>> {
    const rows = await this.completeRows('profiles', 'user_key');
    return Object.fromEntries(
      rows.map((row: any) => {
        const p = rowToProfile(row);
        return [p.userKey, p];
      }),
    );
  }
  async findProfileForAuth(user: User): Promise<UserProfile | null> {
    const byId = checked(
      await this.admin.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
    );
    if (byId) return rowToProfile(byId);
    const username = user.user_metadata?.username || user.app_metadata?.username;
    if (username) {
      const p = await this.getProfile(username);
      if (p) return p;
    }
    if (user.email) {
      const result = await this.admin
        .from('profiles')
        .select('*')
        .ilike('email', user.email)
        .maybeSingle();
      if (result.error) throw new BackendError(result.error.message);
      if (result.data) return rowToProfile(result.data);
    }
    return null;
  }
  async saveProfile(profile: UserProfile) {
    checked(
      await this.admin.from('profiles').upsert(profileToRow(profile), { onConflict: 'user_key' }),
    );
  }
  /** Provision with INSERT, never upsert over a concurrently created username. */
  async createProfile(profile: UserProfile): Promise<UserProfile> {
    const row = checked(
      await this.admin.from('profiles').insert(profileToRow(profile)).select('*').single(),
    );
    if (!/^SN-UP-[0-9]+$/.test(row.serial_no || ''))
      throw new BackendError(
        'Profile integrity migration is required before provisioning users.',
        503,
      );
    return rowToProfile(row);
  }

  async reviewProfileIdentity(
    targetKey: string,
    actorKey: string,
    expectedUpdatedAt: string,
    action: 'replace' | 'verify',
    identity?: import('./identity-validation.ts').IdentityInput,
  ): Promise<UserProfile> {
    const row = checked(
      await this.admin.rpc('review_profile_identity', {
        p_target_key: normalizeUserKey(targetKey),
        p_actor_key: normalizeUserKey(actorKey),
        p_expected_updated_at: expectedUpdatedAt,
        p_action: action,
        p_identity: identity || null,
      }),
    );
    return rowToProfile(row);
  }

  async deleteProfile(key: string) {
    checked(await this.admin.from('profiles').delete().eq('user_key', normalizeUserKey(key)));
  }

  async savePushSubscription(
    userKey: string,
    authUserId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    const existing = checked(
      await this.admin
        .from('push_subscriptions')
        .select('auth_user_id')
        .eq('endpoint', subscription.endpoint)
        .maybeSingle(),
    );
    if (existing && existing.auth_user_id !== authUserId) {
      throw new BackendError('This push endpoint is already registered to another account.', 409);
    }
    checked(
      await this.admin.from('push_subscriptions').upsert(
        {
          user_key: normalizeUserKey(userKey),
          auth_user_id: authUserId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      ),
    );
  }
  async pushSubscriptions(userKeys: string[]) {
    const keys = [...new Set(userKeys.map(normalizeUserKey).filter(Boolean))];
    if (!keys.length) return [];
    const rows = await this.completeRows(
      'push_subscriptions',
      'endpoint',
      'user_key, endpoint, p256dh, auth',
      { column: 'user_key', values: keys },
    );
    return rows.map((row: any) => ({
      userKey: normalizeUserKey(row.user_key),
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }));
  }
  async deletePushSubscription(userKey: string, endpoint: string) {
    checked(
      await this.admin
        .from('push_subscriptions')
        .delete()
        .eq('user_key', normalizeUserKey(userKey))
        .eq('endpoint', endpoint),
    );
  }
  async deletePushSubscriptionEndpoint(endpoint: string) {
    checked(await this.admin.from('push_subscriptions').delete().eq('endpoint', endpoint));
  }

  async softwareDeliverySettings(): Promise<SoftwareDeliverySettings | null> {
    const result = await this.admin
      .from('software_delivery_settings')
      .select('drive_file_id, file_name, updated_at, updated_by')
      .eq('singleton', true)
      .maybeSingle();
    if (result.error) throw new BackendError(result.error.message);
    const row = result.data;
    return row
      ? {
          driveFileId: row.drive_file_id,
          fileName: row.file_name,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
        }
      : null;
  }

  async saveSoftwareDeliverySettings(input: {
    driveFileId: string;
    fileName: string;
    updatedBy: string;
  }): Promise<SoftwareDeliverySettings> {
    const row = checked(
      await this.admin
        .from('software_delivery_settings')
        .upsert(
          {
            singleton: true,
            drive_file_id: input.driveFileId,
            file_name: input.fileName,
            updated_by: normalizeUserKey(input.updatedBy),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'singleton' },
        )
        .select('drive_file_id, file_name, updated_at, updated_by')
        .single(),
    );
    return {
      driveFileId: row.drive_file_id,
      fileName: row.file_name,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  async clearSoftwareDeliverySettings(): Promise<void> {
    const { error } = await this.admin
      .from('software_delivery_settings')
      .delete()
      .eq('singleton', true);
    if (error) throw new BackendError(error.message);
  }

  async issueSoftwareDownloadLink(input: {
    tokenHash: string;
    siteId: string;
    siteCode: string;
    agentUserKey: string;
    driveFileId: string;
    fileName: string;
    expiresAt: string;
  }): Promise<void> {
    const { error } = await this.admin.rpc('issue_software_download_link', {
      p_token_hash: input.tokenHash,
      p_site_id: input.siteId,
      p_site_code: input.siteCode,
      p_agent_user_key: normalizeUserKey(input.agentUserKey),
      p_drive_file_id: input.driveFileId,
      p_file_name: input.fileName,
      p_expires_at: input.expiresAt,
    });
    if (error) throw new BackendError(error.message);
  }

  async consumeSoftwareDownloadLink(tokenHash: string): Promise<SoftwareDownloadLinkRecord | null> {
    const { data, error } = await this.admin.rpc('consume_software_download_link', {
      p_token_hash: tokenHash,
    });
    if (error) throw new BackendError(error.message);
    const row = Array.isArray(data) ? data[0] : null;
    return row
      ? {
          site_id: row.site_id,
          agent_user_key: row.agent_user_key,
          drive_file_id: row.drive_file_id,
          file_name: row.file_name,
        }
      : null;
  }

  async issueSoftwarePcDownloadSession(input: {
    pcSessionHash: string;
    pairingHash: string;
    expiresAt: string;
  }): Promise<void> {
    const { error } = await this.admin.rpc('issue_software_pc_download_session', {
      p_pc_session_hash: input.pcSessionHash,
      p_pairing_hash: input.pairingHash,
      p_expires_at: input.expiresAt,
    });
    if (error) throw new BackendError(error.message);
  }

  async approveSoftwarePcDownloadSession(input: {
    pairingHash: string;
    siteId: string;
    siteCode: string;
    agentUserKey: string;
    driveFileId: string;
    fileName: string;
  }): Promise<boolean> {
    const { data, error } = await this.admin.rpc('approve_software_pc_download_session', {
      p_pairing_hash: input.pairingHash,
      p_site_id: input.siteId,
      p_site_code: input.siteCode,
      p_agent_user_key: normalizeUserKey(input.agentUserKey),
      p_drive_file_id: input.driveFileId,
      p_file_name: input.fileName,
    });
    if (error) throw new BackendError(error.message);
    return data === true;
  }

  async softwarePcDownloadSession(
    sessionHash: string,
  ): Promise<SoftwarePcDownloadSessionRecord | null> {
    const result = await this.admin
      .from('software_pc_download_sessions')
      .select(
        'pc_session_hash, pairing_hash, site_id, site_code, agent_user_key, drive_file_id, file_name, created_at, expires_at, approved_at, consumed_at, revoked_at',
      )
      .eq('pc_session_hash', sessionHash)
      .maybeSingle();
    if (result.error) throw new BackendError(result.error.message);
    return result.data as SoftwarePcDownloadSessionRecord | null;
  }

  async consumeSoftwarePcDownloadSession(
    sessionHash: string,
  ): Promise<SoftwarePcDownloadRecord | null> {
    const { data, error } = await this.admin.rpc('consume_software_pc_download_session', {
      p_pc_session_hash: sessionHash,
    });
    if (error) throw new BackendError(error.message);
    const row = Array.isArray(data) ? data[0] : null;
    return row
      ? {
          site_id: row.site_id,
          site_code: row.site_code,
          agent_user_key: row.agent_user_key,
          drive_file_id: row.drive_file_id,
          file_name: row.file_name,
        }
      : null;
  }

  async recentSoftwarePcDownloadSessions(limit = 50): Promise<SoftwarePcDownloadSessionRecord[]> {
    const result = await this.admin
      .from('software_pc_download_sessions')
      .select(
        'pc_session_hash, pairing_hash, site_id, site_code, agent_user_key, drive_file_id, file_name, created_at, expires_at, approved_at, consumed_at, revoked_at',
      )
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, Math.floor(limit))));
    if (result.error) throw new BackendError(result.error.message);
    return (result.data || []) as SoftwarePcDownloadSessionRecord[];
  }

  async siteById(siteId: string): Promise<InstallationSite | null> {
    const result = await this.admin.from('sites').select('*').eq('id', siteId).maybeSingle();
    if (result.error) throw new BackendError(result.error.message);
    return result.data ? rowToSite(result.data) : null;
  }
  async sites(): Promise<InstallationSite[]> {
    const rows = await this.completeRows('sites', 'id');
    return rows
      .map(rowToSite)
      .sort(
        (a, b) =>
          (a.siteCode || a.id).localeCompare(b.siteCode || b.id) || a.id.localeCompare(b.id),
      );
  }

  subscribeToPrivateChanges(onChange: (resources: PrivateResource[]) => void): RealtimeChannel {
    const families: Record<string, PrivateResource[]> = {
      sites: ['sites', 'activity'],
      profiles: ['profiles', 'users', 'templates', 'permissions', 'sites'],
      face_templates: ['templates', 'profiles', 'users'],
      system_documents: ['documents'],
      software_delivery_settings: ['software'],
      software_pc_download_sessions: ['software'],
      activity_logs: ['activity'],
      push_subscriptions: ['notifications'],
    };
    return this.admin
      .channel('server-private-invalidation-notifications')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        if (families[payload.table]) onChange(families[payload.table]);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onChange(Object.values(families).flat());
      });
  }
  subscribeToSiteChanges(onSiteChange: (siteId?: string) => void): RealtimeChannel {
    return this.admin
      .channel('server-site-change-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, (payload) => {
        // Forward only the opaque row ID; never expose other database fields.
        const currentRecord = payload.new as Record<string, unknown>;
        const previousRecord = payload.old as Record<string, unknown>;
        const siteId = currentRecord?.id ?? previousRecord?.id;
        if (typeof siteId === 'string' && siteId.length > 0 && siteId.length <= 128) {
          onSiteChange(siteId);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Reconcile clients after reconnects so missed change frames are recovered.
          onSiteChange();
        } else {
          console.warn(`Supabase site change subscription status: ${status}`);
        }
      });
  }
  async saveSites(sites: InstallationSite[], deleteIds: string[] = []) {
    if (sites.length) {
      for (let i = 0; i < sites.length; i += 100) {
        checked(
          await this.admin
            .from('sites')
            .upsert(sites.slice(i, i + 100).map(siteToRow), { onConflict: 'id' }),
        );
      }
    }
    if (deleteIds.length) checked(await this.admin.from('sites').delete().in('id', deleteIds));
  }
  /**
   * Permanent removal of site rows selected in the admin registry. Pending work is protected and
   * the whole batch is refused when one of its sites is pending, so a bulk delete can never
   * silently drop recoverable work. Certificate objects are removed first (best effort) so the
   * private bucket does not keep orphans.
   */
  async deleteSites(
    ids: string[],
  ): Promise<{ deleted: InstallationSite[]; pending: InstallationSite[] }> {
    const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
    if (!uniqueIds.length) return { deleted: [], pending: [] };

    const rows = checked(
      await this.admin.from('sites').select('*').in('id', uniqueIds).limit(uniqueIds.length),
    );
    const existing = (rows || []).map(rowToSite);
    const pending = existing.filter((site) => site.status === 'pending');
    if (pending.length) return { deleted: [], pending };

    for (const site of existing) {
      for (const document of site.documents || []) {
        if (!document?.storagePath) continue;
        try {
          await this.admin.storage.from('site-certificates').remove([document.storagePath]);
        } catch {
          // Orphaned objects are harmless; the row deletion is the source of truth.
        }
      }
    }

    if (existing.length) {
      checked(
        await this.admin
          .from('sites')
          .delete()
          .in(
            'id',
            existing.map((site) => site.id),
          )
          .select('id'),
      );
    }
    return { deleted: existing, pending: [] };
  }
  /** Conditional write + the existing partial unique index enforce atomic, single-active claims. */
  async saveSite(site: InstallationSite, expectedStatus: InstallationSite['status']) {
    const rows = checked(
      await this.admin
        .from('sites')
        .update(siteToRow(site))
        .eq('id', site.id)
        .eq('status', expectedStatus)
        .eq('workflow_version', site.workflowVersion || 0)
        .eq('target_devices', site.computerCount)
        .select('id'),
    );
    if (!rows.length)
      throw new BackendError('Site changed since you reviewed it. Refresh and try again.', 409);
  }
  /** Release just one authoritative record. Never round-trip directory summaries or
   * overwrite evidence saved while the confirmation dialog was open. */
  async releaseSiteReservation(
    siteId: string,
    expected: { version: number; owner: string; startedAt: string },
  ): Promise<{ site: InstallationSite; previous: InstallationSite }> {
    const result = await this.admin.from('sites').select('*').eq('id', siteId).maybeSingle();
    if (result.error) throw new BackendError(result.error.message);
    if (!result.data) throw new BackendError('Site not found.', 404);
    const row = result.data;
    const previous = rowToSite(row);
    if (previous.status === 'pending')
      throw new BackendError(
        'Pending work is protected. Use administrator recovery with an audit remark.',
        409,
      );
    if (previous.status !== 'in_progress')
      throw new BackendError(
        'Only an active reservation can be released. Refresh the sites list.',
        409,
      );
    const sameStart =
      previous.startedAt && expected.startedAt
        ? Date.parse(previous.startedAt) === Date.parse(expected.startedAt)
        : !previous.startedAt && !expected.startedAt;
    if (
      (previous.workflowVersion || 0) !== expected.version ||
      normalizeUserKey(previous.reservedByUser || '') !== expected.owner ||
      !sameStart
    )
      throw new BackendError(
        'The reservation changed since you reviewed it. Refresh before releasing it.',
        409,
      );
    const data = { ...row.site_data, status: 'available' };
    for (const key of [
      'reservedByUser',
      'reservedByName',
      'assignedToUser',
      'startedAt',
      'biometricArrivalVerification',
    ])
      delete data[key];
    const rows = checked(
      await this.admin
        .from('sites')
        .update({
          status: 'available',
          assigned_user_id: null,
          assigned_auth_user_id: null,
          reserved_at: null,
          site_data: data,
        })
        .eq('id', siteId)
        .eq('status', row.status)
        .eq('workflow_version', row.workflow_version || 0)
        .eq('updated_at', row.updated_at)
        .select('*'),
    );
    if (!rows.length)
      throw new BackendError('The site changed while releasing it. Refresh before retrying.', 409);
    return { site: rowToSite(rows[0]), previous };
  }

  async transitionSitePause(
    siteId: string,
    actorKey: string,
    action: 'pause' | 'resume' | 'recover',
    expectedVersion: number,
    reason: string,
    remark: string,
  ): Promise<InstallationSite> {
    const row = checked(
      await this.admin
        .rpc('transition_site_pause', {
          p_site_id: siteId,
          p_actor_key: actorKey,
          p_action: action,
          p_expected_version: expectedVersion,
          p_reason: reason,
          p_remark: remark,
        })
        .retry(false),
    );
    if (!row?.id || !['pending', 'in_progress', 'available'].includes(row.status))
      throw new BackendError('Invalid site transition response. Refresh before retrying.');
    return rowToSite(row);
  }

  async addSiteComputer(
    siteId: string,
    userKey: string,
    input: { remark: string; expectedCount: number; requestId: string },
  ): Promise<InstallationSite> {
    const result = await this.admin.rpc('add_site_computer', {
      p_site_id: siteId,
      p_user_key: normalizeUserKey(userKey),
      p_remark: input.remark,
      p_expected_count: input.expectedCount,
      p_request_id: input.requestId,
    });
    if (result.error) {
      const status =
        ({ PT400: 400, PT403: 403, PT404: 404, PT409: 409 } as Record<string, number>)[
          result.error.code || ''
        ] || 503;
      throw new BackendError(result.error.message || 'Unable to add the computer.', status);
    }
    return rowToSite(result.data);
  }

  /** One bounded atomic DB release; the database trigger writes the audit, including cron runs. */
  async expireReservations(): Promise<string[]> {
    const data = checked(
      await this.admin
        .rpc('release_expired_reservations_batch', { p_batch_size: 500 })
        .retry(false),
    );
    const ids = data?.expiredSiteIds;
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      ids.some((id: unknown) => typeof id !== 'string' || !id) ||
      new Set(ids).size !== ids.length
    )
      throw new BackendError('Invalid reservation expiry response. Refresh before retrying.');
    return ids;
  }

  /** Aggregate only requested accounts. Never fetch sites or biometric vectors for counts. */
  async userDirectorySummaries(keys: string[]): Promise<Map<string, UserDirectorySummary>> {
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length > 100000)
      throw new BackendError('Directory summary safety limit exceeded.');
    const summaries = new Map<string, UserDirectorySummary>();
    for (let i = 0; i < uniqueKeys.length; i += 500) {
      const requested = uniqueKeys.slice(i, i + 500);
      const data = checked(
        await this.admin.rpc('user_directory_summaries', { p_user_keys: requested }),
      );
      const rows = data?.rows;
      const expected = new Set(requested);
      if (!Array.isArray(rows) || rows.length !== expected.size)
        throw new BackendError('Incomplete directory summaries.');
      for (const row of rows) {
        if (
          !row ||
          !expected.delete(row.userKey) ||
          !Number.isSafeInteger(row.completed) ||
          row.completed < 0 ||
          !Number.isSafeInteger(row.inProgress) ||
          row.inProgress < 0 ||
          typeof row.facialEnrolled !== 'boolean' ||
          (row.facialPhoto !== null && typeof row.facialPhoto !== 'string')
        )
          throw new BackendError('Invalid directory summary response.');
        summaries.set(row.userKey, row);
      }
    }
    return summaries;
  }

  async faceTemplate(key: string): Promise<FaceTemplateRecord | null> {
    const result = await this.admin
      .from('face_templates')
      .select('*')
      .eq('user_key', normalizeUserKey(key))
      .maybeSingle();
    if (result.error) throw new BackendError(result.error.message);
    const r = result.data;
    return r && Array.isArray(r.embedding) && r.embedding.length === 128
      ? {
          personId: r.user_key,
          personName: r.person_name,
          embedding: r.embedding,
          enrolledAt: r.enrolled_at,
          photoThumbnail: r.photo_thumbnail || undefined,
          modelName: r.model_name,
        }
      : null;
  }
  async faceTemplates(): Promise<FaceTemplateRecord[]> {
    const rows = await this.completeRows('face_templates', 'user_key');
    return rows
      .filter((r: any) => Array.isArray(r.embedding) && r.embedding.length === 128)
      .map((r: any) => ({
        personId: r.user_key,
        personName: r.person_name,
        embedding: r.embedding,
        enrolledAt: r.enrolled_at,
        photoThumbnail: r.photo_thumbnail || undefined,
        modelName: r.model_name,
      }));
  }
  async saveFaceTemplate(t: FaceTemplateRecord) {
    checked(
      await this.admin.from('face_templates').upsert(
        {
          user_key: normalizeUserKey(t.personId),
          person_name: t.personName,
          embedding: t.embedding,
          photo_thumbnail: t.photoThumbnail || null,
          model_name: t.modelName,
          enrolled_at: t.enrolledAt,
        },
        { onConflict: 'user_key' },
      ),
    );
  }
  async deleteFaceTemplate(key: string) {
    checked(await this.admin.from('face_templates').delete().eq('user_key', normalizeUserKey(key)));
  }

  async recordLog(
    entry: Omit<ActivityLogEntry, 'id' | 'createdAt'> & { createdAt?: string },
  ): Promise<ActivityLogEntry> {
    const {
      eventType,
      actorUsername,
      actorEmail,
      actorRole,
      siteId,
      siteCode,
      siteName,
      district,
      previousStatus,
      newStatus,
      description,
      createdAt,
      ...metadata
    } = entry;
    const row = checked(
      await this.admin
        .from('activity_logs')
        .insert({
          event_type: eventType,
          actor_username: normalizeUserKey(actorUsername || 'system'),
          actor_email: actorEmail || null,
          actor_role: actorRole || 'agent',
          site_id: siteId || null,
          site_code: siteCode || null,
          site_name: siteName || null,
          district: district || null,
          previous_status: previousStatus || null,
          new_status: newStatus || null,
          description,
          metadata,
          created_at: timestamp(createdAt) || new Date().toISOString(),
        })
        .select('*')
        .single(),
    );
    return rowToLog(row);
  }
  /** Full read is for explicit exports, never interactive log browsing. */
  async logs(eventFilter?: 'attendance'): Promise<ActivityLogEntry[]> {
    const rows = await this.completeRows(
      'activity_logs',
      'id',
      '*',
      eventFilter ? { column: 'event_type', values: [eventFilter] } : undefined,
    );
    return rows.map(rowToLog);
  }

  async activityLogPage(input: ActivityLogQuery = {}): Promise<CursorActivityLogPage> {
    const query = parseActivityLogQuery(input);
    const data = checked(
      await this.admin.rpc('page_activity_logs', {
        p_page_size: query.pageSize,
        p_event_filter: query.eventFilter,
        p_search: query.searchQuery,
        p_start_date: query.startDate || null,
        p_end_date: query.endDate || null,
        p_before_created_at: query.before?.createdAt || null,
        p_before_id: query.before?.id || null,
      }),
    );
    if (
      !data ||
      !Array.isArray(data.rows) ||
      data.rows.length > query.pageSize + 1 ||
      data.rows.some((row: any) => !row || !isActivityLogId(row.id))
    )
      throw new BackendError('Database returned an invalid activity-log page.');
    const hasNextPage = data.rows.length > query.pageSize;
    const rows = data.rows.slice(0, query.pageSize);
    return {
      items: rows.map(rowToLog),
      pageSize: query.pageSize,
      hasNextPage,
      nextCursor: hasNextPage ? activityLogCursor(rows[rows.length - 1], query.fingerprint) : null,
      syncedWithSupabase: true,
    };
  }

  async uploadSiteCertificate(
    siteId: string,
    documentId: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<string> {
    const storagePath = `${siteId}/${documentId}`;
    checked(
      await this.admin.storage
        .from('site-certificates')
        .upload(storagePath, bytes, { contentType: mimeType, upsert: false }),
    );
    return storagePath;
  }

  async downloadSiteCertificate(storagePath: string) {
    const result = await this.admin.storage.from('site-certificates').download(storagePath);
    if (result.error) throw new BackendError(result.error.message);
    return {
      bytes: new Uint8Array(await result.data.arrayBuffer()),
      mimeType: result.data.type || 'application/octet-stream',
    };
  }

  async removeSiteCertificate(storagePath: string) {
    checked(await this.admin.storage.from('site-certificates').remove([storagePath]));
  }

  async documentMetadata(id: SystemDocumentType): Promise<SystemDocumentRecord | null> {
    const row = checked(
      await this.admin.from('system_documents').select('document_data').eq('id', id).maybeSingle(),
    );
    if (!row) return null;
    const d = row.document_data as SystemDocumentRecord;
    return {
      id,
      name: d.name,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
      isCustom: true,
      url: `/api/documents/${id.replaceAll('_', '-')}/view`,
    };
  }
  async document(id: SystemDocumentType): Promise<SystemDocumentRecord | null> {
    const result = await this.admin.from('system_documents').select('*').eq('id', id).maybeSingle();
    if (result.error) throw new BackendError(result.error.message);
    if (!result.data) return null;
    const record = result.data.document_data as SystemDocumentRecord;
    const signed = checked(
      await this.admin.storage
        .from('system-documents')
        .createSignedUrl(result.data.storage_path, 3600),
    );
    return { ...record, url: signed.signedUrl };
  }
  async saveDocument(record: SystemDocumentRecord, bytes: Uint8Array) {
    const old = checked<any>(
      await this.admin
        .from('system_documents')
        .select('storage_path')
        .eq('id', record.id)
        .maybeSingle(),
    );
    const storagePath = `${record.id}/${crypto.randomUUID()}`;
    checked(
      await this.admin.storage
        .from('system-documents')
        .upload(storagePath, bytes, { contentType: record.mimeType, upsert: false }),
    );
    const documentUrl = `/api/documents/${record.id.replace('_', '-')}/view`;
    try {
      checked(
        await this.admin.from('system_documents').upsert(
          {
            id: record.id,
            name: record.name,
            url: documentUrl,
            storage_path: storagePath,
            document_data: { ...record, url: documentUrl },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        ),
      );
    } catch (error) {
      await this.admin.storage.from('system-documents').remove([storagePath]);
      throw error;
    }
    if (old?.storage_path) {
      const { error } = await this.admin.storage
        .from('system-documents')
        .remove([old.storage_path]);
      if (error) console.warn('Could not remove replaced document object:', error.message);
    }
  }
  async deleteDocument(id: SystemDocumentType) {
    const old = checked<any>(
      await this.admin.from('system_documents').select('storage_path').eq('id', id).maybeSingle(),
    );
    checked(await this.admin.from('system_documents').delete().eq('id', id));
    if (old?.storage_path)
      checked(await this.admin.storage.from('system-documents').remove([old.storage_path]));
  }
}

export function authContext(user: User, profile: UserProfile): VerifiedAuthContext {
  const role = roleOf(profile.role);
  return {
    userId: user.id,
    userKey: profile.userKey,
    email: user.email || profile.email,
    role,
    allowedTabs: role === 'sub_admin' ? sanitizeAllowedTabs(profile.allowedTabs) : undefined,
  };
}
