import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  calculateDeploymentProgress,
  canUserClaimSite,
  createDefaultUserProfile,
  createDefaultMilestones,
  generateSiteUuid,
  getActiveSiteForUser,
  normalizeUserKey,
  releaseExpiredReservations,
  type ActivityLogEntry,
  type HostnameVerificationResult,
  type InstallationSite,
  type MilestoneStep,
  type SiteStatus,
  type UploadedDocument,
  type UserProfile,
} from '../utils/deployment-logic';
import type { PendingSiteIssue, SitePauseReason } from '../utils/site-pause';
import { createSeedSites } from './seed-sites';

const STORAGE_KEY = 'up-tender-console/v1';

export interface ActionResult {
  ok: boolean;
  message: string;
}

interface PersistedState {
  version: 1;
  profile: UserProfile | null;
  sites: InstallationSite[];
  activity: ActivityLogEntry[];
}

interface WorkspaceContextValue {
  profile: UserProfile | null;
  sites: InstallationSite[];
  activity: ActivityLogEntry[];
  activeSite: InstallationSite | null;
  nowMs: number;
  signIn: (input: { name: string; email: string; zone: string }) => void;
  signOut: () => void;
  resetDemoData: () => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  reserveSite: (siteId: string) => ActionResult;
  resumeSite: (siteId: string) => ActionResult;
  pauseSite: (siteId: string, reason: SitePauseReason, remark: string) => ActionResult;
  toggleMilestone: (siteId: string, milestoneId: MilestoneStep['id']) => void;
  saveComputer: (
    siteId: string,
    index: number,
    verification: HostnameVerificationResult,
  ) => ActionResult;
  addDocument: (siteId: string, document: UploadedDocument) => ActionResult;
  saveNotes: (siteId: string, notes: string) => void;
  completeSite: (siteId: string) => ActionResult;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function emptyState(): PersistedState {
  return { version: 1, profile: null, sites: createSeedSites(), activity: [] };
}

function loadState(): PersistedState {
  if (typeof window === 'undefined') return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sites)) return emptyState();
    const { sites } = releaseExpiredReservations(parsed.sites);
    return {
      version: 1,
      profile: parsed.profile ?? null,
      sites,
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
    };
  } catch {
    return emptyState();
  }
}

