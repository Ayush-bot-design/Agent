import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGoogleMapsShortLink } from './secure-url.ts';

test('accepts only HTTPS Google Maps short links', () => {
  assert.equal(parseGoogleMapsShortLink('maps.app.goo.gl/AbCd')?.hostname, 'maps.app.goo.gl');
  assert.equal(parseGoogleMapsShortLink('https://goo.gl/maps/AbCd')?.hostname, 'goo.gl');
  assert.equal(parseGoogleMapsShortLink('https://evil.example/maps.app.goo.gl/AbCd'), null);
  assert.equal(parseGoogleMapsShortLink('http://maps.app.goo.gl/AbCd'), null);
  assert.equal(parseGoogleMapsShortLink('https://maps.app.goo.gl.evil.example/AbCd'), null);
  assert.equal(parseGoogleMapsShortLink('https://user:secret@maps.app.goo.gl/AbCd'), null);
  assert.equal(parseGoogleMapsShortLink('https://maps.app.goo.gl:8443/AbCd'), null);
  assert.equal(parseGoogleMapsShortLink('https://maps.app.goo.gl/'), null);
  assert.equal(parseGoogleMapsShortLink(`https://maps.app.goo.gl/${'a'.repeat(2048)}`), null);
  assert.equal(parseGoogleMapsShortLink(null), null);
});
