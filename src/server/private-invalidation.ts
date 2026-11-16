import type { Express, Request, Response } from 'express';
import {
  PRIVATE_RESOURCES,
  isReadRequest,
  mutationResources,
  type PrivateResource,
} from '../lib/private-cache.ts';

type Scope = { userId: string; userKey: string; role: string; allowedTabs?: readonly string[] };
const scopeKey = (auth: Scope) =>
  JSON.stringify([auth.userId, auth.role, [...(auth.allowedTabs || [])].sort()]);
export function allowedInvalidations(auth: Scope): PrivateResource[] {
  if (auth.role === 'admin') return [...PRIVATE_RESOURCES];
  if (auth.role === 'agent')
    return [
      'sites',
      'profiles',
      'templates',
      'documents',
      'software',
      'permissions',
      'notifications',
    ];
  const tabs = auth.allowedTabs || [];
  return [
    ...new Set<PrivateResource>([
      'permissions',
      'notifications',
      'documents',
      ...(tabs.includes('sites') || tabs.includes('analytics') ? ['sites' as const] : []),
      ...(tabs.includes('users') ? (['users', 'profiles', 'templates'] as const) : []),
      ...(tabs.includes('activity_log') ? ['activity' as const] : []),
      ...(tabs.includes('documents') ? ['documents' as const] : []),
    ]),
  ];
}
/** Coarse authorized signals only: no row IDs, user names, documents, tokens or payload values. */
export function attachPrivateInvalidations(
  app: Express,
  authenticate: (request: Request) => Promise<Scope | null>,
  onInvalidation: (resources: readonly PrivateResource[]) => void = () => {},
) {
  const clients = new Set<{ req: Request; res: Response; scope: string; busy: boolean }>();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dirty = new Set<PrivateResource>();
  const send = async (
    client: typeof clients extends Set<infer T> ? T : never,
    resources: readonly PrivateResource[],
  ) => {
    if (client.busy || client.res.destroyed || client.res.writableEnded) return;
    client.busy = true;
    try {
      const auth = await authenticate(client.req);
      if (!clients.has(client)) return;
      if (!auth || scopeKey(auth) !== client.scope) {
        client.res.write('event: access-changed\ndata: {}\n\n');
        client.res.end();
        clients.delete(client);
        return;
      }
      const allowed = allowedInvalidations(auth);
      const filtered = resources.filter((resource) => allowed.includes(resource));
      if (filtered.length)
        client.res.write(`event: invalidate\ndata: ${JSON.stringify({ resources: filtered })}\n\n`);
    } catch {
      // Authentication could not be verified right now (backend unavailable, timeout).
      // That is not a revocation, so send nothing and keep the stream: telling the client
      // "access changed" would make it clear private state and blank the screen for what is
      // usually a transient outage. Every API request re-authorizes on its own, and the next
      // change re-checks this stream — a genuine revocation arrives as `authenticate()`
      // returning null, which is handled above.
    } finally {
      client.busy = false;
    }
  };
  const notify = (resources: readonly PrivateResource[]) => {
    if (disposed) return;
    onInvalidation(resources);
    resources.forEach((resource) => dirty.add(resource));
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const resources = [...dirty];
      dirty.clear();
      for (const client of clients) void send(client, resources);
    }, 100);
    timer.unref();
  };
  app.use((req, res, next) => {
    res.once('finish', () => {
      if (
        req.path.startsWith('/api/') &&
        res.statusCode >= 200 &&
        res.statusCode < 300 &&
        !isReadRequest(req.path, req.method) &&
        !/sign-in|sign-out|reset-password/.test(req.path)
      )
        notify(mutationResources(req.path));
    });
    next();
  });
  app.get('/api/supabase/cache-events', async (req, res) => {
    let auth: Scope | null = null;
    try {
      auth = await authenticate(req);
    } catch {
      /* Deny connection. */
    }
    if (!auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, private',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const client = { req, res, scope: scopeKey(auth), busy: false };
    clients.add(client);
    res.write('event: ready\ndata: {}\n\n');
    res.on('close', () => clients.delete(client));
  });
  // SSE transport keep-alive only: no auth lookup, invalidation or database query.
  // Prevent proxy idle disconnects from turning into repeated reconnect/data reads.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.res.destroyed && !client.res.writableEnded) client.res.write(': keep-alive\n\n');
    }
  }, 25000);
  heartbeat.unref();
  // No timed invalidations: idle clients must not cause periodic database reads.
  // Actual changes and browser focus/reconnect/manual refresh provide recovery.
  return {
    notify,
    dispose: () => {
      disposed = true;
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      for (const client of clients) client.res.end();
      clients.clear();
    },
  };
}
