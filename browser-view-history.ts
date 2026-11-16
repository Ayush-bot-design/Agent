const BROWSER_VIEW_STATE_KEY = '__tttBrowserView';

type BrowserViewHistoryState = {
  [BROWSER_VIEW_STATE_KEY]?: string;
};

type BrowserHistoryPort = Pick<History, 'state' | 'pushState' | 'replaceState'>;

function stateWithView(state: unknown, view: string): BrowserViewHistoryState {
  const existing = state && typeof state === 'object' ? state : {};
  return { ...existing, [BROWSER_VIEW_STATE_KEY]: view };
}

export function getBrowserViewFromState(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const view = (state as BrowserViewHistoryState)[BROWSER_VIEW_STATE_KEY];
  return typeof view === 'string' ? view : null;
}

/**
 * Keeps major in-app views in browser history so browser/device Back navigates
 * within the SPA instead of immediately leaving or closing its only page.
 */
export class BrowserViewHistory {
  private currentView: string | null = null;

  constructor(
    private readonly history: BrowserHistoryPort,
    private readonly onRestoreView: (view: string) => void,
  ) {}

  start(view: string) {
    const state = stateWithView(this.history.state, view);
    this.history.replaceState(state, '');
    this.currentView = view;
  }

  navigate(view: string) {
    if (view === this.currentView) return;
    const state = stateWithView(this.history.state, view);
    this.history.pushState(state, '');
    this.currentView = view;
  }

  restore(state: unknown) {
    const view = getBrowserViewFromState(state);
    if (!view) return;
    this.currentView = view;
    this.onRestoreView(view);
  }
}
