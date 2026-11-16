import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
const context = new AsyncLocalStorage<{
  start: number;
  dbMs: number;
  dbCalls: number;
  read: boolean;
}>();
const startedAt = Date.now();
export const requestPerformance: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  context.run(
    {
      start: performance.now(),
      dbMs: 0,
      dbCalls: 0,
      read:
        req.method === 'GET' || (req.method === 'POST' && req.path === '/api/supabase/list-users'),
    },
    () => {
      const json = res.json.bind(res);
      res.json = (body: any) => {
        const current = context.getStore();
        if (!res.headersSent && current) {
          res.setHeader(
            'Server-Timing',
            `app;dur=${(performance.now() - current.start).toFixed(1)}, db;dur=${current.dbMs.toFixed(1)}, db_calls;desc="${current.dbCalls}", startup;desc="${Date.now() - startedAt < 30000 ? 'startup-window' : 'warm'}"`,
          );
          res.setHeader('X-Response-Bytes', Buffer.byteLength(JSON.stringify(body) ?? ''));
        }
        return json(body);
      };
      next();
    },
  );
};
/** Time each DB/Auth hop, with a bounded deadline including any SDK attempts. No query/PII logging. */
export function measuredDatabaseFetch(
  fetcher: typeof fetch = globalThis.fetch,
  limits = { hopMs: 8000, readMs: 12000 },
): typeof fetch {
  return async (url, options = {}) => {
    const state = context.getStore();
    const start = performance.now();
    const remaining = state?.read ? limits.readMs - (start - state.start) : Infinity;
    if (remaining <= 0) throw new DOMException('Database request deadline exceeded.', 'AbortError');
    const abort = new AbortController();
    const timer = state?.read
      ? setTimeout(() => abort.abort(), Math.min(limits.hopMs, remaining))
      : undefined;
    const relay = () => abort.abort();
    options.signal?.addEventListener('abort', relay, { once: true });
    if (options.signal?.aborted) abort.abort();
    try {
      const response = await fetcher(url, { ...options, signal: abort.signal });
      // Include body transfer in both the deadline and DB timing, not merely time-to-headers.
      const bytes = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', relay);
      if (state) {
        state.dbCalls++;
        state.dbMs += performance.now() - start;
      }
    }
  };
}
export function performanceEnvironment() {
  const safe = (value?: string) =>
    value && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : 'unknown';
  return {
    processAgeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    appRegion: safe(
      process.env.APP_REGION ||
        process.env.FLY_REGION ||
        process.env.VERCEL_REGION ||
        process.env.RENDER_REGION ||
        process.env.AWS_REGION,
    ),
    databaseRegion: safe(process.env.SUPABASE_DB_REGION),
    note: 'Regions are deployment configuration, not geolocated measurements. Compare API timings before changing hosting.',
  };
}
