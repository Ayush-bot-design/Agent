import { useState } from 'react';
import {
  getComputerSoftwarePlan,
  type ComputerArchitecture,
  type ComputerExceptionReason,
  type HostnameVerificationResult,
  type InstallationSite,
} from '../utils/deployment-logic';
import {
  COMPUTER_EXCEPTION_LABELS,
  computerDraftError,
  createComputerDraft,
  savedComputer,
  type ComputerDraft,
} from '../utils/installation-wizard';
import { useWorkspace } from '../lib/workspace-store';
import { useFlash } from '../lib/flash';
import { Alert, Badge, Button, Field, Modal, SelectInput, TextArea, TextInput } from './ui';
import { Icon } from './icons';

const ARCHITECTURES: Array<{ value: ComputerArchitecture; label: string }> = [
  { value: 'x64', label: '64-bit (x64)' },
  { value: 'x86', label: '32-bit (x86)' },
  { value: 'arm64', label: 'ARM64' },
  { value: 'unknown', label: 'Not sure' },
];

export function ComputerForm({
  site,
  index,
  onClose,
}: {
  site: InstallationSite;
  index: number;
  onClose: () => void;
}) {
  const { saveComputer } = useWorkspace();
  const { flash } = useFlash();
  const [draft, setDraft] = useState<ComputerDraft>(() => createComputerDraft(site, index));
  const [error, setError] = useState<string | null>(null);
  const existing = savedComputer(site, index);

  const update = (patch: Partial<ComputerDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = () => {
    const draftError = computerDraftError(draft);
    if (draftError) {
      setError(draftError);
      return;
    }
    const verification: HostnameVerificationResult = {
      verified: true,
      hostname: draft.hostname.trim().toUpperCase(),
      ramGB: Number(draft.ramGB),
      windowsVersion: draft.windowsVersion.trim(),
      windowsEdition: draft.windowsEdition.trim(),
      windowsBuild: draft.windowsBuild.trim(),
      systemArchitecture: (draft.systemArchitecture || 'unknown') as ComputerArchitecture,
      exceptionReason: draft.mode === 'excuse' ? (draft.reason as ComputerExceptionReason) : undefined,
      exceptionDescription: draft.mode === 'excuse' ? draft.description.trim() : undefined,
      workstationProofPhoto: draft.photo,
      exceptionProofPhoto: draft.mode === 'excuse' ? draft.photo : undefined,
      isDomainComputer: draft.mode === 'excuse' && draft.reason === 'domain_pc',
      resolvedIp: existing?.resolvedIp || `10.24.${index + 11}.${40 + index}`,
      agentVersion: '4.8.2',
      approvalCode: existing?.approvalCode || `APR-${site.siteCode.slice(-4)}-${String(index + 1).padStart(2, '0')}`,
    };
    const result = saveComputer(site.id, index, verification);
    if (result.ok) {
      flash(result.message, 'success');
      onClose();
    } else {
      setError(result.message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Device ${index + 1} of ${site.computerCount}`}
      subtitle={`${site.clientName} · ${site.siteCode}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>
            <Icon name="check" />
            Save device record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={draft.mode === 'standard' ? 'emerald' : 'amber'}>
            {draft.mode === 'standard' ? 'Standard installation' : 'Exception / excused device'}
          </Badge>
          <Badge tone="slate">Plan: {getComputerSoftwarePlan(Number(draft.ramGB) || null)}</Badge>
          {existing?.verified ? <Badge tone="indigo">Saved record</Badge> : null}
        </div>

        <div className="flex gap-2 rounded-xl bg-slate-900/[0.04] p-1">
          {(['standard', 'excuse'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => update({ mode })}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                draft.mode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {mode === 'standard' ? 'Install on this PC' : 'Record exception'}
            </button>
          ))}
        </div>

        {draft.mode === 'standard' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Installed RAM (GB)" error={error && !draft.ramGB ? error : null}>
                <TextInput
                  inputMode="numeric"
                  value={draft.ramGB}
                  onChange={(event) => update({ ramGB: event.target.value.replace(/[^0-9.]/g, '') })}
                  placeholder="8"
                />
              </Field>
              <Field label="System type">
                <SelectInput
                  value={draft.systemArchitecture}
                  onChange={(event) =>
                    update({ systemArchitecture: event.target.value as ComputerArchitecture | '' })
                  }
                >
                  <option value="">Select…</option>
                  {ARCHITECTURES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Windows version (winver)">
                <TextInput
                  value={draft.windowsVersion}
                  onChange={(event) => update({ windowsVersion: event.target.value })}
                  placeholder="Windows 11 Pro"
                />
              </Field>
              <Field label="Edition / build">
                <div className="grid grid-cols-2 gap-2">
                  <TextInput
                    value={draft.windowsEdition}
                    onChange={(event) => update({ windowsEdition: event.target.value })}
                    placeholder="22H2"
                    aria-label="Windows edition"
                  />
                  <TextInput
                    value={draft.windowsBuild}
                    onChange={(event) => update({ windowsBuild: event.target.value })}
                    placeholder="22621.4169"
                    aria-label="Windows build"
                  />
                </div>
              </Field>
            </div>

            <Field
              label="Verified hostname"
              hint={`Must end with .UP.GOV.LOCAL — prefix ${site.expectedHostnamePrefix}`}
            >
              <TextInput
                value={draft.hostname}
                onChange={(event) => update({ hostname: event.target.value })}
                placeholder={site.sampleValidHostname}
                className="font-mono text-sm"
              />
            </Field>
          </>
        ) : (
          <div className="grid gap-3">
            <Field label="Why is this device excused?">
              <SelectInput
                value={draft.reason}
                onChange={(event) =>
                  update({ reason: event.target.value as ComputerExceptionReason | '' })
                }
              >
                <option value="">Select a reason…</option>
                {Object.entries(COMPUTER_EXCEPTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field
              label="Exception description"
              hint="At least five words describing what you found on site."
            >
              <TextArea
                value={draft.description}
                onChange={(event) => update({ description: event.target.value })}
                placeholder="Accounts branch PC runs Windows 7 and cannot receive the agent."
              />
            </Field>
          </div>
        )}

        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-700">Live workstation photo</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Production requires a camera capture for every device. In this demo the capture is a
                placeholder token.
              </p>
            </div>
            <Button
              size="sm"
              variant={draft.photo ? 'secondary' : 'primary'}
              onClick={() => update({ photo: draft.photo ? '' : 'demo://workstation-photo' })}
            >
              <Icon name="camera" />
              {draft.photo ? 'Retake' : 'Capture'}
            </Button>
          </div>
          {draft.photo ? (
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-emerald-700">
              <Icon name="check" className="h-3.5 w-3.5" />
              {draft.photo}
            </p>
          ) : null}
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
