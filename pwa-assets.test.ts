import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const manifestUrl = new URL('../../public/manifest.webmanifest', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

test('PWA manifest is installable and declares the app shell and theme', () => {
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0f172a');
  assert.equal(manifest.background_color, '#f8fafc');

  const icons = new Map(
    manifest.icons.map((icon: { sizes: string; purpose: string; src: string }) => [
      icon.sizes + icon.purpose,
      icon,
    ]),
  );
  assert.ok(icons.has('192x192any'));
  assert.ok(icons.has('512x512any'));
  assert.ok(icons.has('512x512maskable'));

  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(`../../public${icon.src}`, import.meta.url)));
  }
});

test('PWA install icons are valid PNG files at the declared sizes', () => {
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL(`../../public${icon.src}`, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
});
