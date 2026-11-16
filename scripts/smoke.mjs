/**
 * Runs the console inside jsdom so we catch runtime regressions without a browser.
 * Usage: npm run smoke
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(rootDir, 'scripts/.smoke-bundle.mjs');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});

const win = dom.window;
globalThis.window = win;
globalThis.document = win.document;
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
globalThis.HTMLElement = win.HTMLElement;
globalThis.HTMLInputElement = win.HTMLInputElement;
globalThis.HTMLSelectElement = win.HTMLSelectElement;
globalThis.HTMLTextAreaElement = win.HTMLTextAreaElement;
globalThis.Element = win.Element;
globalThis.Node = win.Node;
globalThis.Event = win.Event;
globalThis.MouseEvent = win.MouseEvent;
globalThis.localStorage = win.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
win.matchMedia = () => ({
  matches: false,
  media: '',
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

await build({
  entryPoints: [path.join(rootDir, 'scripts/smoke-entry.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'node20',
  outfile,
  jsx: 'automatic',
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"development"' },
});

let failures = 0;
try {
  const { runSmoke } = await import(`${outfile}?t=${Date.now()}`);
  const results = await runSmoke();
  for (const { step, ok } of results) {
    console.log(`${ok ? '✓' : '✗'} ${step}`);
    if (!ok) failures += 1;
  }
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  await rm(outfile, { force: true });
}

win.close();
if (failures > 0) {
  console.error(`\nSmoke test failed (${failures} problem${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('\nSmoke test passed.');
// jsdom keeps timers alive; exit explicitly once the assertions are done.
process.exit(0);
