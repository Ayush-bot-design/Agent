import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { acquirePageScrollLock } from './page-scroll-lock';

for (const reverse of [false, true]) {
  test(`overlapping modal locks restore page scrolling after ${reverse ? 'reverse' : 'out-of-order'} cleanup`, () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const { document } = dom.window;
    const restored: number[][] = [];
    dom.window.scrollTo = (x?: number | ScrollToOptions, y?: number) => {
      restored.push(typeof x === 'number' ? [x, y ?? 0] : [x?.left ?? 0, x?.top ?? 0]);
    };
    Object.defineProperty(dom.window, 'scrollY', { value: 540 });
    document.body.style.position = 'relative';
    document.body.style.width = '90%';
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'scroll';
    try {
      const releaseFirst = acquirePageScrollLock(document);
      const releaseSecond = acquirePageScrollLock(document);
      assert.equal(document.body.style.position, 'fixed');
      assert.equal(document.body.style.top, '-540px');
      const releases = reverse ? [releaseSecond, releaseFirst] : [releaseFirst, releaseSecond];
      releases[0]();
      releases[0](); // StrictMode and repeated cleanup must not release another owner's lock.
      assert.equal(document.body.style.overflow, 'hidden');
      assert.equal(document.documentElement.style.overflow, 'hidden');
      assert.deepEqual(restored, []);
      releases[1]();
      assert.equal(document.body.style.position, 'relative');
      assert.equal(document.body.style.width, '90%');
      assert.equal(document.body.style.top, '');
      assert.equal(document.body.style.overflow, 'auto');
      assert.equal(document.documentElement.style.overflow, 'scroll');
      assert.deepEqual(restored, [[0, 540]]);
      releases[1]();
      assert.equal(restored.length, 1);
      const reopen = acquirePageScrollLock(document);
      reopen();
      assert.equal(document.body.style.overflow, 'auto');
    } finally {
      dom.window.close();
    }
  });
}

test('independent documents do not share lock ownership', () => {
  const first = new JSDOM('<!doctype html><body></body>');
  const second = new JSDOM('<!doctype html><body></body>');
  first.window.scrollTo = second.window.scrollTo = () => {};
  const a = acquirePageScrollLock(first.window.document);
  const b = acquirePageScrollLock(second.window.document);
  a();
  assert.equal(first.window.document.body.style.overflow, '');
  assert.equal(second.window.document.body.style.overflow, 'hidden');
  b();
  assert.equal(second.window.document.body.style.overflow, '');
  first.window.close();
  second.window.close();
});
