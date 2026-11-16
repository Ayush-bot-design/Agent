import type { InstallationSite } from './deployment-logic.ts';
import { normalizeUserKey } from './deployment-logic.ts';
import { ProvisionedUserRecord } from '../lib/supabase';

export interface DestructiveWarningDetails {
  title: string;
  itemIdentifier: string;
  badgeLabel?: string;
  summary: string;
  impacts: string[];
  severity: 'critical' | 'warning' | 'caution';
  confirmButtonLabel: string;
  loadingLabel: string;
}

/**
 * Evaluates the impact of deleting a user account and generates structured warnings.
 */
export function getDestructiveUserDeleteWarning(
  user: ProvisionedUserRecord | { id: string; username: string; email?: string; serialNo?: string },
  allSites: InstallationSite[],
): DestructiveWarningDetails {
  const userKey = normalizeUserKey(user.username || user.email || '');
  const activeSites = allSites.filter(
    (s) => s.status === 'in_progress' && normalizeUserKey(s.reservedByUser || '') === userKey,
  );
  const completedSites = allSites.filter(
    (s) =>
      s.status === 'completed' &&
      normalizeUserKey(s.completedByUser || s.reservedByUser || '') === userKey,
  );

  const impacts: string[] = [
    'User authentication credentials will be revoked immediately from Supabase.',
    'User profile, contact phone, residential address, and verified legal proofs will be purged.',
  ];

  if (activeSites.length > 0) {
    impacts.unshift(
      `CRITICAL: User currently holds active reservation on ${activeSites.length} site(s) (${activeSites
        .map((s) => s.siteCode || s.clientName)
        .slice(0, 2)
        .join(
          ', ',
        )}${activeSites.length > 2 ? '...' : ''}). These will be orphaned or automatically unassigned.`,
    );
  }

  if (completedSites.length > 0) {
    impacts.push(
      `Historical deployment record credits for ${completedSites.length} completed site(s) will lose their primary user profile link.`,
    );
  }

  return {
    title: 'Delete User Account',
    itemIdentifier: `@${user.username} (${user.serialNo || 'Serial not assigned'})`,
    badgeLabel: user.serialNo,
    summary: `Are you sure you want to permanently delete the account for @${user.username}?`,
    impacts,
    severity: activeSites.length > 0 ? 'critical' : 'warning',
    confirmButtonLabel: 'Delete User Account',
    loadingLabel: 'Deleting User...',
  };
}

/**
 * Evaluates the impact of permanently deleting an installation site.
 */
export function getDestructiveSiteDeleteWarning(site: InstallationSite): DestructiveWarningDetails {
  const isReserved = site.status === 'in_progress';
  const isCompleted = site.status === 'completed';

  const impacts: string[] = [
    `Permanent removal of site record "${site.clientName}" (${site.siteCode}) from Uttar Pradesh directory.`,
    'All associated hostname records, uploaded tender documents, and milestone histories will be permanently deleted.',
  ];

  if (isReserved) {
    impacts.unshift(
      `Site is currently reserved by field agent @${normalizeUserKey(site.reservedByUser || '')}. Deletion will terminate their ongoing installation.`,
    );
  } else if (isCompleted) {
    impacts.unshift(
      `Site has already been marked as Completed. Deleting will erase official completion telemetry.`,
    );
  }

  return {
    title: 'Delete Installation Site',
    itemIdentifier: `${site.clientName} [${site.siteCode}]`,
    badgeLabel: site.district,
    summary: `Permanently delete installation site "${site.clientName}" in ${site.district}?`,
    impacts,
    severity: isReserved || isCompleted ? 'critical' : 'warning',
    confirmButtonLabel: 'Delete Site',
    loadingLabel: 'Deleting Site...',
  };
}

/**
 * Evaluates the impact of deleting a bulk selection of registry sites. Mirrors the single-site
 * copy, but summarises the selection and escalates when in-progress or completed work is included.
 */
export function getDestructiveBulkSiteDeleteWarning(
  sites: InstallationSite[],
): DestructiveWarningDetails {
  const count = sites.length;
  const inProgress = sites.filter((site) => site.status === 'in_progress');
  const completed = sites.filter((site) => site.status === 'completed');
  const districts = [...new Set(sites.map((site) => site.district).filter(Boolean))];
  const noun = count === 1 ? 'site' : 'sites';

  const impacts: string[] = [];

  if (inProgress.length) {
    impacts.push(
      `${inProgress.length} selected ${inProgress.length === 1 ? 'site is' : 'sites are'} in progress — ${
        inProgress.length === 1
          ? `@${normalizeUserKey(inProgress[0].reservedByUser || 'agent')}'s`
          : 'the assigned technicians'
      } installation${inProgress.length === 1 ? '' : 's'} will be terminated.`,
    );
  }
  if (completed.length) {
    impacts.push(
      `${completed.length} selected ${completed.length === 1 ? 'site is' : 'sites are'} completed — official completion telemetry will be erased.`,
    );
  }
  impacts.push(
    `${count} selected ${noun} will be permanently removed from the Uttar Pradesh directory and from the Supabase sites table.`,
    'Uploaded tender certificates in the private bucket are deleted with their site records.',
    'This action cannot be undone.',
  );

  return {
    title: count === 1 ? 'Delete Installation Site' : `Delete ${count} Installation Sites`,
    itemIdentifier:
      count === 1 ? `${sites[0].clientName} [${sites[0].siteCode}]` : `${count} selected sites`,
    badgeLabel:
      districts.length === 1
        ? districts[0]
        : `${districts.length || count} ${districts.length === 1 ? 'district' : 'districts'}`,
    summary:
      count === 1
        ? `Permanently delete installation site "${sites[0].clientName}" in ${sites[0].district}?`
        : `Permanently delete ${count} selected installation sites from the database?`,
    impacts,
    severity: inProgress.length || completed.length ? 'critical' : 'warning',
    confirmButtonLabel: count === 1 ? 'Delete Site' : `Delete ${count} Sites`,
    loadingLabel: count === 1 ? 'Deleting Site...' : 'Deleting Sites...',
  };
}

/**
 * Evaluates the impact of releasing / resetting an active site reservation.
 */
export function getDestructiveReleaseWarning(site: InstallationSite): DestructiveWarningDetails {
  const agentKey = normalizeUserKey(site.reservedByUser || 'technician');
  return {
    title: 'Release Site Reservation',
    itemIdentifier: `${site.clientName} [${site.siteCode}]`,
    badgeLabel: site.district,
    summary: `Release current reservation held by @${agentKey}?`,
    impacts: [
      `The site will be immediately returned to "Available" status.`,
      `Agent @${agentKey} will lose their exclusive lock on this site.`,
      `Existing milestones, hostnames, documents and computer details will be retained.`,
    ],
    severity: 'caution',
    confirmButtonLabel: 'Release Reservation',
    loadingLabel: 'Releasing Site...',
  };
}

/**
 * Evaluates the impact of removing an uploaded legal document or proof.
 */
export function getDestructiveDocumentRemoveWarning(docName: string): DestructiveWarningDetails {
  return {
    title: 'Remove Document',
    itemIdentifier: docName,
    summary: `Remove the attached government legal document "${docName}"?`,
    impacts: [
      'The document file will be disconnected from the profile and removed.',
      'Technicians without verified legal proofs cannot be assigned to high-priority UP government sites.',
    ],
    severity: 'caution',
    confirmButtonLabel: 'Remove Document',
    loadingLabel: 'Removing...',
  };
}
