import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateCache } from '../lib/private-cache';
import {
  getEnrolledFaceTemplate,
  getEnrolledFaceTemplates,
  loadAllTemplatesFromServer,
  syncUserTemplateFromServer,
} from './face-recognition-engine';
const template = (personId: string) => ({
  personId,
  personName: personId,
  embedding: Array(128).fill(0.1),
  modelName: 'vladmandic-face-api-resnet34-128d-v5',
  enrolledAt: '2026-11-13T00:00:00Z',
});

test('templates always refresh, bulk omissions evict, errors fail closed and old sessions cannot repopulate mirrors', async () => {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'http://localhost' } },
  });
  privateCache.setScope('face-user-a');
  try {
    let rows = [template('a'), template('b')];
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ templates: rows, template: rows[0] || null }));
    };
    await loadAllTemplatesFromServer();
    assert.equal(getEnrolledFaceTemplates().length, 2);
    rows = [template('b')];
    await loadAllTemplatesFromServer();
    assert.equal(getEnrolledFaceTemplate('a'), null);
    await syncUserTemplateFromServer('b');
    await syncUserTemplateFromServer('b');
    assert.equal(calls, 4, 'sync does not shortcut a memory entry');
    rows = [];
    await syncUserTemplateFromServer('b');
    assert.equal(getEnrolledFaceTemplate('b'), null);
    rows = [template('b')];
    await loadAllTemplatesFromServer();
    globalThis.fetch = async () => {
      throw Error('offline');
    };
    assert.equal(await syncUserTemplateFromServer('b'), null);
    assert.equal(getEnrolledFaceTemplate('b'), null);
    let release!: (response: Response) => void;
    globalThis.fetch = () => new Promise((resolve) => (release = resolve));
    const pending = loadAllTemplatesFromServer();
    await Promise.resolve();
    privateCache.setScope('face-user-b');
    release(new Response(JSON.stringify({ templates: [template('private-a')] })));
    assert.deepEqual(await pending, []);
    assert.deepEqual(getEnrolledFaceTemplates(), []);
    globalThis.fetch = async () => new Response(JSON.stringify({ templates: [template('b')] }));
    await loadAllTemplatesFromServer();
    privateCache.setScope('');
    assert.deepEqual(getEnrolledFaceTemplates(), []);
  } finally {
    privateCache.setScope('');
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as any).window;
  }
});
