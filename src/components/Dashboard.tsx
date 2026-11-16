import { useMemo, useState } from 'react';
import {
  calculateDeploymentProgress,
  filterSitesByDistrict,
  getDistrictProgressBreakdown,
  getReservationRemainingLabel,
  normalizeUserKey,
  sortInstallationSites,
  type InstallationSite,
  type InstallationSiteSortOrder,
  type SiteStatus,
} from '../utils/deployment-logic';
import { getSiteReviewAction } from '../utils/site-selection';
import { useWorkspace } from '../lib/workspace-store';
import { Badge, Button, Card, ProgressBar, SelectInput, StatTile, StatusBadge, TextInput, cx, EmptyState } from './ui';
import { Icon } from './icons';

type StatusFilter = 'all' | SiteStatus;

export function Dashboard({
  onOpenSite,
  onOpenWorkspace,
}: {
  onOpenSite: (site: InstallationSite) => void;
  onOpenWorkspace: () => void;
}) {
  const { sites, profile, activeSite, nowMs } = useWorkspace();
  const [district, setDistrict] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<InstallationSiteSortOrder>('district');

  const districtsInWorklist = useMemo(
    () => [...new Set(sites.map((site) => site.district))].sort((a, b) => a.localeCompare(b)),
    [sites],
  );

  const counts = useMemo(() => {
    const base: Record<SiteStatus, number> = { available: 0, in_progress: 0, pending: 0, completed: 0 };
    sites.forEach((site) => {
      base[site.status] += 1;
    });
    return base;
  }, [sites]);

  const districtProgress = useMemo(() => getDistrictProgressBreakdown(sites), [sites]);
  const lagging = districtProgress.filter((item) => item.isLagging).length;

  const myCompleted = useMemo(
    () =>
      profile
        ? sites.filter(
            (site) =>
              site.status === 'completed' &&
              normalizeUserKey(site.completedByUser || '') === normalizeUserKey(profile.userKey),
          ).length
        : 0,
    [profile, sites],
  );

  const visibleSites = useMemo(() => {
    const scoped = filterSitesByDistrict(sites, district, query);
    const byStatus = status === 'all' ? scoped : scoped.filter((site) => site.status === status);
    return sortInstallationSites(byStatus, sortOrder);
  }, [district, query, sites, sortOrder, status]);

  const devicesDone = sites.reduce((sum, site) => sum + (site.hostnameVerifications?.filter((v) => v?.verified).length || 0), 0);
  const devicesTotal = sites.reduce((sum, site) => sum + site.computerCount, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Available" value={counts.available} hint="Ready to reserve" tone="emerald" />
        <StatTile label="Reserved" value={counts.in_progress} hint="Agents on site" tone="indigo" />
        <StatTile label="Completed" value={counts.completed} hint={`${devicesDone}/${devicesTotal} devices`} />
        <StatTile
          label="Districts"
          value={districtsInWorklist.length}
          hint={lagging ? `${lagging} lagging` : 'All on track'}
          tone="amber"
        />
      </div>

      {activeSite ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 bg-gradient-to-r from-indigo-600 via-indigo-600 to-sky-600 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-indigo-100 uppercase">
                Your active installation
              </p>
              <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight">{activeSite.clientName}</h2>
              <p className="text-sm text-indigo-100">
                {activeSite.siteCode} · {activeSite.district} ·{' '}
                {getReservationRemainingLabel(activeSite, nowMs)}
              </p>
            </div>
            <Button variant="secondary" onClick={onOpenWorkspace} className="shrink-0">
              Open workspace
              <Icon name="arrowRight" />
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">District worklist</h2>
            <p className="text-sm text-slate-500">
              {visibleSites.length} of {sites.length} sites · one active reservation per agent
              {myCompleted ? ` · ${myCompleted} completed by you` : ''}
            </p>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:grid-cols-[minmax(0,15rem)_9rem_9rem_9rem]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Icon name="search" className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search site, code, contact…"
                className="pl-9"
                aria-label="Search sites"
              />
            </div>
            <SelectInput
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
              aria-label="Filter by district"
            >
              <option value="all">All districts</option>
              {districtsInWorklist.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              aria-label="Filter by status"
            >
              <option value="all">Any status</option>
              <option value="available">Available</option>
              <option value="in_progress">Reserved</option>
              <option value="pending">Pending issue</option>
              <option value="completed">Completed</option>
            </SelectInput>
            <SelectInput
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as InstallationSiteSortOrder)}
              aria-label="Sort sites"
            >
              <option value="district">Sort: district</option>
              <option value="name">Sort: site name</option>
              <option value="pending">Sort: pending systems</option>
            </SelectInput>
          </div>
        </div>

        <div className="mt-4">
          {visibleSites.length === 0 ? (
            <EmptyState
              title="No sites match these filters"
              description="Clear the search or choose another district. New sites appear here as soon as the department import is loaded."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setDistrict('all');
                    setStatus('all');
                  }}
                >
                  Reset filters
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleSites.map((site) => (
                <SiteCard
                  key={site.id}
                  site={site}
                  userKey={profile?.userKey || ''}
                  activeSiteId={activeSite?.id ?? null}
                  onOpen={() => onOpenSite(site)}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function SiteCard({
  site,
  userKey,
  activeSiteId,
  onOpen,
}: {
  site: InstallationSite;
  userKey: string;
  activeSiteId: string | null;
  onOpen: () => void;
}) {
  const progress = calculateDeploymentProgress(site);
  const action = getSiteReviewAction(site, userKey, activeSiteId === site.id ? site : null);
  const verifiedDevices = site.hostnameVerifications?.filter((entry) => entry?.verified).length || 0;

  return (
    <Card as="li" className="flex h-full flex-col p-4 transition hover:ring-slate-900/15">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-wide text-slate-500">{site.siteCode}</p>
          <h3 className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-slate-900">
            {site.clientName}
          </h3>
        </div>
        <StatusBadge status={site.status} />
      </div>

      <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
        <Icon name="pin" className="h-3.5 w-3.5" />
        {site.district}
        <span className="text-slate-300">·</span>
        {site.officeType}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="slate">
          <Icon name="devices" className="h-3 w-3" />
          {verifiedDevices}/{site.computerCount} devices
        </Badge>
        {site.status === 'in_progress' && site.reservedByUser ? (
          <Badge tone="indigo">@ {site.reservedByUser}</Badge>
        ) : null}
        {site.status === 'completed' && site.completedByUser ? (
          <Badge tone="slate">@ {site.completedByUser}</Badge>
        ) : null}
        {site.status === 'pending' && site.pendingIssue ? (
          <Badge tone="amber">Resume by @{site.pendingIssue.agentUserKey} only</Badge>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
          <span>Milestones</span>
          <span className="tabular-nums">
            {progress.completedCount}/{progress.totalCount} · {progress.percentage}%
          </span>
        </div>
        <ProgressBar value={progress.percentage} tone={site.status === 'completed' ? 'emerald' : 'indigo'} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span
          className={cx(
            'truncate text-[11px] font-medium',
            action.kind === 'unavailable' ? 'text-slate-400' : 'text-slate-500',
          )}
          title={action.description}
        >
          {action.kind === 'reserve' ? '24h window after reservation' : action.label}
        </span>
        <Button
          size="sm"
          variant={action.kind === 'reserve' ? 'primary' : 'secondary'}
          onClick={onOpen}
          className="shrink-0"
        >
          Review
          <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  );
}
