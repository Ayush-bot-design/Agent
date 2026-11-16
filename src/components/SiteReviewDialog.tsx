import { useState } from 'react';
import {
  calculateDeploymentProgress,
  getGoogleMapsNavigationUrl,
  getReservationRemainingLabel,
  type InstallationSite,
} from '../utils/deployment-logic';
import { getSiteReviewAction } from '../utils/site-selection';
import { completedSiteDetails } from '../utils/completed-site-details';
import { useWorkspace } from '../lib/workspace-store';
import { useFlash } from '../lib/flash';
import { Alert, Badge, Button, DataRow, Modal, ProgressBar, StatusBadge } from './ui';
import { Icon } from './icons';

export function SiteReviewDialog({
  site,
  onClose,
  onOpenWorkspace,
}: {
  site: InstallationSite | null;
  onClose: () => void;
  onOpenWorkspace: () => void;
}) {
  const { profile, activeSite, reserveSite, resumeSite, nowMs } = useWorkspace();
  const { flash } = useFlash();
  const [busy, setBusy] = useState(false);

  if (!site) return null;

  const action = getSiteReviewAction(site, profile?.userKey || '', activeSite);
  const progress = calculateDeploymentProgress(site);
  const completed = site.status === 'completed' ? completedSiteDetails(site) : null;

  const confirm = () => {
    setBusy(true);
    const result =
      action.kind === 'reserve'
        ? reserveSite(site.id)
        : action.kind === 'resume'
          ? resumeSite(site.id)
          : { ok: true, message: '' };
    setBusy(false);
    if (result.ok) {
      if (result.message) flash(result.message, 'success');
      onClose();
      if (action.kind === 'reserve' || action.kind === 'resume' || action.kind === 'start') {
        onOpenWorkspace();
      }
    } else {
      flash(result.message, 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={site.clientName}
      subtitle={`${site.siteCode} · ${site.district} · ${site.officeType}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {action.kind === 'reserve' || action.kind === 'resume' ? (
            <Button onClick={confirm} disabled={busy}>
              <Icon name="shield" />
              {action.kind === 'reserve' ? 'Verify identity & reserve' : 'Resume with fresh 24h window'}
            </Button>
          ) : null}
          {action.kind === 'start' ? (
            <Button onClick={() => { onClose(); onOpenWorkspace(); }}>
              <Icon name="workspace" />
              Open workspace
            </Button>
          ) : null}
          {action.kind === 'view-completed' ? (
            <Badge tone="emerald">
              <Icon name="check" className="h-3.5 w-3.5" />
              Completed by you
            </Badge>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={site.status} />
          <Badge tone="slate">{site.computerCount} target devices</Badge>
          <Badge tone="slate">{site.slaWindow}</Badge>
          {site.status === 'in_progress' ? (
            <Badge tone="indigo">
              <Icon name="clock" className="h-3 w-3" />
              {getReservationRemainingLabel(site, nowMs)}
            </Badge>
          ) : null}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Deployment progress</span>
            <span className="tabular-nums">
              {progress.completedCount}/{progress.totalCount} milestones · {progress.percentage}%
            </span>
          </div>
          <ProgressBar value={progress.percentage} tone={site.status === 'completed' ? 'emerald' : 'indigo'} />
        </div>

        <Alert tone={action.kind === 'unavailable' ? 'warning' : 'info'}>
          <strong className="font-semibold">{action.label}</strong> — {action.description}
        </Alert>

        {site.status === 'pending' && site.pendingIssue ? (
          <Alert tone="warning">
            Paused by {site.pendingIssue.agentName} ({site.pendingIssue.serialNo}) ·{' '}
            {new Date(site.pendingIssue.pausedAt).toLocaleString('en-IN')}
            <br />
            Remark: {site.pendingIssue.remark}
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <dl className="divide-y divide-slate-100">
            <DataRow label="Facility" value={site.facilityName} />
            <DataRow label="Address" value={site.address} />
            <DataRow label="Contact" value={`${site.contactPerson} · ${site.contactPhone}`} />
            <DataRow label="Division" value={site.division} />
            <DataRow label="Sub division" value={site.subDivision} />
            <DataRow label="Preferred window" value={site.preferredRemoteTime} />
          </dl>
          <dl className="divide-y divide-slate-100">
            <DataRow label="Hostname prefix" value={<span className="font-mono text-xs">{site.expectedHostnamePrefix}</span>} />
            <DataRow label="Sample hostname" value={<span className="font-mono text-xs">{site.sampleValidHostname}</span>} />
            <DataRow label="Software plan" value={site.softwarePackage} />
            <DataRow label="Discom" value={site.discom} />
            <DataRow label="Source row" value={site.locationKey} />
            <DataRow
              label="Navigate"
              value={
                <a
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-500"
                  href={getGoogleMapsNavigationUrl(site)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="pin" className="h-3.5 w-3.5" />
                  Google Maps
                </a>
              }
            />
          </dl>
        </div>

        {completed ? (
          <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-900/[0.06]">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Completion record</p>
            <p className="mt-1 text-sm text-slate-700">
              Hostname <span className="font-mono">{completed.hostname || '—'}</span> ·{' '}
              {completed.documents.length} documents
              {completed.seal ? ` · seal ${completed.seal.verificationId} (${completed.seal.matchScore}% match)` : ''}
            </p>
            {completed.remark ? (
              <p className="mt-1 text-sm text-slate-600">Remark: {completed.remark}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Identity verification in this demo is simulated locally. Connect the Supabase backend for live
            face-template matching and server-side attestation.
          </p>
        )}
      </div>
    </Modal>
  );
}
