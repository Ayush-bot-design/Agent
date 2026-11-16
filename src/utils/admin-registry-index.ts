import { getSiteComputerCount, normalizeUserKey, type InstallationSite } from './deployment-logic';

/** Lightweight roster counts, not profile/evidence summaries. Match the full
 * summary's owner precedence exactly; only completed/in-progress sites count. */
export function indexAdminSites(sites: readonly InstallationSite[]) {
  const installationsByUser = new Map<
    string,
    { completedCount: number; totalInstallationsCount: number }
  >();
  const districtCounts = new Map<string, number>();
  const districtComputerCounts = new Map<string, number>();
  let totalComputers = 0;
  let pendingCount = 0;
  for (const site of sites) {
    const district = site.district.trim().toLowerCase();
    const computers = getSiteComputerCount(site);
    totalComputers += computers;
    districtComputerCounts.set(district, (districtComputerCounts.get(district) || 0) + computers);
    districtCounts.set(district, (districtCounts.get(district) || 0) + 1);
    if (site.status === 'pending') pendingCount++;
    if (site.status !== 'completed' && site.status !== 'in_progress') continue;
    const owner = normalizeUserKey(
      site.status === 'completed'
        ? site.completedByUser || site.reservedByUser || site.assignedToUser || ''
        : site.reservedByUser || site.assignedToUser || '',
    );
    const counts = installationsByUser.get(owner) || {
      completedCount: 0,
      totalInstallationsCount: 0,
    };
    counts.totalInstallationsCount++;
    if (site.status === 'completed') counts.completedCount++;
    installationsByUser.set(owner, counts);
  }
  return {
    installationsByUser,
    districtCounts,
    districtComputerCounts,
    totalComputers,
    pendingCount,
  };
}