function logEntry(entry: Omit<ActivityLogEntry, 'id' | 'createdAt'>): ActivityLogEntry {
  return { ...entry, id: generateSiteUuid(), createdAt: new Date().toISOString() };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => loadState());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* Storage can be full or blocked (private mode); the console keeps working in memory. */
    }
  }, [state]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeSite = useMemo(
    () => (state.profile ? getActiveSiteForUser(state.sites, state.profile.userKey, nowMs) : null),
    [state.profile, state.sites, nowMs],
  );

  const actorName = state.profile?.fullName || state.profile?.username || 'Guest agent';

  const signIn = useCallback((input: { name: string; email: string; zone: string }) => {
    const base = createDefaultUserProfile({
      id: generateSiteUuid(),
      email: input.email,
      name: input.name,
    });
    const profile: UserProfile = {
      ...base,
      fullName: input.name.trim() || base.fullName,
      username: (input.name.trim() || base.username).toLowerCase().replace(/\s+/g, '_'),
      operatingZone: input.zone,
      phone: '+91 90000 00000',
      address: `${input.zone}, Uttar Pradesh`,
      serialNo: 'SN-UP-1001',
      employeeId: base.employeeId,
      lastVerifiedAt: new Date().toISOString(),
      lastMatchScore: 97,
      onDuty: true,
    };
    profile.userKey = normalizeUserKey(profile.username);
    setState((prev) => ({
      ...prev,
      profile,
      activity: [
        logEntry({
          eventType: 'login',
          actorUsername: profile.userKey,
          actorFullName: profile.fullName,
          actorEmail: profile.email,
          actorRole: 'agent',
          serialNo: profile.serialNo,
          description: `${profile.fullName} signed in to the deployment console (${profile.operatingZone}).`,
        }),
        ...prev.activity,
      ],
    }));
  }, []);

  const signOut = useCallback(() => {
    setState((prev) => ({ ...prev, profile: null }));
  }, []);

  const resetDemoData = useCallback(() => {
    setState((prev) => ({
      version: 1,
      profile: prev.profile,
      sites: createSeedSites(),
      activity: [
        logEntry({
          eventType: 'site_created',
          actorUsername: prev.profile?.userKey || 'agent',
          actorFullName: prev.profile?.fullName,
          actorRole: 'system',
          description: 'Demo worklist restored to its seeded state.',
        }),
        ...prev.activity,
      ],
    }));
  }, []);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setState((prev) =>
      prev.profile
        ? { ...prev, profile: { ...prev.profile, ...patch, updatedAt: new Date().toISOString() } }
        : prev,
    );
  }, []);

  const reserveSite = useCallback(
    (siteId: string): ActionResult => {
      if (!state.profile) return { ok: false, message: 'Sign in to reserve a site.' };
      const claim = canUserClaimSite(state.sites, siteId, state.profile.userKey, Date.now());
      if (!claim.allowed) {
        return { ok: false, message: claim.reason || 'This site cannot be reserved right now.' };
      }
      const target = state.sites.find((site) => site.id === siteId);
      if (!target) return { ok: false, message: 'Installation site not found.' };
      if (target.status === 'in_progress' && target.reservedByUser === state.profile.userKey) {
        return {
          ok: true,
          message: 'Site already reserved to you — open the workspace to continue.',
        };
      }

      const stamp = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        sites: prev.sites.map((site) =>
          site.id === siteId
            ? {
                ...site,
                status: 'in_progress',
                reservedByUser: prev.profile?.userKey,
                reservedByName: prev.profile?.fullName,
                startedAt: stamp,
                pendingIssue: undefined,
                biometricArrivalVerification: {
                  verified: true,
                  verifiedByUser: prev.profile?.userKey || 'agent',
                  verifiedByName: prev.profile?.fullName,
                  verificationId: `ARR-${site.siteCode}-${stamp.slice(11, 19).replace(/:/g, '')}`,
                  matchScore: 96,
                  verifiedAt: stamp,
                  latitude: site.latitude,
                  longitude: site.longitude,
                  accuracyMeters: 20,
                },
              }
            : site,
        ),
        activity: [
          logEntry({
            eventType: 'status_change',
            actorUsername: prev.profile?.userKey || 'agent',
            actorFullName: prev.profile?.fullName,
            actorEmail: prev.profile?.email,
            actorRole: 'agent',
            serialNo: prev.profile?.serialNo || undefined,
            verificationId: `ARR-${target.siteCode}`,
            matchScore: 96,
            siteId: target.id,
            siteCode: target.siteCode,
            siteName: target.clientName,
            district: target.district,
            previousStatus: target.status,
            newStatus: 'in_progress',
            description: `Reserved ${target.siteCode} — ${target.clientName} (${target.district}).`,
          }),
          ...prev.activity,
        ],
      }));
      return {
        ok: true,
        message: `Site reserved. You have 24 hours to complete the installation at ${target.clientName}.`,
      };
    },
    [state.profile, state.sites],
  );

  const resumeSite = useCallback(
    (siteId: string): ActionResult => {
      if (!state.profile) return { ok: false, message: 'Sign in to resume a site.' };
      const target = state.sites.find((site) => site.id === siteId);
      if (!target) return { ok: false, message: 'Installation site not found.' };
      if (target.status !== 'pending') {
        return { ok: false, message: 'Only a paused site can be resumed.' };
      }
      if (target.pendingIssue?.agentUserKey !== state.profile.userKey) {
        return {
          ok: false,
          message: 'This site was paused by another agent. Only that agent can resume it.',
        };
      }
      const otherActive = getActiveSiteForUser(state.sites, state.profile.userKey, Date.now());
      if (otherActive && otherActive.id !== target.id) {
        return {
          ok: false,
          message: `Finish or pause "${otherActive.clientName}" before resuming another site.`,
        };
      }
      const stamp = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        sites: prev.sites.map((site) =>
          site.id === siteId
            ? {
                ...site,
                status: 'in_progress',
                pendingIssue: undefined,
                workflowVersion: (site.workflowVersion || 1) + 1,
                startedAt: stamp,
                reservedByUser: prev.profile?.userKey,
                reservedByName: prev.profile?.fullName,
                biometricArrivalVerification: {
                  verified: true,
                  verifiedByUser: prev.profile?.userKey || 'agent',
                  verifiedByName: prev.profile?.fullName,
                  verificationId: `ARR-${site.siteCode}-resume`,
                  matchScore: 95,
                  verifiedAt: stamp,
                  latitude: site.latitude,
                  longitude: site.longitude,
                  accuracyMeters: 25,
                },
              }
            : site,
        ),
        activity: [
          logEntry({
            eventType: 'status_change',
            actorUsername: prev.profile?.userKey || 'agent',
            actorFullName: prev.profile?.fullName,
            actorRole: 'agent',
            siteId: target.id,
            siteCode: target.siteCode,
            siteName: target.clientName,
            district: target.district,
            previousStatus: 'pending',
            newStatus: 'in_progress',
            description: `Resumed ${target.siteCode} with a fresh 24-hour reservation window.`,
          }),
          ...prev.activity,
        ],
      }));
      return { ok: true, message: 'Issue marked resolved. Your reservation window restarted.' };
    },
    [state.profile, state.sites],
  );

  const pauseSite = useCallback(
    (siteId: string, reason: SitePauseReason, remark: string): ActionResult => {
      if (!state.profile) return { ok: false, message: 'Sign in to pause a site.' };
      const target = state.sites.find((site) => site.id === siteId);
      if (!target) return { ok: false, message: 'Installation site not found.' };
      const pendingIssue: PendingSiteIssue = {
        agentUserKey: state.profile.userKey,
        agentUserId: state.profile.userId ?? null,
        agentName: state.profile.fullName,
        serialNo: state.profile.serialNo,
        reason,
        remark: remark.trim(),
        pausedAt: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        sites: prev.sites.map((site) =>
          site.id === siteId ? { ...site, status: 'pending', pendingIssue } : site,
        ),
        activity: [
          logEntry({
            eventType: 'status_change',
            actorUsername: prev.profile?.userKey || 'agent',
            actorFullName: prev.profile?.fullName,
            actorRole: 'agent',
            siteId: target.id,
            siteCode: target.siteCode,
            siteName: target.clientName,
            district: target.district,
            previousStatus: 'in_progress',
            newStatus: 'pending',
            description: `Paused ${target.siteCode}: ${reason} — ${remark.trim()}`,
          }),
          ...prev.activity,
        ],
      }));
      return {
        ok: true,
        message: 'Site paused. Only you can resume it with “Issue resolved—resume”.',
      };
    },
    [state.profile, state.sites],
  );

  const toggleMilestone = useCallback(
    (siteId: string, milestoneId: MilestoneStep['id']) => {
      const stamp = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        sites: prev.sites.map((site) => {
          if (site.id !== siteId) return site;
          const milestones = site.milestones.map((milestone) =>
            milestone.id === milestoneId
              ? {
                  ...milestone,
                  completed: !milestone.completed,
                  completedAt: milestone.completed ? undefined : stamp,
                }
              : milestone,
          );
          return { ...site, milestones };
        }),
      }));
    },
    [],
  );

  const saveComputer = useCallback(
    (siteId: string, index: number, verification: HostnameVerificationResult): ActionResult => {
      const target = state.sites.find((site) => site.id === siteId);
      if (!target) return { ok: false, message: 'Installation site not found.' };
      if (target.status !== 'in_progress') {
        return { ok: false, message: 'Reserve the site before recording devices.' };
      }
      const stamp = new Date().toISOString();
      const nextVerifications: HostnameVerificationResult[] = Array.from(
        { length: Math.max(target.hostnameVerifications.length, target.computerCount, index + 1) },
        (_, slot) =>
          target.hostnameVerifications[slot] ?? {
            verified: false,
            hostname: '',
          },
      );
      nextVerifications[index] = {
        ...verification,
        verifiedAt: stamp,
        hardwareReportedAt: stamp,
        hardwareReportedBy: state.profile?.userKey,
      };
      const allVerified =
        nextVerifications.length >= target.computerCount &&
        nextVerifications.slice(0, target.computerCount).every((entry) => entry?.verified);

      setState((prev) => ({
        ...prev,
        sites: prev.sites.map((site) => {
          if (site.id !== siteId) return site;
          const milestones = site.milestones.some(
            (milestone) => milestone.id === 'hostname_verify' && milestone.completed,
          )
            ? site.milestones
            : site.milestones.map((milestone) =>
                allVerified &&
                (milestone.id === 'hostname_verify' || milestone.id === 'install') &&
                !milestone.completed
                  ? { ...milestone, completed: true, completedAt: stamp }
                  : milestone,
              );
          return {
            ...site,
            hostnameVerifications: nextVerifications,
            hostnameVerification: nextVerifications[0],
            milestones,
          };
        }),
      }));
      return {
        ok: true,
        message: allVerified
          ? 'All devices verified — hostname verification milestone complete.'
          : `Device ${index + 1} of ${target.computerCount} recorded.`,
      };
    },
    [state.profile?.userKey, state.sites],
  );

  const addDocument = useCallback(
    (siteId: string, document: UploadedDocument): ActionResult => {
      const stamp = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        sites: prev.sites.map((site) => {
          if (site.id !== siteId) return site;
          const documents = [...site.documents, document];
          const milestones = site.milestones.map((milestone) =>
            milestone.id === 'paperwork' && !milestone.completed
              ? { ...milestone, completed: true, completedAt: stamp }
              : milestone,
          );
          return { ...site, documents, milestones };
        }),
      }));
      return { ok: true, message: `${document.name} attached to the site record.` };
    },
    [],
  );

  const saveNotes = useCallback((siteId: string, notes: string) => {
    setState((prev) => ({
      ...prev,
      sites: prev.sites.map((site) => (site.id === siteId ? { ...site, notes } : site)),
    }));
  }, []);

  const completeSite = useCallback(
    (siteId: string): ActionResult => {
      const target = state.sites.find((site) => site.id === siteId);
      if (!target || !state.profile) return { ok: false, message: 'Site not found.' };
      const progress = calculateDeploymentProgress(target);
      if (!progress.canCompleteDeployment) {
        return { ok: false, message: progress.blockingReasons.join(' ') };
      }
      const stamp = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        sites: prev.sites.map((site) => {
          if (site.id !== siteId) return site;
          return {
            ...site,
            status: 'completed',
            completedAt: stamp,
            completedByUser: prev.profile?.userKey,
            pendingIssue: undefined,
            milestones: site.milestones.map((milestone) => ({
              ...milestone,
              completed: true,
              completedAt: milestone.completedAt || stamp,
            })),
            biometricCompletionSeal: {
              verified: true,
              verifiedByUser: prev.profile?.userKey || 'agent',
              verifiedByName: prev.profile?.fullName,
              verificationId: `SEAL-${site.siteCode}-${stamp.slice(11, 19).replace(/:/g, '')}`,
              matchScore: 98,
              verifiedAt: stamp,
              latitude: site.latitude,
              longitude: site.longitude,
              accuracyMeters: 14,
            },
          };
        }),
        activity: [
          logEntry({
            eventType: 'status_change',
            actorUsername: prev.profile?.userKey || 'agent',
            actorFullName: prev.profile?.fullName,
            actorRole: 'agent',
            verificationId: `SEAL-${target.siteCode}`,
            matchScore: 98,
            siteId: target.id,
            siteCode: target.siteCode,
            siteName: target.clientName,
            district: target.district,
            previousStatus: 'in_progress',
            newStatus: 'completed',
            description: `Completed ${target.siteCode} — biometric completion seal issued.`,
          }),
          ...prev.activity,
        ],
      }));
      return { ok: true, message: 'Installation completed and sealed. Great work.' };
    },
    [state.profile, state.sites],
  );

  const value: WorkspaceContextValue = {
    profile: state.profile,
    sites: state.sites,
    activity: state.activity,
    activeSite,
    nowMs,
    signIn,
    signOut,
    resetDemoData,
    updateProfile,
    reserveSite,
    resumeSite,
    pauseSite,
    toggleMilestone,
    saveComputer,
    addDocument,
    saveNotes,
    completeSite,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside <WorkspaceProvider>.');
  return context;
}

export { createDefaultMilestones };
