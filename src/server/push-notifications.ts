import * as webPush from 'web-push';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSubscriptionRecord extends PushSubscriptionInput {
  userKey: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  tag: string;
  url?: string;
}

const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'web.push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
];

export function validatePushSubscription(value: unknown): PushSubscriptionInput | null {
  if (!value || typeof value !== 'object') return null;
  const subscription = value as Partial<PushSubscriptionInput>;
  if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048) return null;

  try {
    const endpoint = new URL(subscription.endpoint);
    const allowedHost = ALLOWED_PUSH_HOSTS.some(
      (host) => endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`),
    );
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      !allowedHost
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const keys = subscription.keys;
  if (
    !keys ||
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string' ||
    !/^[A-Za-z0-9_-]{40,120}$/.test(keys.p256dh) ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(keys.auth)
  ) {
    return null;
  }

  return { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function getVapidConfig(env: NodeJS.ProcessEnv = process.env) {
  const publicKey = (env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (env.VAPID_SUBJECT || '').trim();
  const validKey = (value: string, expectedLength: number) =>
    value.length === expectedLength && /^[A-Za-z0-9_-]+$/.test(value);
  let validSubject = /^mailto:[^\s@]+@[^\s@]+$/.test(subject);
  if (subject.startsWith('https://')) {
    try {
      const subjectUrl = new URL(subject);
      validSubject = subjectUrl.protocol === 'https:' && Boolean(subjectUrl.hostname);
    } catch {
      validSubject = false;
    }
  }

  return validKey(publicKey, 87) && validKey(privateKey, 43) && validSubject
    ? { publicKey, privateKey, subject }
    : null;
}

export async function sendPushNotifications(
  subscriptions: PushSubscriptionRecord[],
  payload: PushNotificationPayload,
  removeStaleSubscription: (endpoint: string) => Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ sent: number; removed: number }> {
  const vapid = getVapidConfig(env);
  if (!vapid || subscriptions.length === 0) return { sent: 0, removed: 0 };

  webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const safePayload: PushNotificationPayload = {
    title: payload.title.slice(0, 80),
    body: payload.body.slice(0, 160),
    tag: payload.tag.slice(0, 100),
    url: payload.url?.startsWith('/') && !payload.url.startsWith('//') ? payload.url : '/',
  };

  let sent = 0;
  let removed = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        const valid = validatePushSubscription(subscription);
        if (!valid) {
          await removeStaleSubscription(subscription.endpoint);
          removed += 1;
          return;
        }
        await webPush.sendNotification(valid, JSON.stringify(safePayload), {
          TTL: 3600,
          urgency: 'normal',
        });
        sent += 1;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          try {
            await removeStaleSubscription(subscription.endpoint);
            removed += 1;
          } catch (removeError: any) {
            console.warn(
              'Unable to remove expired push subscription:',
              removeError?.message || 'unknown error',
            );
          }
        } else {
          console.warn(
            'Push delivery failed:',
            Number.isInteger(error?.statusCode) ? error.statusCode : 'network error',
          );
        }
      }
    }),
  );
  return { sent, removed };
}
