import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml } from './html-escape.ts';

test('escapeHtml encodes markup-sensitive characters', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror='alert(1)'>&`),
    '&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;',
  );
  assert.equal(escapeHtml(null), '');
});
