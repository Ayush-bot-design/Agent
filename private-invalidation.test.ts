import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { attachPrivateInvalidations, allowedInvalidations } from './private-invalidation';

test('private stream authenticates, filters coarse signals, rejects revoked access and observes writes from another client', async () => {
  const app = express();
  let revoked = false;
  let permissionsChanged = false;
  const auth = (key: string) => ({
    userId: key,
    userKey: key,
    role: 'sub_admin',
    allowedTabs: key === 'sites-reader' ? ['sites'] : ['activity_log'],
  });
  const bus = attachPrivateInvalidations(app, async (req) => {
    const key = req.headers.authorization;
    return key && !revoked
      ? { ...auth(key), allowedTabs: permissionsChanged ? ['users'] : auth(key).allowedTabs }
      : null;
  });
  app.post('/api/supabase/profile/sensitive-person', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const controller = new AbortController();
  try {
    assert.equal((await fetch(origin + '/api/supabase/cache-events')).status, 401);
    const response = await fetch(origin + '/api/supabase/cache-events', {
      headers: { authorization: 'sites-reader' },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader();
    await reader.read();
    await fetch(origin + '/api/supabase/profile/sensitive-person', { method: 'POST' });
    const change = new TextDecoder().decode((await reader.read()).value);
    assert.match(change, /event: invalidate/);
    assert.match(change, /sites/);
    assert.doesNotMatch(change, /sensitive-person|profiles|activity|templates/);
    permissionsChanged = true;
    bus.notify(['sites']);
    const changedFrame = new TextDecoder().decode((await reader.read()).value);
    assert.match(changedFrame, /access-changed/);
    assert.equal((await reader.read()).done, true);
    permissionsChanged = false;
    const second = await fetch(origin + '/api/supabase/cache-events', {
      headers: { authorization: 'sites-reader' },
      signal: controller.signal,
    });
    const secondReader = second.body!.getReader();
    await secondReader.read();
    revoked = true;
    bus.notify(['sites']);
    const revokedFrame = new TextDecoder().decode((await secondReader.read()).value);
    assert.match(revokedFrame, /access-changed/);
    assert.equal((await secondReader.read()).done, true);
    assert.deepEqual(allowedInvalidations(auth('log-reader')), [
      'permissions',
      'notifications',
      'documents',
      'activity',
    ]);
  } finally {
    controller.abort();
    bus.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('idle private stream service never emits timed invalidations or reauthorizes on heartbeat', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let queries = 0;
  let notifications = 0;
  const bus = attachPrivateInvalidations(
    express(),
    async () => {
      queries++;
      return null;
    },
    () => {
      notifications++;
    },
  );
  try {
    t.mock.timers.tick(60 * 60 * 1000);
    await Promise.resolve();
    assert.equal(queries, 0);
    assert.equal(notifications, 0);
  } finally {
    bus.dispose();
  }
});
