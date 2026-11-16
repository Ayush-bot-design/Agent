import {
  calculateSiteTransitGaps,
  type UserProfile,
  type InstallationSite,
  type SiteStatus,
} from './deployment-logic';
import type { PendingSiteIssue } from './site-pause';

/** Read model only. Never submit this object to a mutation or treat it as saved evidence. */
export interface SiteSummary {
  id: string;
  siteCode: string;
  district: string;
  clientName: string;
  address: string;
  status: SiteStatus;
  computerCount: number;
  latitude?: number;
  longitude?: number;
  reservedByName?: string;
  reservedByUser?: string;
  completedByUser?: string;
  startedAt?: string;
  completedAt?: string;
  pendingIssue?: PendingSiteIssue;
  workflowVersion: number;
  verifiedComputers: number;
  documentCount: number;
  previousCompletion?: {
    id: string;
    siteCode: string;
    district: string;
    clientName: string;
    completedAt: string;
    latitude?: number;
    longitude?: number;
  } | null;
}
export interface SiteSummaryQuery {
  scope?: 'all' | 'completed' | 'pending';
  district?: string;
  status?: 'all' | SiteStatus;
  search?: string;
  sort?: 'district' | 'name' | 'pending' | 'completion';
  startDate?: string;
  endDate?: string;
  cursor?: string | null;
  pageSize?: number;
}
export interface SiteSummaryPage {
  items: SiteSummary[];
  total: number;
  nextCursor: string | null;
}
export interface DashboardSiteContext {
  total: number;
  districts: Record<string, number>;
  completed: number;
  pending: number;
  active: SiteSummary | null;
  pendingItems: SiteSummary[];
  pendingHasMore: boolean;
}
/** Compatibility shell for read-only review placeholders only. Must be hydrated before opening work. */
export function summaryReviewShell(s: SiteSummary): InstallationSite & { summaryOnly: true } {
  return {
    ...s,
    summaryOnly: true,
    facilityName: '',
    zone: '',
    contactPerson: '',
    contactPhone: '',
    softwarePackage: '',
    expectedHostnamePrefix: '',
    sampleValidHostname: '',
    slaWindow: '24 hours',
    milestones: [],
    hostnameVerifications: [],
    documents: [],
  };
}

/** Calculate each row with its authoritative same-day predecessor, even when it is on another page. */
export function completedSummaryTransit(
  summary: SiteSummary,
  userKey: string,
  profile: UserProfile,
) {
  const current = summaryReviewShell(summary);
  const previous = summary.previousCompletion
    ? summaryReviewShell({
        ...summary.previousCompletion,
        status: 'completed',
        computerCount: 0,
        workflowVersion: 0,
        verifiedComputers: 0,
        documentCount: 0,
        address: '',
        completedByUser: userKey,
      })
    : null;
  return calculateSiteTransitGaps(previous ? [previous, current] : [current], userKey, {
    morningCheckInsByTech: {
      [userKey]: {
        verifiedAt: profile.morningOnDutyAt || profile.lastVerifiedAt,
        latitude: profile.morningOnDutyLatitude ?? profile.lastLatitude,
        longitude: profile.morningOnDutyLongitude ?? profile.lastLongitude,
      },
    },
  }).sitesWithTransit.find((s) => s.id === summary.id)!;
}
