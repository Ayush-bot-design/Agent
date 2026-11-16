import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../../server.ts';

const hmacSecret = 'site-realtime-test-secret-with-at-least-thirty-two-characters';

function sessionCookie(userKey: string, role: 'admin' | 'sub_admin' | 'agent') {
  const now = Math.floor(Date.now() / 1000);
  const sub = `id-${userKey}`;
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      userKey,
      email: `${userKey}@example.test`,
      role,
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', hmacSecret).update(payload).digest('base64url');
  return `aether_session=st1.${payload}.${signature}`;
}

test('site event stream is authenticated and sends role-scoped minimal invalidations', async () => {
  let notifySiteChanged: ((siteId?: string) => void) | undefined;
  let unsubscribeCount = 0;
  const backend = {
    getAuthProfile: async (userKey: string) => ({
      userKey,
      userId: `id-${userKey}`,
      email: `${userKey}@example.test`,
      role: userKey === 'analytics_user' || userKey === 'no_tabs' ? 'sub_admin' : 'agent',
      allowedTabs: userKey === 'analytics_user' ? ['analytics'] : [],
    }),
    sites: async () => [],
    subscribeToSiteChanges: (listener: (siteId?: string) => void) => {
      notifySiteChanged = listener;
      return {
        unsubscribe: async () => {
          unsubscribeCount += 1;
          return 'ok';
        },
      };
    },
  };
  const app = await createApp({ backend: backend as any, hmacSecret });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server failed to bind.');
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const unauthorized = await fetch(`${origin}/api/supabase/site-events`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${origin}/api/supabase/site-events`, {
      headers: { Cookie: sessionCookie('agent_user', 'agent') },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reader = response.body!.getReader();
    const ready = await reader.read();
    assert.match(new TextDecoder().decode(ready.value), /event: ready/);

    notifySiteChanged?.('site-opaque-1');
    const notification = await reader.read();
    const message = new TextDecoder().decode(notification.value);
    assert.match(message, /event: site-changed/);
    assert.match(message, /data: \{"siteId":"site-opaque-1"\}/);
    assert.doesNotMatch(message, /hostname|contactPhone|documents|site_code/i);
    await reader.cancel();

    const analyticsOnly = await fetch(`${origin}/api/supabase/site-events`, {
      headers: { Cookie: sessionCookie('analytics_user', 'sub_admin') },
    });
    assert.equal(analyticsOnly.status, 200);
    const analyticsReader = analyticsOnly.body!.getReader();
    await analyticsReader.read();
    notifySiteChanged?.('site-opaque-2');
    const analyticsNotification = await analyticsReader.read();
    const analyticsMessage = new TextDecoder().decode(analyticsNotification.value);
    assert.match(analyticsMessage, /event: sites-changed/);
    assert.match(analyticsMessage, /data: \{\}/);
    assert.doesNotMatch(analyticsMessage, /site-opaque-2/);
    await analyticsReader.cancel();

    const noTabs = await fetch(`${origin}/api/supabase/site-events`, {
      headers: { Cookie: sessionCookie('no_tabs', 'sub_admin') },
    });
    assert.equal(noTabs.status, 403);
  } finally {
    await app.locals.disposeSiteEvents();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  assert.equal(unsubscribeCount, 1);
});
