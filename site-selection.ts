import { normalizeUserKey } from './deployment-logic';
import type { InstallationSite } from './deployment-logic';

export interface SiteReviewAction {
  kind: 'reserve' | 'resume' | 'start' | 'view-completed' | 'unavailable';
  label: string;
  description: string;
}

/** Read-only review is always allowed; only reserve/start requires confirmation. */
export function getSiteReviewAction(
  site: InstallationSite,
  userKeyInput: string,
  activeSite?: InstallationSite | null,
): SiteReviewAction {
  const userKey = normalizeUserKey(userKeyInput);
  const owner = site.reservedByUser ? normalizeUserKey(site.reservedByUser) : '';
  const completedBy = site.completedByUser ? normalizeUserKey(site.completedByUser) : '';

  if (site.status === 'completed' || site.biometricCompletionSeal?.verified) {
    return completedBy === userKey
      ? {
          kind: 'view-completed',
          label: 'View Completed Work',
          description:
            'This installation is complete. You can review your work without another reservation or biometric check.',
        }
      : {
          kind: 'unavailable',
          label: 'Already Completed',
          description: `This installation is already completed${completedBy ? ` by @${completedBy}` : ''}. You can review its details, but it cannot be reserved again.`,
        };
  }

  if (site.status === 'pending') {
    if (site.pendingIssue?.agentUserKey !== userKey)
      return {
        kind: 'unavailable',
        label: 'Pending — original agent only',
        description:
          'This site is paused and cannot be reserved by another agent. There is no automatic reopening.',
      };
    if (activeSite && activeSite.id !== site.id)
      return {
        kind: 'unavailable',
        label: 'Complete or pause your active site first',
        description: `You are working at "${activeSite.clientName}". Complete or pause it before resuming this pending site.`,
      };
    return {
      kind: 'resume',
      label: 'Issue resolved—resume',
      description:
        'Confirm the issue is resolved. Your saved work will reopen with a fresh 24-hour reservation. No admin approval is needed.',
    };
  }

  if (site.status === 'in_progress') {
    return owner === userKey
      ? {
          kind: 'start',
          label: 'Confirm & Start Work',
          description:
            'This site is already reserved to you. Confirm to verify your identity, then open the installation workspace.',
        }
      : {
          kind: 'unavailable',
          label: 'Reserved',
          description: `This site is reserved${owner ? ` by @${owner}` : ''}. You can review its details, but you cannot start another technician's work.`,
        };
  }

  if (activeSite && activeSite.id !== site.id) {
    return {
      kind: 'unavailable',
      label: 'Finish Your Active Site First',
      description: `You already have an active installation at "${activeSite.clientName}". Complete or pause it before reserving another site.`,
    };
  }

  if (site.status === 'available') {
    return {
      kind: 'reserve',
      label: 'Confirm & Reserve Site',
      description:
        'Confirm these details to continue to biometric verification. The site is reserved only after your identity is verified.',
    };
  }

  return {
    kind: 'unavailable',
    label: 'Unavailable',
    description: 'This site is not available for reservation. Please refresh the site list.',
  };
}
