import { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateDeploymentProgress,
  generateSiteUuid,
  getComputerSoftwarePlan,
  getGoogleMapsNavigationUrl,
  getInstallationPhaseStepper,
  getReservationRemainingLabel,
  validateDocumentUpload,
  type InstallationSite,
  type UploadedDocument,
} from '../utils/deployment-logic';
import { SITE_PAUSE_REASONS, sitePauseRemarkError, type SitePauseReason } from '../utils/site-pause';
import { savedComputer } from '../utils/installation-wizard';
import { useWorkspace } from '../lib/workspace-store';
import { useFlash } from '../lib/flash';
import { Alert, Badge, Button, Card, DataRow, EmptyState, Field, Modal, ProgressBar, SelectInput, StatusBadge, TextArea, cx } from './ui';
import { Icon } from './icons';
import { ComputerForm } from './ComputerForm';

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatIst(value?: string): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : DATE_FORMAT.format(new Date(ms));
}

export function Workspace({ onBrowseSites }: { onBrowseSites: () => void }) {
  const { profile, sites, activeSite, nowMs, toggleMilestone, addDocument, saveNotes, pauseSite, completeSite } =
    useWorkspace();
  const { flash } = useFlash();
  const [computerIndex, setComputerIndex] = useState<number | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [notesFor, setNotesFor] = useState<string | null>(null);

  const pausedSite = useMemo(
    () =>
      sites.find(
        (site) =>
          site.status === 'pending' &&
          profile &&
          site.pendingIssue?.agentUserKey === profile.userKey,
      ) || null,
    [profile, sites],
  );

  const activeId = activeSite?.id;
  const activeNotes = activeSite?.notes;

  // Keep the notes composer in sync when the active site changes.
  useEffect(() => {
    if (activeId && notesFor !== activeId) {
      setNotesFor(activeId);
      setNoteDraft(activeNotes || '');
    }
  }, [activeId, activeNotes, notesFor]);

  if (!activeSite) {
    return (
      <Card className="p-5">
        <EmptyState
          title="No active installation"
          description="Reserve a site from the district worklist to start capturing devices. Only one site can be active at a time."
          action={<Button onClick={onBrowseSites}>Browse available sites</Button>}
        />
        {pausedSite ? <PausedNotice site={pausedSite} /> : null}
      </Card>
    );
  }

  const site = activeSite;
  const progress = calculateDeploymentProgress(site);
  const stepper = getInstallationPhaseStepper(site);
  const verifiedDevices = site.hostnameVerifications?.filter((entry) => entry?.verified).length || 0;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={site.status} />
                <Badge tone="slate">{site.siteCode}</Badge>
                <Badge tone="indigo">
                  <Icon name="clock" className="h-3 w-3" />
                  {getReservationRemainingLabel(site, nowMs)}
                </Badge>
              </div>
              <h1 className="mt-2 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
                {site.clientName}
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {site.facilityName} · {site.district} · {site.computerCount} devices ·{' '}
                {site.contactPerson}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={getGoogleMapsNavigationUrl(site)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-900/10 transition hover:bg-slate-50"
              >
                <Icon name="pin" />
                Navigate
              </a>
              <Button variant="secondary" onClick={() => setPauseOpen(true)}>
                <Icon name="pause" />
                Pause site
              </Button>
              <Button variant="success" onClick={() => setCompleteOpen(true)}>
                <Icon name="shield" />
                Complete
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {stepper.steps.map((step) => (
              <div
                key={step.id}
                className={cx(
                  'rounded-xl px-3 py-2.5 ring-1 ring-inset',
                  step.state === 'completed' && 'bg-emerald-50/80 ring-emerald-600/20',
                  step.state === 'current' && 'bg-indigo-50/80 ring-indigo-600/25',
                  step.state === 'upcoming' && 'bg-slate-50 ring-slate-900/[0.06]',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                      step.state === 'completed' && 'bg-emerald-600 text-white',
                      step.state === 'current' && 'bg-indigo-600 text-white',
                      step.state === 'upcoming' && 'bg-slate-300 text-white',
                    )}
                  >
                    {step.state === 'completed' ? '✓' : step.stepNumber}
                  </span>
                  <p className="text-xs font-bold text-slate-800">{step.label}</p>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">{step.subtitle}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Deployment checklist</span>
              <span className="tabular-nums">
                {progress.completedCount}/{progress.totalCount} milestones · {verifiedDevices}/
                {site.computerCount} devices
              </span>
            </div>
            <ProgressBar value={progress.percentage} tone="indigo" />
          </div>
          <div className="text-xs text-slate-500 sm:text-right">
            <p>{site.documents.length} document(s) attached</p>
            <p className="mt-0.5">
              {progress.canCompleteDeployment ? 'Ready to complete' : `${progress.blockingReasons.length} requirement(s) open`}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <SectionHeader
              title="Installation milestones"
              subtitle="Tick each step as it is physically completed on site."
            />
            <ul className="mt-3 space-y-2">
              {site.milestones.map((milestone) => (
                <li
                  key={milestone.id}
                  className={cx(
                    'flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset transition',
                    milestone.completed
                      ? 'bg-emerald-50/60 ring-emerald-600/15'
                      : 'bg-white ring-slate-900/[0.06]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleMilestone(site.id, milestone.id)}
                    aria-pressed={milestone.completed}
                    aria-label={`Toggle ${milestone.title}`}
                    className={cx(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 transition',
                      milestone.completed
                        ? 'bg-emerald-600 text-white ring-emerald-600'
                        : 'bg-white text-transparent ring-slate-300 hover:ring-slate-400',
                    )}
                  >
                    <Icon name="check" className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{milestone.title}</p>
                    <p className="text-xs text-slate-500">{milestone.description}</p>
                    {milestone.completedAt ? (
                      <p className="mt-0.5 text-[11px] text-emerald-700">
                        Done · {formatIst(milestone.completedAt)}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <SectionHeader
              title="Workstations"
              subtitle="Record RAM, Windows build and the verified hostname for every PC."
            />
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {Array.from({ length: site.computerCount }, (_, index) => {
                const record = savedComputer(site, index);
                return (
                  <li
                    key={index}
                    className={cx(
                      'rounded-xl p-3 ring-1 ring-inset',
                      record?.verified ? 'bg-white ring-emerald-600/20' : 'bg-slate-50/80 ring-slate-900/[0.06]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                        Device {index + 1}
                      </p>
                      {record?.verified ? (
                        <Badge tone="emerald">
                          <Icon name="check" className="h-3 w-3" />
                          Verified
                        </Badge>
                      ) : (
                        <Badge tone="amber">Pending</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-slate-800">
                      {record?.hostname || '— no hostname yet —'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {record?.exceptionReason
                        ? COMPUTER_EXCEPTION_TEXT[record.exceptionReason]
                        : record?.ramGB
                          ? `${record.ramGB} GB · ${getComputerSoftwarePlan(record.ramGB)}`
                          : 'RAM not recorded'}
                    </p>
                    <Button
                      size="sm"
                      variant={record?.verified ? 'secondary' : 'primary'}
                      className="mt-2 w-full"
                      onClick={() => setComputerIndex(index)}
                    >
                      {record?.verified ? 'Edit record' : 'Record device'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <DocumentsCard site={site} onUpload={addDocument} />
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <SectionHeader title="Site facts" subtitle="From the department import — read only." />
            <dl className="mt-2 divide-y divide-slate-100">
              <DataRow label="Contact" value={site.contactPerson} />
              <DataRow label="Phone" value={site.contactPhone} />
              <DataRow label="Address" value={site.address} />
              <DataRow label="Expected prefix" value={<span className="font-mono text-xs">{site.expectedHostnamePrefix}</span>} />
              <DataRow label="Location key" value={<span className="font-mono text-[11px]">{site.locationKey}</span>} />
              <DataRow label="Reserved at" value={formatIst(site.startedAt)} />
              <DataRow
                label="Arrival check"
                value={
                  site.biometricArrivalVerification
                    ? `${site.biometricArrivalVerification.matchScore}% match`
                    : '—'
                }
              />
            </dl>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Notes & remarks" subtitle="Visible to you and your sub-admin." />
            <TextArea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Access details, contact changes, department instructions…"
              className="mt-3"
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  saveNotes(site.id, noteDraft);
                  flash('Notes saved to the site record.', 'success');
                }}
              >
                Save notes
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Completion gate" subtitle="Server-side rules enforced before sealing." />
            <ul className="mt-3 space-y-2">
              {progress.blockingReasons.length === 0 ? (
                <li className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20 ring-inset">
                  <Icon name="check" className="h-4 w-4" />
                  All requirements satisfied — submit for the biometric seal.
                </li>
              ) : (
                progress.blockingReasons.map((reason) => (
                  <li
                    key={reason}
                    className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20 ring-inset"
                  >
                    <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {reason}
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      </div>

      {computerIndex !== null ? (
        <ComputerForm site={site} index={computerIndex} onClose={() => setComputerIndex(null)} />
      ) : null}

      <PauseDialog
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        onSubmit={(reason, remark) => {
          const result = pauseSite(site.id, reason, remark);
          flash(result.message, result.ok ? 'success' : 'error');
          if (result.ok) {
            setPauseOpen(false);
            onBrowseSites();
          }
        }}
      />

      <CompleteDialog
        open={completeOpen}
        site={site}
        onClose={() => setCompleteOpen(false)}
        onComplete={() => {
          const result = completeSite(site.id);
          flash(result.message, result.ok ? 'success' : 'error');
          setCompleteOpen(false);
          if (result.ok) onBrowseSites();
        }}
      />
    </div>
  );
}

const COMPUTER_EXCEPTION_TEXT: Record<string, string> = {
  pc_unavailable: 'PC not available',
  domain_pc: 'Domain PC',
  windows_7: 'Windows 7 — not installable',
  other: 'Exception recorded',
};

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-sm font-bold tracking-tight text-slate-900">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function PausedNotice({ site }: { site: InstallationSite }) {
  const { resumeSite } = useWorkspace();
  const { flash } = useFlash();
  return (
    <div className="mt-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-600/20 ring-inset">
      <p className="text-sm font-semibold text-amber-900">
        You paused {site.siteCode} — {site.clientName}
      </p>
      <p className="mt-1 text-xs text-amber-800">
        {site.pendingIssue?.remark} · Other agents cannot claim this site while it is pending.
      </p>
      <Button
        size="sm"
        className="mt-3"
        onClick={() => {
          const result = resumeSite(site.id);
          flash(result.message, result.ok ? 'success' : 'error');
        }}
      >
        <Icon name="play" />
        Issue resolved — resume
      </Button>
    </div>
  );
}

function DocumentsCard({
  site,
  onUpload,
}: {
  site: InstallationSite;
  onUpload: (siteId: string, document: UploadedDocument) => { ok: boolean; message: string };
}) {
  const { flash } = useFlash();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<UploadedDocument['docType']>('Sign-Off Certificate');
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const validation = validateDocumentUpload({ name: file.name, sizeBytes: file.size });
    if (!validation.isValid) {
      setError(validation.error || 'Invalid document.');
      return;
    }
    setError(null);
    let checksum = 'unavailable';
    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      checksum = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32);
    } catch {
      checksum = `local-${file.size}-${file.lastModified}`;
    }
    const document: UploadedDocument = {
      id: generateSiteUuid(),
      name: file.name,
      docType,
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      checksum,
    };
    const result = onUpload(site.id, document);
    flash(result.message, result.ok ? 'success' : 'error');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Card className="p-5">
      <SectionHeader
        title="Official paperwork"
        subtitle="Signed certificate, acceptance form or device serial log. PDF, PNG, JPG or DOCX up to 25 MB."
      />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <SelectInput
          value={docType}
          onChange={(event) => setDocType(event.target.value as UploadedDocument['docType'])}
          aria-label="Document type"
          className="sm:max-w-56"
        >
          <option>Sign-Off Certificate</option>
          <option>Site Acceptance Form</option>
          <option>Device Serial Log</option>
        </SelectInput>
        <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
          <Icon name="document" />
          Choose file
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            className="sr-only"
            onChange={(event) => void handleFiles(event.target.files)}
          />
        </label>
      </div>
      {error ? (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <ul className="mt-3 space-y-2">
        {site.documents.length === 0 ? (
          <li className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
            No documents attached yet.
          </li>
        ) : (
          site.documents.map((document) => (
            <li
              key={document.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-900/[0.06] ring-inset"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{document.name}</p>
                <p className="text-[11px] text-slate-500">
                  {document.docType} · {(document.sizeBytes / 1024).toFixed(0)} KB ·{' '}
                  {formatIst(document.uploadedAt)} · sha256 {document.checksum.slice(0, 12)}…
                </p>
              </div>
              <Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

function PauseDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: SitePauseReason, remark: string) => void;
}) {
  const [reason, setReason] = useState<SitePauseReason>('access_denied');
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pause this installation"
      subtitle="The site becomes pending and only you can resume it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const message = sitePauseRemarkError(remark);
              if (message) {
                setError(message);
                return;
              }
              onSubmit(reason, remark);
              setRemark('');
              setError(null);
            }}
          >
            <Icon name="pause" />
            Pause site
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Reason">
          <SelectInput value={reason} onChange={(event) => setReason(event.target.value as SitePauseReason)}>
            {Object.entries(SITE_PAUSE_REASONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Remark" hint="10–500 characters. Stored with the pause event." error={error}>
          <TextArea
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            placeholder="Server room locked; divisional engineer will hand over keys tomorrow 11:00."
          />
        </Field>
      </div>
    </Modal>
  );
}

function CompleteDialog({
  open,
  site,
  onClose,
  onComplete,
}: {
  open: boolean;
  site: InstallationSite;
  onClose: () => void;
  onComplete: () => void;
}) {
  const progress = calculateDeploymentProgress(site);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Complete & seal installation"
      subtitle={`${site.siteCode} · ${site.clientName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not yet
          </Button>
          <Button variant="success" disabled={!progress.canCompleteDeployment} onClick={onComplete}>
            <Icon name="shield" />
            Run biometric seal & complete
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Alert tone={progress.canCompleteDeployment ? 'success' : 'warning'}>
          {progress.canCompleteDeployment
            ? 'All milestones, device records and documents are in place. Completing will issue an immutable completion seal.'
            : 'Resolve the open requirements below before the site can be completed.'}
        </Alert>
        <ul className="space-y-1.5 text-sm">
          {progress.blockingReasons.length === 0 ? (
            <li className="flex items-center gap-2 text-emerald-700">
              <Icon name="check" className="h-4 w-4" />
              {site.computerCount} of {site.computerCount} devices verified
            </li>
          ) : (
            progress.blockingReasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-amber-800">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                {reason}
              </li>
            ))
          )}
        </ul>
        <p className="text-xs text-slate-500">
          Demo note: the biometric seal is simulated locally with a 98% match score. In production the
          server compares the live capture against your enrolled face template and writes the seal.
        </p>
      </div>
    </Modal>
  );
}
