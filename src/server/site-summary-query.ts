import { createHash } from 'node:crypto';
import type { SiteSummaryQuery } from '../utils/site-summary';
export class SiteSummaryQueryError extends Error {}
export function parseSiteSummaryQuery(input: SiteSummaryQuery, userKey: string) {
  const q = {
    scope: input.scope ?? 'all',
    district: input.district || 'all',
    status: input.status || 'all',
    search: (input.search || '').trim(),
    sort: input.sort || 'district',
    startDate: input.startDate || '',
    endDate: input.endDate || '',
    pageSize: input.pageSize ?? 30,
  };
  const validDate = (d: string) =>
    !d ||
    (/^\d{4}-\d{2}-\d{2}$/.test(d) &&
      Number.isFinite(Date.parse(d)) &&
      new Date(d).toISOString().slice(0, 10) === d);
  if (
    !['all', 'completed', 'pending'].includes(q.scope) ||
    !['all', 'available', 'in_progress', 'pending', 'completed'].includes(q.status) ||
    !['district', 'name', 'pending', 'completion'].includes(q.sort) ||
    (q.sort === 'completion' && q.scope !== 'completed') ||
    !Number.isInteger(q.pageSize) ||
    q.pageSize < 1 ||
    q.pageSize > 50 ||
    q.search.length > 100 ||
    q.district.length > 80 ||
    !validDate(q.startDate) ||
    !validDate(q.endDate) ||
    (q.startDate && q.endDate && q.startDate > q.endDate)
  )
    throw new SiteSummaryQueryError('Invalid site filters, date range or page size.');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([userKey, q]))
    .digest('hex');
  let after: string[] | null = null;
  if (input.cursor) {
    try {
      if (
        typeof input.cursor !== 'string' ||
        input.cursor.length > 4096 ||
        !/^[A-Za-z0-9_-]+$/.test(input.cursor)
      )
        throw Error();
      const c = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
      if (
        c.v !== 1 ||
        c.f !== fingerprint ||
        !Array.isArray(c.k) ||
        c.k.length !== 3 ||
        c.k.some((v: unknown) => typeof v !== 'string' || v.length > 512) ||
        !c.k[2]
      )
        throw Error();
      after = c.k;
    } catch {
      throw new SiteSummaryQueryError(
        'Invalid or expired site navigation cursor. Refresh the list.',
      );
    }
  }
  return { ...q, fingerprint, after };
}
export function siteSummaryCursor(keys: string[], fingerprint: string) {
  return Buffer.from(JSON.stringify({ v: 1, f: fingerprint, k: keys })).toString('base64url');
}
