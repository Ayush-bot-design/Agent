import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { normalizeUserKey } from '../utils/deployment-logic.ts';
import { profileToRow, rowToProfile, siteToRow, rowToSite } from './supabase-backend.ts';

/** Loopback HTTP implementation of the Supabase REST/Auth/Storage contracts used by tests.
 * Tests exercise the real Supabase SDK and Express routes, not a replacement application backend.
 */
export async function startSupabaseTestHttp(
  seed: { profiles?: any[]; sites?: any[]; logs?: any[] } = {},
  behavior: {
    maxRows?: number;
    failTableAfter?: { table: string; after: string };
    repeatPagesFor?: string;
    failRpc?: string;
    beforeSitePatch?: (rows: any[]) => void;
  } = {},
) {
  const tables: Record<string, any[]> = {
    profiles: (seed.profiles || []).map(profileToRow),
    sites: (seed.sites || []).map((s) => ({
      ...siteToRow(s),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    activity_logs: seed.logs || [],
    face_templates: [],
    profile_identity_audits: [],
    site_pause_events: [],
    system_documents: [],
  };
  let nextSerial =
    Math.max(
      1000,
      ...tables.profiles.map((p) => Number(/^SN-UP-(\d+)$/.exec(p.serial_no || '')?.[1]) || 0),
    ) + 1;
  const identityOf = (p: any) => ({
    address: p.address,
    legalProofType: p.legal_proof_type,
    legalProofNumber: p.legal_proof_number,
    legalProofDoc: p.profile_data?.legalProofDoc,
  });
  const preserveIdentity = (old: any, incoming: any) => ({
    ...incoming,
    serial_no: old.serial_no,
    address: old.address,
    legal_proof_type: old.legal_proof_type,
    legal_proof_number: old.legal_proof_number,
    profile_data: { ...incoming.profile_data, ...identityOf(old), serialNo: old.serial_no },
  });
  const users = new Map<string, any>();
  const passwords = new Map<string, string>();
  const objects = new Map<string, Uint8Array>();
  const objectMimeTypes = new Map<string, string>();
  const requests: { method: string; path: string; query?: string; key?: string }[] = [];
  for (const row of tables.profiles) {
    if (!row.user_id) continue;
    const user = {
      id: row.user_id,
      email: row.email,
      created_at: new Date().toISOString(),
      user_metadata: { username: row.user_key, full_name: row.full_name },
      app_metadata: { role: row.role },
    };
    users.set(user.id, user);
    passwords.set(user.email, 'AdminStrongPass!2026');
    if (row.user_key === 'field_agent_1') passwords.set(user.email, 'AgentStrongPass!2026');
  }
  const json = (res: http.ServerResponse, status: number, body: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const body =
      raw.length && req.headers['content-type']?.includes('json')
        ? JSON.parse(raw.toString())
        : null;
    requests.push({
      method: req.method || '',
      path: url.pathname,
      query: url.search,
      key: req.headers.apikey as string,
    });
    if (req.headers.apikey !== 'test-service-role-key') {
      json(res, 401, { message: 'Invalid API key' });
      return;
    }
    if (url.pathname === '/auth/v1/token') {
      const user = [...users.values()].find((u) => u.email === body.email);
      if (!user || passwords.get(user.email) !== body.password) {
        json(res, 400, { message: 'Invalid login credentials' });
        return;
      }
      user.last_sign_in_at = new Date().toISOString();
      json(res, 200, {
        access_token: `auth-${user.id}`,
        refresh_token: 'test-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      });
      return;
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const user = users.get((req.headers.authorization || '').replace('Bearer auth-', ''));
      if (!user) {
        json(res, 401, { message: 'Invalid token' });
        return;
      }
      json(res, 200, user);
      return;
    }
    if (url.pathname === '/auth/v1/recover') {
      json(res, 200, {});
      return;
    }
    if (url.pathname.startsWith('/auth/v1/admin/users')) {
      const id = url.pathname.split('/').pop()!;
      if (req.method === 'POST') {
        if ([...users.values()].some((u) => u.email === body.email)) {
          json(res, 422, { message: 'Email already registered' });
          return;
        }
        const user = {
          id: crypto.randomUUID(),
          email: body.email,
          created_at: new Date().toISOString(),
          user_metadata: body.user_metadata || {},
          app_metadata: body.app_metadata || {},
        };
        users.set(user.id, user);
        passwords.set(user.email, body.password);
        json(res, 200, user);
        return;
      }
      const user = users.get(id);
      if (!user) {
        json(res, 404, { message: 'User not found' });
        return;
      }
      if (req.method === 'DELETE') {
        users.delete(id);
        passwords.delete(user.email);
        tables.profiles = tables.profiles.filter((p) => p.user_id !== id);
        json(res, 200, {});
        return;
      }
      if (req.method === 'GET') {
        json(res, 200, user);
        return;
      }
      if (req.method === 'PUT') {
        if (body.password) passwords.set(user.email, body.password);
        if (body.app_metadata) user.app_metadata = { ...user.app_metadata, ...body.app_metadata };
        json(res, 200, user);
        return;
      }
    }
    if (behavior.failRpc && url.pathname === `/rest/v1/rpc/${behavior.failRpc}`) {
      json(res, 503, { message: 'Injected RPC failure' });
      return;
    }
    if (url.pathname === '/rest/v1/rpc/transition_site_pause') {
      const fail = (status: number, message: string) =>
        json(res, status, { code: `PT${status}`, message });
      const actor = tables.profiles.find((p) => p.user_key === body.p_actor_key);
      const row = tables.sites.find((s) => s.id === body.p_site_id);
      if (!actor || !['agent', 'admin'].includes(actor.role)) {
        fail(403, 'Not authorized');
        return;
      }
      if (!row) {
        fail(404, 'Site not found');
        return;
      }
      if ((row.workflow_version || 0) !== body.p_expected_version) {
        fail(409, 'The site changed. Refresh before trying again.');
        return;
      }
      const action = body.p_action;
      const old = structuredClone(row);
      if (
        action !== 'resume' &&
        (body.p_remark.trim().length < 10 || body.p_remark.trim().length > 500)
      ) {
        fail(400, 'Add a short remark of 10–500 characters.');
        return;
      }
      if (action === 'pause') {
        if (row.status !== 'in_progress' || row.assigned_user_id !== actor.user_key) {
          fail(403, 'Only the currently assigned agent can pause this site.');
          return;
        }
        if (
          ![
            'office_closed',
            'access_denied',
            'power_network',
            'equipment_issue',
            'personal_emergency',
            'other',
          ].includes(body.p_reason)
        ) {
          fail(400, 'Select a valid pause reason.');
          return;
        }
        if (Date.parse(row.reserved_at) <= Date.now() - 86400000) {
          fail(409, 'Reservation expired');
          return;
        }
        row.pending_issue = {
          agentUserKey: actor.user_key,
          agentUserId: actor.user_id,
          agentName: actor.full_name,
          serialNo: actor.serial_no,
          reason: body.p_reason,
          remark: body.p_remark.trim(),
          pausedAt: new Date().toISOString(),
        };
        row.status = 'pending';
        row.assigned_user_id = null;
        row.reserved_at = null;
        for (const key of ['reservedByUser', 'reservedByName', 'startedAt'])
          delete row.site_data[key];
      } else {
        if (row.status !== 'pending') {
          fail(409, 'Site is no longer pending');
          return;
        }
        if (action === 'resume') {
          if (
            row.pending_issue.agentUserKey !== actor.user_key ||
            row.pending_issue.agentUserId !== actor.user_id ||
            row.pending_issue.serialNo !== actor.serial_no
          ) {
            fail(403, 'Only the original agent can resume.');
            return;
          }
          if (
            tables.sites.some(
              (s) =>
                s.id !== row.id &&
                ['reserved', 'in_progress'].includes(s.status) &&
                s.assigned_user_id === actor.user_key,
            )
          ) {
            fail(409, 'Complete or pause your other active site first.');
            return;
          }
          row.status = 'in_progress';
          row.assigned_user_id = actor.user_key;
          row.reserved_at = new Date().toISOString();
          Object.assign(row.site_data, {
            reservedByUser: actor.user_key,
            reservedByName: actor.full_name,
            startedAt: row.reserved_at,
          });
        } else {
          if (actor.role !== 'admin') {
            fail(403, 'Only a super administrator can recover.');
            return;
          }
          row.status = 'available';
          row.assigned_user_id = null;
          row.reserved_at = null;
        }
        row.pending_issue = null;
      }
      row.workflow_version = (row.workflow_version || 0) + 1;
      row.site_data.status = row.status;
      row.site_data.workflowVersion = row.workflow_version;
      if (row.pending_issue) row.site_data.pendingIssue = row.pending_issue;
      else delete row.site_data.pendingIssue;
      tables.site_pause_events.push({
        site_id: row.id,
        actor_user_key: actor.user_key,
        action,
        work_snapshot: old,
      });
      tables.activity_logs.push({
        id: crypto.randomUUID(),
        event_type: 'status_change',
        actor_username: actor.user_key,
        site_id: row.id,
        previous_status: old.status,
        new_status: row.status,
        description: action,
        metadata: { serialNo: actor.serial_no },
        created_at: new Date().toISOString(),
      });
      json(res, 200, row);
      return;
    }
    if (url.pathname === '/rest/v1/rpc/user_directory_summaries') {
      const counts = new Map<string, { completed: number; inProgress: number }>();
      for (const row of tables.sites) {
        const site = rowToSite(row);
        if (!['completed', 'in_progress'].includes(site.status)) continue;
        const owner = normalizeUserKey(
          site.status === 'completed'
            ? site.completedByUser || site.reservedByUser || site.assignedToUser || ''
            : site.reservedByUser || site.assignedToUser || '',
        );
        const count = counts.get(owner) || { completed: 0, inProgress: 0 };
        if (site.status === 'completed') count.completed++;
        else count.inProgress++;
        counts.set(owner, count);
      }
      const rows = [...new Set<string>(body.p_user_keys)].map((userKey) => {
        const template = tables.face_templates.find(
          (f) => f.user_key === userKey && Array.isArray(f.embedding) && f.embedding.length === 128,
        );
        return {
          userKey,
          ...(counts.get(userKey) || { completed: 0, inProgress: 0 }),
          facialEnrolled: Boolean(template),
          facialPhoto: template?.photo_thumbnail ?? null,
        };
      });
      json(res, 200, { rows });
      return;
    }
    if (url.pathname === '/rest/v1/rpc/page_activity_logs') {
      const time = (value: string) =>
        BigInt(Math.floor(Date.parse(value) / 1000)) * 1000000n +
        BigInt((/\.(\d+)/.exec(value)?.[1] || '').padEnd(6, '0').slice(0, 6));
      const compare = (a: any, b: any) =>
        time(a.created_at) === time(b.created_at)
          ? a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0
          : time(a.created_at) < time(b.created_at)
            ? -1
            : 1;
      const search = (body.p_search || '').trim().toLowerCase();
      const rows = tables.activity_logs
        .filter((a) => {
          const m = a.metadata || {};
          const searchable = [
            a.actor_username,
            a.actor_email,
            a.site_name,
            a.site_code,
            a.district,
            a.previous_status,
            a.new_status,
            a.description,
            m.actorFullName,
            m.serialNo,
            m.verificationId,
          ]
            .filter((v) => v != null)
            .join(' ')
            .toLowerCase();
          return (
            (body.p_event_filter === 'all' || a.event_type === body.p_event_filter) &&
            (!search || searchable.includes(search)) &&
            (!body.p_start_date || Date.parse(a.created_at) >= Date.parse(body.p_start_date)) &&
            (!body.p_end_date ||
              Date.parse(a.created_at) < Date.parse(body.p_end_date) + 86400000) &&
            (!body.p_before_created_at ||
              compare(a, { created_at: body.p_before_created_at, id: body.p_before_id }) < 0)
          );
        })
        .sort((a, b) => -compare(a, b))
        .slice(0, body.p_page_size + 1);
      json(res, 200, { rows });
      return;
    }
    if (url.pathname === '/rest/v1/rpc/review_profile_identity') {
      const fail = (status: number, message: string) =>
        json(res, status, { code: `PT${status}`, message });
      const actor = tables.profiles.find((p) => p.user_key === body.p_actor_key);
      if (
        actor?.role !== 'admin' ||
        (body.p_action === 'verify' && body.p_actor_key === body.p_target_key)
      ) {
        fail(403, 'Only another super administrator can verify identity.');
        return;
      }
      const row = tables.profiles.find((p) => p.user_key === body.p_target_key);
      if (!row) {
        fail(404, 'Profile not found.');
        return;
      }
      if (row.updated_at !== body.p_expected_updated_at) {
        fail(409, 'Profile changed. Reload and review the current evidence.');
        return;
      }
      const previous = identityOf(row);
      const identity =
        body.p_action === 'replace'
          ? body.p_identity
          : {
              ...previous,
              legalProofDoc: {
                ...previous.legalProofDoc,
                verified: true,
                verificationVersion: 1,
                verifiedBy: body.p_actor_key,
                verifiedAt: new Date().toISOString(),
              },
            };
      row.address = identity.address;
      row.legal_proof_type = identity.legalProofType;
      row.legal_proof_number = identity.legalProofNumber;
      row.profile_data = { ...row.profile_data, ...identity };
      row.updated_at = new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString();
      tables.profile_identity_audits.push({
        user_key: body.p_target_key,
        actor_user_key: body.p_actor_key,
        action: body.p_action,
        previous_identity: previous,
        new_identity: identity,
      });
      json(res, 200, row);
      return;
    }
    if (url.pathname === '/rest/v1/rpc/add_site_computer') {
      const fail = (status: number, message: string) =>
        json(res, status, { code: `PT${status}`, message });
      const row = tables.sites.find((site) => site.id === body.p_site_id);
      if (!row) {
        fail(404, 'Site not found.');
        return;
      }
      if (row.status !== 'in_progress') {
        fail(409, 'Extra computers can only be added to an active installation.');
        return;
      }
      if (row.assigned_user_id !== body.p_user_key) {
        fail(403, 'Only the assigned technician can add computers.');
        return;
      }
      const data = row.site_data;
      const additions = data.additionalComputers || [];
      const existing = additions.find((entry: any) => entry.requestId === body.p_request_id);
      if (existing) {
        if (existing.remark !== body.p_remark.trim()) {
          fail(409, 'This request ID was already used with a different remark.');
          return;
        }
        json(res, 200, row);
        return;
      }
      const count = row.target_devices || 1;
      if (count !== body.p_expected_count) {
        fail(409, 'The computer count changed. Refresh and review before adding another computer.');
        return;
      }
      if (additions.length >= 50) {
        fail(400, 'The limit of 50 extra computers has been reached.');
        return;
      }
      const vers = (
        data.hostnameVerifications?.length
          ? data.hostnameVerifications
          : data.hostnameVerification
            ? [data.hostnameVerification]
            : []
      ).slice(0, count);
      while (vers.length < count + 1) vers.push({ verified: false, hostname: '' });
      row.target_devices = count + 1;
      row.site_data = {
        ...data,
        originalComputerCount: data.originalComputerCount ?? count,
        computerCount: count + 1,
        hostnameVerifications: vers,
        milestones: (data.milestones || []).map((m: any) =>
          m.id === 'hostname_verify' ? { ...m, completed: false } : m,
        ),
        additionalComputers: [
          ...additions,
          {
            requestId: body.p_request_id,
            computerIndex: count,
            remark: body.p_remark.trim(),
            addedByUser: body.p_user_key,
            addedAt: new Date().toISOString(),
          },
        ],
      };
      json(res, 200, row);
      return;
    }
    if (url.pathname === '/rest/v1/rpc/release_expired_reservations_batch') {
      const expiredSiteIds: string[] = [];
      for (const row of tables.sites) {
        if (expiredSiteIds.length >= body.p_batch_size) break;
        if (
          ['in_progress', 'reserved'].includes(row.status) &&
          Date.parse(row.reserved_at || row.updated_at || row.created_at) <=
            Date.now() - 24 * 3600 * 1000
        ) {
          const previousStatus = row.status;
          row.status = 'available';
          row.assigned_user_id = null;
          row.assigned_auth_user_id = null;
          row.reserved_at = null;
          row.site_data = { ...row.site_data, status: 'available' };
          for (const key of [
            'reservedByUser',
            'reservedByName',
            'startedAt',
            'biometricArrivalVerification',
          ])
            delete row.site_data[key];
          tables.activity_logs.push({
            id: crypto.randomUUID(),
            event_type: 'status_change',
            actor_username: 'system_cron_24h',
            actor_role: 'system',
            site_id: row.id,
            site_code: row.site_code,
            site_name: row.client_name,
            district: row.district,
            previous_status: previousStatus,
            new_status: 'available',
            description: `24h SLA auto-reset released site "${row.client_name}" (${row.district}).`,
            metadata: {},
            created_at: new Date().toISOString(),
          });
          expiredSiteIds.push(row.id);
        }
      }
      json(res, 200, { expiredSiteIds });
      return;
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      json(res, 200, {
        signedURL: `/storage/v1/object/sign/${url.pathname.split('/sign/')[1]}?token=test`,
      });
      return;
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\//, ''));
      if (req.method === 'POST') {
        objects.set(path, new Uint8Array(raw));
        objectMimeTypes.set(
          path,
          String(req.headers['content-type'] || 'application/octet-stream'),
        );
        json(res, 200, { Key: path });
        return;
      }
      if (req.method === 'GET') {
        const objectPath = path.startsWith('authenticated/')
          ? path.slice('authenticated/'.length)
          : path;
        const stored = objects.get(objectPath);
        if (!stored) {
          json(res, 404, { message: 'Object not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': objectMimeTypes.get(objectPath) || 'application/octet-stream',
        });
        res.end(Buffer.from(stored));
        return;
      }
      if (req.method === 'DELETE') {
        const bucket = path;
        const prefixes = body?.prefixes || [];
        const removed: { name: string }[] = [];
        prefixes.forEach((prefix: string) => {
          for (const key of objects.keys()) {
            if (key.startsWith(`${bucket}/${prefix}`)) {
              objects.delete(key);
              objectMimeTypes.delete(key);
              removed.push({ name: key.slice(bucket.length + 1) });
            }
          }
        });
        json(res, 200, removed);
        return;
      }
    }
    if (!url.pathname.startsWith('/rest/v1/')) {
      json(res, 404, { message: `Unhandled test route ${url.pathname}` });
      return;
    }
    const table = url.pathname.slice('/rest/v1/'.length);
    if (!tables[table]) {
      json(res, 404, { message: `Unknown table ${table}` });
      return;
    }
    if (table === 'sites' && req.method === 'PATCH') behavior.beforeSitePatch?.(tables.sites);
    let rows = [...tables[table]];
    // Match the narrow auth projection used by the real PostgREST endpoint.
    if (url.searchParams.get('select')?.includes('allowed_tabs:profile_data->allowedTabs'))
      rows = rows.map((row) => ({ ...row, allowed_tabs: row.profile_data?.allowedTabs }));
    for (const [key, value] of url.searchParams) {
      if (['select', 'order', 'on_conflict', 'offset', 'limit'].includes(key)) continue;
      const dot = value.indexOf('.');
      const op = value.slice(0, dot);
      const operand = value.slice(dot + 1);
      rows = rows.filter((r) =>
        op === 'gt'
          ? behavior.repeatPagesFor === table || String(r[key]) > operand
          : op === 'eq'
            ? String(r[key]) === operand
            : op === 'ilike'
              ? String(r[key]).toLowerCase() === operand.toLowerCase()
              : op === 'in'
                ? operand
                    .replace(/^\(|\)$/g, '')
                    .split(',')
                    .includes(String(r[key]))
                : false,
      );
    }
    const single = req.headers.accept?.includes('application/vnd.pgrst.object+json');
    if (req.method === 'GET') {
      const failure = behavior.failTableAfter;
      if (
        failure?.table === table &&
        [...url.searchParams.values()].includes(`gt.${failure.after}`)
      ) {
        json(res, 503, { message: 'Injected page failure' });
        return;
      }
      const order = url.searchParams.get('order');
      if (order)
        rows.sort((a, b) => {
          for (const clause of order.split(',')) {
            const [column, direction] = clause.split('.');
            const result = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
            if (result) return direction === 'desc' ? -result : result;
          }
          return 0;
        });
      const offset = Number(url.searchParams.get('offset') || 0);
      const requested = Number(url.searchParams.get('limit') || behavior.maxRows || 1000);
      rows = rows.slice(offset, offset + Math.min(requested, behavior.maxRows || 1000));

      json(
        res,
        single && !rows.length ? 406 : 200,
        single ? rows[0] || { message: 'Not found', code: 'PGRST116' } : rows,
      );
      return;
    }
    if (req.method === 'POST') {
      const input = Array.isArray(body) ? body : [body];
      if (table === 'activity_logs') {
        const constraint = ['login', 'status_change', 'attendance', 'user_created', 'site_created'];
        if (input.some((r) => !constraint.includes(r.event_type))) {
          json(res, 400, { message: 'Invalid activity event type' });
          return;
        }
      }
      for (let i = 0; i < input.length; i++) {
        let row = input[i];
        row.id ||= crypto.randomUUID();
        row.created_at ||= new Date().toISOString();
        if (table === 'profiles') {
          row.user_key ||= row.id;
          row.profile_data ||= {};
        }
        const conflictKey = url.searchParams.get('on_conflict');
        const key = conflictKey || 'id';
        const index = tables[table].findIndex(
          (r) => r[key] === row[key] || (table === 'profiles' && r.user_key === row.user_key),
        );
        if (index >= 0 && !conflictKey) {
          json(res, 409, { code: '23505', message: 'Duplicate key' });
          return;
        }
        if (table === 'profiles') {
          if (index >= 0) row = preserveIdentity(tables[table][index], row);
          else {
            row.serial_no = `SN-UP-${nextSerial++}`;
            row.profile_data.serialNo = row.serial_no;
          }
          row.updated_at = new Date(
            Math.max(Date.now(), Date.parse(tables[table][index]?.updated_at || '') + 1 || 0),
          ).toISOString();
        }
        if (index >= 0) tables[table][index] = { ...tables[table][index], ...row };
        else tables[table].push(row);
        input[i] = row;
      }
      json(res, 201, single ? input[0] : input);
      return;
    }
    if (req.method === 'PATCH') {
      if (
        table === 'sites' &&
        rows.some(
          (row) =>
            row.status === 'pending' ||
            body.status === 'pending' ||
            (body.workflow_version !== undefined && body.workflow_version !== row.workflow_version),
        )
      ) {
        json(res, 409, {
          code: 'PT409',
          message: 'Pending work is protected. Use dedicated resume/recovery.',
        });
        return;
      }

      if (
        table === 'sites' &&
        rows.length > 0 &&
        body.status === 'in_progress' &&
        body.assigned_user_id &&
        tables.sites.some(
          (s) =>
            !rows.some((r) => r.id === s.id) &&
            s.status === 'in_progress' &&
            s.assigned_user_id === body.assigned_user_id,
        )
      ) {
        json(res, 409, { code: '23505', message: 'One active site per user' });
        return;
      }
      rows.forEach((row) =>
        Object.assign(row, table === 'profiles' ? preserveIdentity(row, body) : body, {
          updated_at: new Date().toISOString(),
        }),
      );
      json(res, 200, single ? rows[0] || {} : rows);
      return;
    }
    if (req.method === 'DELETE') {
      tables[table] = tables[table].filter((r) => !rows.some((x) => x.id === r.id));
      json(res, 200, rows);
      return;
    }
    json(res, 405, { message: 'Method not supported' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    tables,
    users,
    passwords,
    objects,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
