import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexAdminSites } from './admin-registry-index';
import {
  getUserInstallationSummary,
  getDistrictProgressBreakdown,
  getSiteComputerCount,
  filterSitesByDistrict,
  normalizeUserKey,
  type InstallationSite,
} from './deployment-logic';

const makeSite = (index: number): InstallationSite => ({
  id: `site-${index}`,
  clientName: `Office ${index}`,
  siteCode: `UP-${index}`,
  district: index % 2 ? 'Agra' : 'LUCKNOW',
  status: (['completed', 'in_progress', 'pending', 'available'] as const)[index % 4],
  completedByUser: index % 3 ? '@AGENT' : '',
  reservedByUser: index % 5 ? ' Other ' : '',
  assignedToUser: 'fallback',
  completedAt: '2026-11-01T10:00:00Z',
  hostnameVerifications: [],
  documents: [],
  milestones: [],
  computerCount: 1,
  facilityName: '',
  zone: '',
  address: '',
  contactPerson: '',
  contactPhone: '',
  softwarePackage: '',
  expectedHostnamePrefix: '',
  sampleValidHostname: '',
  slaWindow: '24h',
});

test('linear admin index matches full summary owner precedence and status semantics', () => {
  const sites = Array.from({ length: 567 }, (_, index) => makeSite(index));
  sites.push({
    ...makeSite(0),
    id: 'unowned',
    completedByUser: '',
    reservedByUser: '',
    assignedToUser: '',
  });
  const index = indexAdminSites(sites);
  for (const username of ['agent', 'other', 'fallback', 'nobody', '']) {
    const user = {
      id: username,
      username,
      email: '',
      role: 'agent' as const,
      createdAt: '',
      syncedToSupabase: true,
    };
    const expected = getUserInstallationSummary(user, sites);
    const actual = index.installationsByUser.get(normalizeUserKey(username));
    assert.equal(actual?.completedCount ?? 0, expected.completedCount, username);
    assert.equal(actual?.totalInstallationsCount ?? 0, expected.totalInstallationsCount, username);
  }
  assert.equal(
    index.districtCounts.get('agra'),
    sites.filter((s) => s.district.toLowerCase() === 'agra').length,
  );
  assert.equal(index.pendingCount, sites.filter((s) => s.status === 'pending').length);
  assert.equal(
    [...index.districtCounts.values()].reduce((a, b) => a + b, 0),
    sites.length,
  );
  assert.equal(indexAdminSites([]).installationsByUser.size, 0);
  const updated = sites.map((s) => (s.id === 'site-0' ? { ...s, status: 'pending' as const } : s));
  assert.equal(
    indexAdminSites(updated).pendingCount,
    index.pendingCount + 1,
    'immutable updates recalculate counts without mutating the previous index',
  );
});

test('registry counts use bounded work per site rather than full summaries in a sort comparator', () => {
  let reads = 0;
  const sites = Array.from(
    { length: 2000 },
    (_, index) =>
      new Proxy(makeSite(index), {
        get(target, key, receiver) {
          if (key === 'status') reads++;
          return Reflect.get(target, key, receiver);
        },
      }),
  );
  indexAdminSites(sites);
  assert(reads <= sites.length * 5, `expected linear status reads, received ${reads}`);
});

test('computer totals sum registered capacity across districts and every status, not pending subsets', () => {
  const sites: InstallationSite[] = (
    ['available', 'pending', 'in_progress', 'completed'] as const
  ).map((status, i) => ({
    ...makeSite(i),
    district: i < 2 ? ' Agra ' : 'AGRA',
    status,
    computerCount: (i + 1) * 10,
    availableSystems: 1,
    pendingSystems: 2,
  }));
  sites.push({ ...makeSite(4), district: 'Lucknow', computerCount: 7 });
  const index = indexAdminSites(sites);
  assert.equal(index.totalComputers, 107);
  assert.equal(index.districtComputerCounts.get('agra'), 100);
  assert.equal(index.districtComputerCounts.get('lucknow'), 7);
  assert.equal(
    [...index.districtComputerCounts.values()].reduce((a, b) => a + b, 0),
    index.totalComputers,
  );
  const changed = indexAdminSites(sites.map((s, i) => (i === 0 ? { ...s, computerCount: 50 } : s)));
  assert.equal(changed.totalComputers, 147);
  assert.equal(index.totalComputers, 107, 'previous index remains immutable');
  assert.equal(indexAdminSites([]).totalComputers, 0);
});

test('computer totals do not invent computers from invalid or missing legacy capacity', () => {
  const sites = [undefined, null, NaN, Infinity, -5, 0, 2.9, 1000].map((computerCount, i) => ({
    ...makeSite(i),
    computerCount: computerCount as number,
  }));
  const index = indexAdminSites(sites);
  assert.equal(index.totalComputers, 1002);
});

test('analytics district capacities reconcile with the registry across mixed-case district names', () => {
  const sites = [
    { ...makeSite(0), district: 'Agra', computerCount: 12 },
    { ...makeSite(1), district: ' AGRA ', computerCount: 5 },
    { ...makeSite(2), district: 'Lucknow', computerCount: 30 },
    { ...makeSite(3), district: 'Lucknow', computerCount: NaN },
  ];
  const breakdown = getDistrictProgressBreakdown(sites);
  assert.equal(breakdown.length, 2);
  assert.equal(breakdown.find((d) => d.district === 'Agra')?.totalComputers, 17);
  assert.equal(
    breakdown.reduce((total, d) => total + d.totalComputers, 0),
    indexAdminSites(sites).totalComputers,
  );
  assert.equal(
    sites
      .filter((s) => s.status === 'completed')
      .reduce((total, s) => total + getSiteComputerCount(s), 0),
    12,
  );
  assert.deepEqual(getDistrictProgressBreakdown([]), []);
});

test('filtered computer totals cover every matching site and respond to search, district and status', () => {
  const sites = Array.from({ length: 120 }, (_, i) => ({ ...makeSite(i), computerCount: 3 }));
  const sum = (items: InstallationSite[]) =>
    items.reduce((total, site) => total + getSiteComputerCount(site), 0);
  assert.equal(sum(filterSitesByDistrict(sites, 'all')), 360);
  assert.equal(sum(filterSitesByDistrict(sites, 'Agra')), 180);
  const completed = filterSitesByDistrict(sites, 'Lucknow').filter((s) => s.status === 'completed');
  assert.equal(sum(completed), 90);
  assert.equal(sum(filterSitesByDistrict(sites, 'Lucknow', 'UP-100')), 3);
  assert.equal(sum(filterSitesByDistrict(sites, 'Agra', 'no-match')), 0);
  assert.equal(
    indexAdminSites(sites).totalComputers,
    360,
    'filters do not alter the global capacity',
  );
});
