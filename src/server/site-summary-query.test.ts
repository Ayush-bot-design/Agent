import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSiteSummaryQuery, siteSummaryCursor } from './site-summary-query';

test('summary queries validate filters and bind cursors to user, dates, sort and page size', () => {
  const q = parseSiteSummaryQuery(
    { scope: 'completed', startDate: '2026-11-13', pageSize: 2 },
    'agent',
  );
  const keys = ['same', 'same', 'id-last'];
  const cursor = siteSummaryCursor(keys, q.fingerprint);
  assert.deepEqual(
    parseSiteSummaryQuery(
      { scope: 'completed', startDate: '2026-11-13', pageSize: 2, cursor },
      'agent',
    ).after,
    keys,
  );
  for (const input of [
    { pageSize: 0 },
    { pageSize: 51 },
    { pageSize: 1.5 },
    { status: 'reserved' },
    { sort: 'bad' },
    { startDate: '2026-02-30' },
    { startDate: '2026-11-14', endDate: '2026-11-13' },
    { search: 'x'.repeat(101) },
    { district: 'x'.repeat(81) },
    { cursor: 'not-json' },
  ])
    assert.throws(() => parseSiteSummaryQuery(input as any, 'agent'));
  assert.throws(() => parseSiteSummaryQuery({ ...q, cursor }, 'other'));
  assert.throws(() => parseSiteSummaryQuery({ ...q, cursor, sort: 'pending' }, 'agent'));
  assert.throws(() => parseSiteSummaryQuery({ ...q, cursor, pageSize: 10 }, 'agent'));
});
