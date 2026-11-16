import type { ActivityLogEntry, InstallationSite } from './deployment-logic';
import { normalizeUserKey } from './deployment-logic';

/**
 * Attendance reporting is anchored to Indian Standard Time: the field teams work in
 * Uttar Pradesh and the duty day must not flip at 05:30 local time. India has no DST,
 * so a fixed offset keeps the calculation deterministic on both client and server.
 */
export const IST_OFFSET_MINUTES = 330;
export const IST_LABEL = 'IST';
/** Guardrail for the admin date picker: one call may cover up to a leap year. */
export const AGENT_REPORT_MAX_DAYS = 366;
/**
 * An off-duty event this soon after a check-in is a UI race (double tap, stale save), not a real
 * sign-out. The audit trail keeps the row; the report ignores it so the shift stays continuous.
 */
export const ATTENDANCE_FLAP_WINDOW_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

export type AgentAttendanceEventKind = 'check_in' | 'off_duty';

export interface AgentAttendanceEvent {
  kind: AgentAttendanceEventKind;
  at: string;
  verificationId?: string;
  matchScore?: number;
  latitude?: number;
  longitude?: number;
  description: string;
}

/** One continuous duty shift, opened by a check-in and closed by an off-duty event. */
export interface AgentDutySession {
  start: string;
  /** Null while the technician is still on duty. */
  end: string | null;
  /** Closed minutes; null while the shift is open. */
  minutes: number | null;
  /** Biometric proofs collected inside this shift (1 at check-in, +1 per re-verification). */
  verifications: number;
  verificationId?: string;
  matchScore?: number;
  latitude?: number;
  longitude?: number;
  open: boolean;
}

export interface AgentAttendanceDay {
  /** IST calendar day, `YYYY-MM-DD`. */
  date: string;
  /** First check-in of the day. */
  checkInAt: string | null;
  /** Last closed sign-out of the day. */
  checkOutAt: string | null;
  /** Raw check-in events (re-verifications included). */
  checkIns: number;
  /** Closed duty minutes started on this day; null when nothing is known. */
  minutesOnDuty: number | null;
  /** Still on duty with no off-duty event yet. */
  openSession: boolean;
  /** Duty shifts started on this day. */
  sessions: AgentDutySession[];
  /** Raw biometric log for the disclosure. */
  events: AgentAttendanceEvent[];
}

export interface AgentCompletedSite {
  id: string;
  siteCode: string;
  clientName: string;
  district: string;
  completedAt: string;
  /** IST calendar day, `YYYY-MM-DD`. */
  day: string;
}

export interface AgentReportTotals {
  daysPresent: number;
  checkIns: number;
  minutesOnDuty: number;
  /** Mean IST clock time of the first check-in, in minutes past midnight. */
  averageCheckInMinutes: number | null;
  sitesCompleted: number;
  daysWithCompletedSites: number;
}

