import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { MODEL_BASE_URL } from '../utils/model-assets';

test('service worker caches only versioned public code/models, refreshes offline shell, and preserves one previous release without forced reload', async () => {
  const source = (
    await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')
  ).replaceAll('__TTT_RELEASE__', 'test-release');
  const listeners = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, Response>>();
  let denied = false;
  let network = 0;
  let offline = false;
  const key = (request: any) =>
    new URL(typeof request === 'string' ? request : request.url, 'https://app.test').href;
  const basic = (body: string, type = 'application/javascript') => {
    const response = new Response(body, { headers: { 'content-type': type } });
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  };
  const cache = (name: string) => {
    if (denied) throw Error('Storage unavailable');
    if (!stores.has(name)) stores.set(name, new Map());
    const values = stores.get(name)!;
    return {
      match: async (request: any) => values.get(key(request))?.clone(),
      put: async (request: any, response: Response) => {
        values.set(key(request), response.clone());
      },
      keys: async () => [...values.keys()],
      delete: async (request: any) => values.delete(key(request)),
      addAll: async (requests: string[]) => {
        for (const request of requests)
          values.set(key(request), basic('installed shell', 'text/html'));
      },
    };
  };
  const caches = {
    open: async (name: string) => cache(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: any) => {
      for (const values of stores.values()) {
        const response = values.get(key(request));
        if (response) return response.clone();
      }
    },
  };
  vm.runInNewContext(source, {
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type: string, callback: any) => listeners.set(type, callback),
      clients: { claim: async () => {} },
    },
    caches,
    URL,
    Response,
    fetch: async (input: any) => {
      network++;
      if (offline) throw Error('offline');
      return basic(
        'network-v' + network,
        input.mode === 'navigate' ? 'text/html' : 'application/javascript',
      );
    },
  });
  assert(source.includes(MODEL_BASE_URL + '/'));
  const dispatch = async (path: string, destination = '', mode = 'cors') => {
    let response: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.get('fetch')!({
      request: { url: 'https://app.test' + path, method: 'GET', mode, destination },
      respondWith: (promise: Promise<Response>) => (response = promise),
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    const result = response ? await response : undefined;
    await Promise.all(waits);
    return result;
  };
  for (const path of ['/api/supabase/sites', '/auth/callback', '/storage/v1/private', '/d/SECRET'])
    assert.equal(await dispatch(path, '', 'navigate'), undefined);
  assert.equal(await dispatch('/assets/aistudio/private.pdf', 'document'), undefined);
  const first = await dispatch('/assets/app-hash.js', 'script');
  assert(first);
  await dispatch('/assets/app-hash.js', 'script');
  assert.equal(network, 1);
  await dispatch(MODEL_BASE_URL + '/face_recognition_model.bin');
  await dispatch(MODEL_BASE_URL + '/face_recognition_model.bin');
  assert.equal(network, 2);
  assert.equal(await dispatch('/models/unversioned/private.bin'), undefined);
  denied = true;
  assert(await dispatch('/assets/new-hash.js', 'script'));
  assert.equal(network, 3, 'storage failure still returns network data');
  denied = false;
  // Public navigation writes only sanitized index.html, never an auth/recovery query URL.
  const shell = await dispatch('/', 'document', 'navigate');
  const html = await shell!.text();
  await dispatch('/?access_token=secret', 'document', 'navigate');
  assert(
    ![...stores.values()].some((values) =>
      [...values.keys()].some((key) => key.includes('access_token')),
    ),
  );
  offline = true;
  assert.equal(await (await dispatch('/', 'document', 'navigate'))!.text(), html);
  offline = false;
  await caches.open('ttt-app-shell-oldest');
  await caches.open('ttt-app-shell-previous');
  await caches.open('ttt-models-old');
  let activated!: Promise<unknown>;
  listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => (activated = promise) });
  await activated;
  assert(!stores.has('ttt-app-shell-oldest'));
  assert(stores.has('ttt-app-shell-previous'));
  assert(!stores.has('ttt-models-old'));
  assert(!source.includes('skipWaiting()'), 'updates must not force-reload an unsaved workspace');
});
