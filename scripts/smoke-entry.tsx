/**
 * Browser-side smoke test for the console.
 *
 * The repository shipped without a UI, so this exercises the real rendered
 * application: sign in → open a site → reserve it → record a workstation.
 * Run with `npm run smoke`.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { WorkspaceProvider } from '../src/lib/workspace-store';

const results: Array<{ step: string; ok: boolean; detail?: string }> = [];

function check(step: string, ok: boolean, detail?: string) {
  results.push({ step, ok, detail });
  if (!ok) throw new Error(`FAILED: ${step}${detail ? ` — ${detail}` : ''}`);
}

function byText(container: HTMLElement, text: string, selector = 'button') {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return nodes.find((node) => (node.textContent || '').trim().includes(text)) || null;
}

function setNativeValue(element: HTMLElement, value: string) {
  const win = element.ownerDocument.defaultView as unknown as {
    HTMLInputElement: typeof HTMLInputElement;
    HTMLSelectElement: typeof HTMLSelectElement;
    HTMLTextAreaElement: typeof HTMLTextAreaElement;
  };
  const proto =
    element instanceof win.HTMLSelectElement
      ? win.HTMLSelectElement.prototype
      : element instanceof win.HTMLTextAreaElement
        ? win.HTMLTextAreaElement.prototype
        : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new win.Event('input', { bubbles: true }));
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
}

async function click(element: HTMLElement | null, label: string) {
  check(`${label} is rendered`, Boolean(element));
  await act(async () => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export async function runSmoke(): Promise<Array<{ step: string; ok: boolean }>> {
  const container = document.getElementById('root');
  if (!container) throw new Error('No #root container');
  const root = createRoot(container);
  const win = document.defaultView as unknown as Window;

  await act(async () => {
    root.render(
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>,
    );
  });

  check('sign-in screen renders', (container.textContent || '').includes('Sign in to your workspace'));

  const form = container.querySelector('form');
  check('sign-in form exists', Boolean(form));
  await act(async () => {
    form!.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  });

  check(
    'dashboard renders after sign in',
    Boolean(container.querySelector('input[aria-label="Search sites"]')) &&
      (container.textContent || '').includes('District worklist'),
  );
  check('seeded sites are listed', container.querySelectorAll('li').length > 10);

  await click(byText(container, 'Review'), 'site review button');
  check('review dialog opens', (container.textContent || '').includes('Verify identity & reserve'));

  await click(byText(container, 'Verify identity & reserve'), 'reserve button');
  check(
    'workspace opens after reservation',
    (container.textContent || '').includes('Installation milestones'),
    (container.textContent || '').slice(0, 300),
  );

  await click(byText(container, 'Record device'), 'record device button');
  check('device form opens', (container.textContent || '').includes('Live workstation photo'));

  const ram = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
  check('RAM field rendered', Boolean(ram));
  await act(async () => setNativeValue(ram!, '8'));

  const windows = container.querySelector<HTMLInputElement>('input[placeholder="Windows 11 Pro"]');
  check('Windows version field rendered', Boolean(windows));
  await act(async () => setNativeValue(windows!, 'Windows 11 Pro'));

  const architecture = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).find((select) =>
    (select.textContent || '').includes('64-bit'),
  );
  check('architecture select rendered', Boolean(architecture));
  await act(async () => setNativeValue(architecture!, 'x64'));

  const hostname = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find((input) =>
    (input.placeholder || '').includes('.UP.GOV.LOCAL'),
  );
  check('hostname field rendered', Boolean(hostname));
  const sitePrefix = (hostname!.placeholder || 'UP-LKO-0000').split('-PC')[0];
  await act(async () => setNativeValue(hostname!, `${sitePrefix}-PC01.UP.GOV.LOCAL`));

  await click(byText(container, 'Capture'), 'capture photo button');
  await click(byText(container, 'Save device record'), 'save device button');

  check(
    'device record saved',
    !(container.textContent || '').includes('Save device record') &&
      (container.textContent || '').includes('Verified'),
  );

  // ---- finish the remaining milestones, attach paperwork and close the job ----
  const toggleLabels = Array.from(container.querySelectorAll('button[aria-label^="Toggle"]')).map(
    (node) => node.getAttribute('aria-label') || '',
  );
  check('all milestones render', toggleLabels.length === 5, toggleLabels.join(' | '));

  for (const index of [0, 1]) {
    const toggles = Array.from(container.querySelectorAll<HTMLElement>('button[aria-label^="Toggle"]'));
    await click(toggles[index], `milestone toggle ${index + 1}`);
  }

  const anyDeviceLeft = byText(container, 'Record device');
  if (anyDeviceLeft) {
    check('every device needs a record before completion', true);
  }

  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
  check('document input rendered', Boolean(fileInput));
  const file = new File([new Uint8Array([37, 80, 68, 70])], 'signoff-certificate.pdf', {
    type: 'application/pdf',
  });
  Object.defineProperty(fileInput!, 'files', { value: [file], configurable: true });
  await act(async () => {
    fileInput!.dispatchEvent(new win.Event('change', { bubbles: true }));
    // the upload handler hashes the file asynchronously
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  check(
    'paperwork attaches to the site',
    (container.textContent || '').includes('signoff-certificate.pdf'),
    (container.textContent || '').slice(0, 300),
  );

  await click(byText(container, 'Complete', 'button'), 'complete button');
  check('completion dialog opens', (container.textContent || '').includes('Complete & seal installation'));
  await click(byText(container, 'Run biometric seal & complete'), 'seal button');
  check(
    'site completes and returns to the worklist',
    Boolean(container.querySelector('input[aria-label="Search sites"]')),
    (container.textContent || '').slice(0, 300),
  );

  await click(byText(container, 'Reports', 'button'), 'reports tab');
  check(
    'reports tab renders district progress',
    (container.textContent || '').includes('District progress'),
  );

  await act(async () => {
    root.unmount();
  });
  return results.map(({ step, ok }) => ({ step, ok }));
}
