import { useMemo, useState } from 'react';
import {
  generateSitesCsvReport,
  getDistrictProgressBreakdown,
  paginateActivityLogs,
  type ActivityLogEntry,
} from '../utils/deployment-logic';
import { useWorkspace } from '../lib/workspace-store';
import { useFlash } from '../lib/flash';
import { downloadTextFile, istDateStamp } from '../lib/download';
import { Badge, Button, Card, EmptyState, ProgressBar, SelectInput, StatTile, cx } from './ui';
import { Icon } from './icons';

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function Reports() {
  const { sites, activity } = useWorkspace();
  const { flash } = useFlash();
  const [eventFilter, setEventFilter] = useState<'all' | 'login' | 'status_change' | 'attendance'>('all');
  const [page, setPage] = useState(1);

  const breakdown = useMemo(() => getDistrictProgressBreakdown(sites), [sites]);
  const logs = useMemo(() => paginateActivityLogs(activity, { page, pageSize: 6, eventFilter }), [activity, eventFilter, page]);

  const totals = useMemo(() => {
    const totalComputers = sites.reduce((sum, site) => sum + site.computerCount, 0);
    const verified = sites.reduce(
      (sum, site) => sum + (site.hostnameVerifications?.filter((entry) => entry?.verified).length || 0),
      0,
    );
    const completed = sites.filter((site) => site.status === 'completed').length;
    return {
      totalComputers,
      verified,
      completed,
      completionRate: sites.length ? Math.round((completed / sites.length) * 100) : 0,
    };
  }, [sites]);

  const exportAll = () => {
    downloadTextFile(`up-tender-sites-${istDateStamp()}.csv`, generateSitesCsvReport(sites));
    flash('Full worklist exported as CSV.', 'success');
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Sites" value={sites.length} hint={`${breakdown.length} districts`} />
        <StatTile label="Completed" value={totals.completed} hint={`${totals.completionRate}% of worklist`} tone="emerald" />
        <StatTile label="Devices" value={totals.totalComputers} hint={`${totals.verified} verified`} tone="indigo" />
        <StatTile
          label="Lagging"
          value={breakdown.filter((item) => item.isLagging).length}
          hint="Districts below target"
          tone="amber"
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900">District progress</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Lagging districts are listed first so bottlenecks are obvious.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={exportAll}>
            <Icon name="download" />
            Export worklist CSV
          </Button>
        </div>

        <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {breakdown.map((item) => (
            <li
              key={item.district}
              className={cx(
                'rounded-xl p-3 ring-1 ring-inset',
                item.isLagging ? 'bg-amber-50/60 ring-amber-600/20' : 'bg-white ring-slate-900/[0.06]',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">{item.district}</p>
                <Badge tone={item.isLagging ? 'amber' : 'emerald'}>{item.completionPercent}%</Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {item.totalSites} sites · {item.totalComputers} devices · {item.completedSites} completed
              </p>
              <ProgressBar
                value={item.completionPercent}
                tone={item.isLagging ? 'slate' : 'emerald'}
                className="mt-2"
              />
              <p className="mt-1 text-[11px] text-slate-500">{item.statusSummaryLabel}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900">Activity log</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Sign-ins, reservations and completion seals recorded on this device.
            </p>
          </div>
          <SelectInput
            value={eventFilter}
            onChange={(event) => {
              setEventFilter(event.target.value as typeof eventFilter);
              setPage(1);
            }}
            aria-label="Filter activity"
            className="w-44"
          >
            <option value="all">All events</option>
            <option value="login">Sign-ins</option>
            <option value="status_change">Site status</option>
            <option value="attendance">Attendance</option>
          </SelectInput>
        </div>

        {logs.items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing logged yet"
              description="Reserve a site or sign in again to generate activity entries."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {logs.items.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>
            Page {logs.currentPage} of {logs.totalPages} · {logs.totalItems} entries
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!logs.hasPrevPage}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!logs.hasNextPage}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  const tone =
    entry.newStatus === 'completed'
      ? 'emerald'
      : entry.eventType === 'login'
        ? 'indigo'
        : entry.newStatus === 'pending'
          ? 'amber'
          : 'slate';
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cx(
          'mt-1 h-2 w-2 shrink-0 rounded-full',
          tone === 'emerald' && 'bg-emerald-500',
          tone === 'indigo' && 'bg-indigo-500',
          tone === 'amber' && 'bg-amber-500',
          tone === 'slate' && 'bg-slate-400',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-800">{entry.description}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          @{entry.actorUsername}
          {entry.district ? ` · ${entry.district}` : ''} · {DATE_TIME.format(new Date(entry.createdAt))}
        </p>
      </div>
      {entry.newStatus ? (
        <Badge tone="slate" className="shrink-0">
          {entry.previousStatus ? `${entry.previousStatus} → ` : ''}
          {entry.newStatus}
        </Badge>
      ) : null}
    </li>
  );
}
