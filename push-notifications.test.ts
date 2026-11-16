import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getVapidConfig,
  validatePushSubscription,
  sendPushNotifications,
} from './push-notifications';

const validSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/example-token',
  keys: {
    p256dh: 'A'.repeat(87),
    auth: 'B'.repeat(22),
  },
};

const validVapid = {
  VAPID_PUBLIC_KEY: 'A'.repeat(87),
  VAPID_PRIVATE_KEY: 'B'.repeat(43),
  VAPID_SUBJECT: 'mailto:push@example.org',
};

describe('push notifications security and configuration', () => {
  it('accepts only well-formed HTTPS push-provider subscriptions', () => {
    assert.deepEqual(validatePushSubscription(validSubscription), validSubscription);
    assert.equal(
      validatePushSubscription({
        ...validSubscription,
        endpoint: 'http://fcm.googleapis.com/fcm/send/example-token',
      }),
      null,
    );
    assert.equal(
      validatePushSubscription({
        ...validSubscription,
        endpoint: 'https://attacker.example/fcm/send/example-token',
      }),
      null,
    );
    assert.equal(
      validatePushSubscription({
        ...validSubscription,
        endpoint: 'https://fcm.googleapis.com.attacker.example/fcm/send/example-token',
      }),
      null,
    );
    assert.equal(validatePushSubscription({ ...validSubscription, keys: {} }), null);
    assert.equal(validatePushSubscription(null), null);
  });

  it('requires all server-only VAPID settings and a valid subject', () => {
    assert.deepEqual(getVapidConfig(validVapid), {
      publicKey: validVapid.VAPID_PUBLIC_KEY,
      privateKey: validVapid.VAPID_PRIVATE_KEY,
      subject: validVapid.VAPID_SUBJECT,
    });
    assert.equal(getVapidConfig({ ...validVapid, VAPID_PRIVATE_KEY: '' }), null);
    assert.equal(getVapidConfig({ ...validVapid, VAPID_SUBJECT: 'javascript:alert(1)' }), null);
    assert.equal(getVapidConfig({}), null);
  });

  it('does not attempt delivery when server VAPID configuration is missing', async () => {
    let removed = false;
    const result = await sendPushNotifications(
      [{ userKey: 'affected-user', ...validSubscription }],
      { title: 'Update', body: 'Body', tag: 'test' },
      async () => {
        removed = true;
      },
      {},
    );
    assert.deepEqual(result, { sent: 0, removed: 0 });
    assert.equal(removed, false);
  });
});