export interface AgentReport {
  username: string;
  from: string;
  to: string;
  timezone: typeof IST_LABEL;
  days: AgentAttendanceDay[];
  totals: AgentReportTotals;
  completedSites: AgentCompletedSite[];
  completedByDay: Record<string, number>;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** IST calendar day for an instant. */
export function istDateKey(value: string | number | Date): string {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(value as string);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** IST clock time (minutes past midnight) for an instant. */
export function istMinutesOfDay(value: string | number | Date): number {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(value as string);
  if (!Number.isFinite(ms)) return 0;
  const shifted = new Date(ms + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** `HH:MM` in IST, for compact calendar/ledger labels. */
export function formatIstClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const minutes = istMinutesOfDay(iso);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** `9h 40m` style duration label. */
export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function isValidIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function addDaysIsoDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive day count of an `YYYY-MM-DD` range. */
export function inclusiveDayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Validation shared by the API and the admin date pickers. */
export function validateAgentReportRange(
  from: unknown,
  to: unknown,
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  if (!isValidIsoDate(from) || !isValidIsoDate(to))
    return { ok: false, error: 'Use valid dates in YYYY-MM-DD format for the range.' };
  if (from > to) return { ok: false, error: 'The start date must not be after the end date.' };
  const days = inclusiveDayCount(from, to);
  if (days > AGENT_REPORT_MAX_DAYS)
    return { ok: false, error: `Select a range of ${AGENT_REPORT_MAX_DAYS} days or fewer.` };
  return { ok: true, from, to };
}

const eventKind = (log: ActivityLogEntry): AgentAttendanceEventKind =>
  log.newStatus === 'off_duty' ? 'off_duty' : 'check_in';

const toEvent = (log: ActivityLogEntry): AgentAttendanceEvent => ({
  kind: eventKind(log),
  at: log.createdAt,
  verificationId: log.verificationId,
  matchScore: typeof log.matchScore === 'number' ? log.matchScore : undefined,
  latitude: typeof log.latitude === 'number' ? log.latitude : undefined,
  longitude: typeof log.longitude === 'number' ? log.longitude : undefined,
  description: log.description,
});

/**
 * Pure attendance/productivity report for one technician.
 *
 * Attendance is duty-driven: a check-in opens a duty session, the next off-duty closes it.
 * - Repeated biometric proofs inside an open session are re-verifications of the same shift.
 *   They are counted, never shown as extra check-ins.
 * - An off-duty event with no open session (a sign-off that already closed yesterday's shift)
 *   closes nothing and is ignored.
 * - An off-duty event less than `ATTENDANCE_FLAP_WINDOW_MS` after the check-in is treated as a
 *   UI race rather than a real sign-out: the session keeps running. The audit trail keeps the
 *   raw row; only this report ignores it.
 * - Completed-site counts come from sites whose `completedByUser` matches and whose
 *   `completedAt` falls inside the inclusive range.
 */
export function buildAgentReport(input: {
  username: string;
  from: string;
  to: string;
  logs: readonly ActivityLogEntry[];
  sites: readonly InstallationSite[];
}): AgentReport {
  const username = normalizeUserKey(input.username);
  const { from, to } = input;

  const attendanceLogs = input.logs
    .filter(
      (log) => log.eventType === 'attendance' && normalizeUserKey(log.actorUsername) === username,
    )
    .filter((log) => {
      const day = istDateKey(log.createdAt);
      return Boolean(day) && day >= from && day <= to;
    })
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const daysByDate = new Map<string, AgentAttendanceDay>();
  const dayFor = (date: string): AgentAttendanceDay => {
    const existing = daysByDate.get(date);
    if (existing) return existing;
    const created: AgentAttendanceDay = {
      date,
      checkInAt: null,
      checkOutAt: null,
      checkIns: 0,
      minutesOnDuty: null,
      openSession: false,
      sessions: [],
      events: [],
    };
    daysByDate.set(date, created);
    return created;
  };

  let openSession: AgentDutySession | null = null;
  let openSessionDay: AgentAttendanceDay | null = null;

  for (const log of attendanceLogs) {
    const dayKey = istDateKey(log.createdAt);
    const entry = dayFor(dayKey);
    const event = toEvent(log);
    entry.events.push(event);
    const at = Date.parse(log.createdAt);

    if (event.kind === 'check_in') {
      entry.checkIns += 1;
      if (openSession && openSessionDay) {
        // Same shift, another biometric proof: refresh the evidence, add no session.
        openSession.verifications += 1;
        openSession.verificationId = event.verificationId || openSession.verificationId;
        openSession.matchScore = event.matchScore ?? openSession.matchScore;
        openSession.latitude = event.latitude ?? openSession.latitude;
        openSession.longitude = event.longitude ?? openSession.longitude;
        continue;
      }
      const session: AgentDutySession = {
        start: log.createdAt,
        end: null,
        minutes: null,
        verifications: 1,
        verificationId: event.verificationId,
        matchScore: event.matchScore,
        latitude: event.latitude,
        longitude: event.longitude,
        open: true,
      };
      entry.sessions.push(session);
      if (!entry.checkInAt) entry.checkInAt = log.createdAt;
      openSession = session;
      openSessionDay = entry;
      continue;
    }

    if (!openSession || !openSessionDay) continue; // sign-off with nothing open: noise
    const sessionStart = Date.parse(openSession.start);
    if (!Number.isFinite(sessionStart) || at - sessionStart < ATTENDANCE_FLAP_WINDOW_MS) {
      // Too soon to be a real sign-out: keep the shift open and wait for the next off-duty.
      continue;
    }
    const minutes = Math.round((at - sessionStart) / 60_000);
    openSession.end = log.createdAt;
    openSession.minutes = minutes;
    openSession.open = false;
    openSessionDay.minutesOnDuty = (openSessionDay.minutesOnDuty || 0) + minutes;
    openSessionDay.openSession = false;
    entry.checkOutAt = log.createdAt;
    openSession = null;
    openSessionDay = null;
  }

  if (openSession && openSessionDay) openSessionDay.openSession = true;

  const days = [...daysByDate.values()]
    .filter((day) => day.events.length > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const presentDays = days.filter((day) => day.checkIns > 0);
  const checkInMinutes = presentDays
    .filter((day) => day.checkInAt)
    .map((day) => istMinutesOfDay(day.checkInAt as string));

  const completedSites = input.sites
    .filter((site) => normalizeUserKey(site.completedByUser || '') === username)
    .map((site) => ({ site, at: site.completedAt ? Date.parse(site.completedAt) : NaN }))
    .filter(({ at }) => Number.isFinite(at))
    .map(({ site, at }) => ({
      id: site.id,
      siteCode: site.siteCode,
      clientName: site.clientName,
      district: site.district,
      completedAt: site.completedAt as string,
      day: istDateKey(at),
    }))
    .filter((site) => site.day >= from && site.day <= to)
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));

  const completedByDay: Record<string, number> = {};
  for (const site of completedSites) completedByDay[site.day] = (completedByDay[site.day] || 0) + 1;

  return {
    username,
    from,
    to,
    timezone: IST_LABEL,
    days,
    totals: {
      daysPresent: presentDays.length,
      checkIns: days.reduce((sum, day) => sum + day.checkIns, 0),
      minutesOnDuty: days.reduce((sum, day) => sum + (day.minutesOnDuty || 0), 0),
      averageCheckInMinutes: checkInMinutes.length
        ? Math.round(checkInMinutes.reduce((sum, value) => sum + value, 0) / checkInMinutes.length)
        : null,
      sitesCompleted: completedSites.length,
      daysWithCompletedSites: Object.keys(completedByDay).length,
    },
    completedSites,
    completedByDay,
  };
}

/** Month grid (Monday first) for the attendance tab, including IST "today". */
export interface AttendanceCalendarCell {
  date: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
}

export function buildMonthGrid(
  monthCursor: string,
  todayIso: string,
): {
  monthStart: string;
  monthEnd: string;
  cells: AttendanceCalendarCell[];
} {
  const [year, month] = monthCursor.split('-').map((part) => Number(part));
  const monthStart = `${monthCursor}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${monthCursor}-${pad(daysInMonth)}`;
  const weekday = (new Date(`${monthStart}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const gridStart = addDaysIsoDate(monthStart, -weekday);
  const cellCount = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const cells: AttendanceCalendarCell[] = Array.from({ length: cellCount }, (_, index) => {
    const date = addDaysIsoDate(gridStart, index);
    return {
      date,
      dayNumber: Number(date.slice(8, 10)),
      inMonth: date.slice(0, 7) === monthCursor,
      isToday: date === todayIso,
    };
  });
  return { monthStart, monthEnd, cells };
}
