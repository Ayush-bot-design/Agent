import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserViewHistory, getBrowserViewFromState } from './browser-view-history.ts';

class MemoryHistory {
  private entries: Array<{ state: unknown }> = [{ state: null }];
  private index = 0;

  get state() {
    return this.entries[this.index].state;
  }

  get length() {
    return this.entries.length;
  }

  replaceState(state: unknown) {
    this.entries[this.index] = { state };
  }

  pushState(state: unknown) {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ state });
    this.index += 1;
  }

  back() {
    this.index = Math.max(0, this.index - 1);
    return this.state;
  }
}

test('browser Back restores the previous in-app view and the new branch remains navigable', () => {
  const browserHistory = new MemoryHistory();
  const restored: string[] = [];
  const navigation = new BrowserViewHistory(browserHistory, (view) => restored.push(view));

  navigation.start('agent:sites');
  navigation.navigate('agent:completed');
  navigation.navigate('agent:profile');

  navigation.restore(browserHistory.back());
  assert.deepEqual(restored, ['agent:completed']);

  navigation.navigate('agent:sites');
  navigation.restore(browserHistory.back());
  assert.deepEqual(restored, ['agent:completed', 'agent:completed']);
  assert.equal(browserHistory.length, 3);
});

test('unrelated browser history state is ignored', () => {
  const browserHistory = new MemoryHistory();
  const restored: string[] = [];
  const navigation = new BrowserViewHistory(browserHistory, (view) => restored.push(view));

  navigation.start('admin:sites');
  navigation.restore({ someOtherLibrary: true });

  assert.equal(getBrowserViewFromState({ someOtherLibrary: true }), null);
  assert.deepEqual(restored, []);
});
