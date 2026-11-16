import type {
  ComputerArchitecture,
  ComputerExceptionReason,
  HostnameVerificationResult,
  InstallationSite,
} from './deployment-logic';

export type ComputerStep = 'result' | 'details' | 'hostname' | 'reason' | 'photo' | 'review';
export type InstallationStep =
  ComputerStep | 'software' | 'computers' | 'paperwork' | 'finish' | 'resources' | 'site';
export interface ComputerDraft {
  mode: 'standard' | 'excuse';
  hostname: string;
  ramGB: string;
  windowsVersion: string;
  windowsEdition: string;
  windowsBuild: string;
  systemArchitecture: ComputerArchitecture | '';
  reason: ComputerExceptionReason | '';
  description: string;
  photo: string;
}
export const COMPUTER_EXCEPTION_LABELS: Record<ComputerExceptionReason, string> = {
  pc_unavailable: 'PC is not available',
  domain_pc: 'Domain PC',
  windows_7: 'Windows 7 — software not installable',
  other: 'Other reason',
};
export function savedComputer(
  site: InstallationSite,
  index: number,
): HostnameVerificationResult | undefined {
  return (
    site.hostnameVerifications?.[index] || (index === 0 ? site.hostnameVerification : undefined)
  );
}
export function firstPendingComputer(site: InstallationSite): number {
  return Array.from({ length: site.computerCount || 1 }).findIndex(
    (_, i) => !savedComputer(site, i)?.verified,
  );
}
export function createComputerDraft(site: InstallationSite, index: number): ComputerDraft {
  const saved = savedComputer(site, index);
  const domain = saved?.isDomainComputer || site.domainComputerIndices?.includes(index);
  return {
    mode: saved?.exceptionReason || domain ? 'excuse' : 'standard',
    hostname: saved?.hostname || '',
    ramGB: saved?.ramGB == null ? '' : String(saved.ramGB),
    windowsVersion: saved?.windowsVersion || '',
    windowsEdition: saved?.windowsEdition || '',
    windowsBuild: saved?.windowsBuild || '',
    systemArchitecture: saved?.systemArchitecture || '',
    reason: saved?.exceptionReason || (domain ? 'domain_pc' : ''),
    description: saved?.exceptionDescription || '',
    photo:
      saved?.workstationProofPhoto || saved?.exceptionProofPhoto || saved?.domainProofPhoto || '',
  };
}
export function computerSteps(mode: ComputerDraft['mode']): ComputerStep[] {
  return mode === 'excuse'
    ? ['result', 'reason', 'photo', 'review']
    : ['result', 'details', 'hostname', 'photo', 'review'];
}
export function computerStepError(step: ComputerStep, draft: ComputerDraft): string | null {
  if (step === 'details') {
    const ram = Number(draft.ramGB);
    if (!Number.isFinite(ram) || ram <= 0 || ram > 4096)
      return 'Enter installed RAM between 0 and 4096 GB.';
    if (!draft.windowsVersion.trim()) return 'Enter the Windows version shown by winver.';
    if (!['x64', 'x86', 'arm64', 'unknown'].includes(draft.systemArchitecture))
      return 'Select the system type.';
  }
  if (step === 'hostname' && !draft.hostname.trim())
    return 'Enter this computer’s unique hostname.';
  if (step === 'reason') {
    if (!Object.hasOwn(COMPUTER_EXCEPTION_LABELS, draft.reason))
      return 'Choose why installation is not possible.';
    if (
      draft.reason === 'other' &&
      draft.description.trim().split(/\s+/).filter(Boolean).length < 5
    )
      return 'Describe the issue using at least five words.';
  }
  if (step === 'photo' && !draft.photo) return 'Capture a live workstation photo to continue.';
  return null;
}
export function computerDraftError(draft: ComputerDraft): string | null {
  for (const step of computerSteps(draft.mode)) {
    const error = computerStepError(step, draft);
    if (error) return error;
  }
  return null;
}
