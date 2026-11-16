export const SITE_PAUSE_REASONS = {
  office_closed: 'Office closed',
  access_denied: 'Access denied',
  power_network: 'Power / network issue',
  equipment_issue: 'PC / equipment issue',
  personal_emergency: 'Unable to continue / personal emergency',
  other: 'Other',
} as const;
export type SitePauseReason = keyof typeof SITE_PAUSE_REASONS;
export interface PendingSiteIssue {
  agentUserKey: string;
  agentUserId?: string | null;
  agentName: string;
  serialNo: string;
  reason: SitePauseReason;
  remark: string;
  pausedAt: string;
}
export function sitePauseRemarkError(remark: string): string | null {
  return remark.trim().length < 10 || remark.trim().length > 500
    ? 'Add a short remark of 10–500 characters.'
    : null;
}
