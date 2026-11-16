import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requestPerformance, measuredDatabaseFetch } from './request-performance';

test('API timing measures DB body transfer, response bytes and bounded reads without timing out writes', async () => {
  const app = express();
  app.use(requestPerformance);
  const database = measuredDatabaseFetch(
    (async (_url, options) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(null, { status: 204 })), 25);
        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch,
    { hopMs: 10, readMs: 20 },
  );
  const handler = async (_req: any, res: any) => {
    try {
      await database('https://database.invalid');
      res.json({ saved: true });
    } catch {
      res.status(503).json({ error: 'Timed out' });
    }
  };
  app.get('/api/read', handler);
  app.post('/api/write', handler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No listener');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/read`);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('server-timing')!, /app;dur=.+db;dur=.+db_calls;desc="1"/);
    const body = await response.text();
    assert.equal(Number(response.headers.get('x-response-bytes')), Buffer.byteLength(body));
    const write = await fetch(`http://127.0.0.1:${address.port}/api/write`, { method: 'POST' });
    assert.equal(write.status, 200);
    assert.deepEqual(await write.json(), { saved: true });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});
