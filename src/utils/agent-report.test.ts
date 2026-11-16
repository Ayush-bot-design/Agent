import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityLogEntry, InstallationSite } from './deployment-logic';
import {
  AGENT_REPORT_MAX_DAYS,
  addDaysIsoDate,
  buildAgentReport,
  buildMonthGrid,
  formatDurationMinutes,
  formatIstClock,
  istDateKey,
  istMinutesOfDay,
  validateAgentReportRange,
} from './agent-report';

const attendance = (
  overrides: Partial<ActivityLogEntry> & { createdAt: string; actorUsername: string },
): ActivityLogEntry => ({
  id: `log-${Math.random().toString(36).slice(2)}`,
  eventType: 'attendance',
  description: 'Biometric Check-In Verified',
  newStatus: 'on_duty',
  ...overrides,
});

const site = (overrides: Partial<InstallationSite>): InstallationSite =>
  ({
    id: 'site-1',
    siteCode: 'UP-LKO-0001',
    clientName: 'Records Office',
    district: 'Lucknow',
    status: 'completed',
    computerCount: 1,
    hostnameVerifications: [],
    documents: [],
    milestones: [],
    ...overrides,
  }) as InstallationSite;

test('attendance days are IST calendar days, not UTC days', () => {
  assert.equal(istDateKey('2026-11-01T18:29:00.000Z'), '2026-11-01'); // 23:59 IST
  assert.equal(istDateKey('2026-11-01T18:31:00.000Z'), '2026-11-02'); // 00:01 IST
  assert.equal(istMinutesOfDay('2026-11-02T03:40:00.000Z'), 9 * 60 + 10);
  assert.equal(formatIstClock('2026-11-02T03:40:00.000Z'), '09:10');
  assert.equal(formatIstClock(null), '—');
  assert.equal(formatDurationMinutes(580), '9h 40m');
  assert.equal(formatDurationMinutes(45), '45m');
  assert.equal(formatDurationMinutes(120), '2h');
  assert.equal(formatDurationMinutes(null), '—');
});

test('a duty session pairs check-in with the next off-duty event and totals the day', () => {
  const report = buildAgentReport({
    username: '@Ravi_Captain',
    from: '2026-11-01',
    to: '2026-11-30',
    logs: [
      attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-02T03:40:00.000Z' }),
      attendance({
        actorUsername: 'ravi_captain',
        createdAt: '2026-11-02T13:22:00.000Z',
        newStatus: 'off_duty',
        description: 'signed Off Duty',
      }),
      // 2026-11-02T15:10Z is already 20:40 IST on the same IST day.
      attendance({
        actorUsername: 'Ravi_Captain',
        createdAt: '2026-11-02T15:10:00.000Z',
        matchScore: 97.5,
        verificationId: 'BIO-2',
      }),
    ],
    sites: [],
  });

  assert.equal(report.timezone, 'IST');
  assert.equal(report.days.length, 1);
  const day = report.days[0];
  assert.equal(day.date, '2026-11-02');
  assert.equal(day.checkIns, 2);
  assert.equal(day.checkInAt, '2026-11-02T03:40:00.000Z');
  assert.equal(day.checkOutAt, '2026-11-02T13:22:00.000Z');
  assert.equal(day.minutesOnDuty, 582); // 09:10 → 18:52 IST
  assert.equal(day.openSession, true);
  assert.equal(day.events[2].matchScore, 97.5);
  assert.equal(report.totals.daysPresent, 1);
  assert.equal(report.totals.checkIns, 2);
  assert.equal(report.totals.minutesOnDuty, 582);
  assert.equal(report.totals.averageCheckInMinutes, 9 * 60 + 10);
});

test('other technicians, other event types and out-of-range days never leak into the report', () => {
  const report = buildAgentReport({
    username: 'ravi_captain',
    from: '2026-11-05',
    to: '2026-11-06',
    logs: [
      attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-04T04:00:00.000Z' }), // before
      attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-07T04:00:00.000Z' }), // after
      attendance({ actorUsername: 'sunita_field', createdAt: '2026-11-05T04:00:00.000Z' }),
      {
        ...attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-05T05:00:00.000Z' }),
        eventType: 'login',
      },
      attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-05T04:30:00.000Z' }),
    ],
    sites: [],
  });

  assert.deepEqual(
    report.days.map((day) => day.date),
    ['2026-11-05'],
  );
  assert.equal(report.totals.checkIns, 1);
  assert.equal(report.totals.minutesOnDuty, 0);
  assert.equal(report.days[0].openSession, true);
});

test('completed sites count only for the selected technician inside the inclusive IST range', () => {
  const report = buildAgentReport({
    username: 'ravi_captain',
    from: '2026-11-02',
    to: '2026-11-03',
    logs: [],
    sites: [
      site({
        id: 'a',
        siteCode: 'UP-1',
        completedByUser: 'ravi_captain',
        completedAt: '2026-11-01T18:29:00.000Z',
      }), // 2026-11-01 IST
      site({
        id: 'b',
        siteCode: 'UP-2',
        completedByUser: 'Ravi_Captain',
        completedAt: '2026-11-01T18:31:00.000Z',
      }), // 2026-11-02 IST
      site({
        id: 'c',
        siteCode: 'UP-3',
        completedByUser: 'ravi_captain',
        completedAt: '2026-11-03T17:00:00.000Z',
      }),
      site({
        id: 'd',
        siteCode: 'UP-4',
        completedByUser: 'ravi_captain',
        completedAt: '2026-11-04T04:00:00.000Z',
      }),
      site({
        id: 'e',
        siteCode: 'UP-5',
        completedByUser: 'sunita_field',
        completedAt: '2026-11-02T05:00:00.000Z',
      }),
      site({ id: 'f', siteCode: 'UP-6', completedByUser: 'ravi_captain' }), // never completed
    ],
  });

  assert.deepEqual(
    report.completedSites.map((entry) => entry.siteCode),
    ['UP-2', 'UP-3'],
  );
  assert.deepEqual(report.completedByDay, { '2026-11-02': 1, '2026-11-03': 1 });
  assert.equal(report.totals.sitesCompleted, 2);
  assert.equal(report.totals.daysWithCompletedSites, 2);
  assert.equal(report.totals.daysPresent, 0);
  assert.equal(report.totals.averageCheckInMinutes, null);
});

test('range validation rejects bad formats, inverted ranges and oversized windows', () => {
  assert.deepEqual(validateAgentReportRange('2026-11-01', '2026-11-30'), {
    ok: true,
    from: '2026-11-01',
    to: '2026-11-30',
  });
  assert.equal(validateAgentReportRange('2026-11-31', '2026-12-01').ok, false);
  assert.equal(validateAgentReportRange('', '2026-12-01').ok, false);
  assert.equal(validateAgentReportRange('2026-12-02', '2026-12-01').ok, false);
  const tooLong = validateAgentReportRange(
    '2026-01-01',
    addDaysIsoDate('2026-01-01', AGENT_REPORT_MAX_DAYS),
  );
  assert.equal(tooLong.ok, false);
  assert.equal(
    validateAgentReportRange('2026-01-01', addDaysIsoDate('2026-01-01', AGENT_REPORT_MAX_DAYS - 1))
      .ok,
    true,
  );
});

test('month grid is Monday-first, padded to full weeks and marks today', () => {
  const grid = buildMonthGrid('2026-11', '2026-11-15');
  assert.equal(grid.monthStart, '2026-11-01');
  assert.equal(grid.monthEnd, '2026-11-30');
  assert.equal(grid.cells.length, 42);
  assert.equal(grid.cells[0].date, '2026-10-26'); // Monday before 1 Nov (Sunday)
  assert.equal(grid.cells[0].inMonth, false);
  assert.equal(grid.cells[6].date, '2026-11-01');
  assert.equal(grid.cells[6].inMonth, true);
  assert.equal(grid.cells[20].date, '2026-11-15');
  assert.equal(grid.cells[20].isToday, true);
  assert.equal(grid.cells.filter((cell) => cell.inMonth).length, 30);
});

test('re-verifications inside a shift stay one duty session instead of extra check-ins', () => {
  const report = buildAgentReport({
    username: 'ravi_captain',
    from: '2026-11-02',
    to: '2026-11-02',
    logs: [
      attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-02T03:30:00.000Z' }),
      // 20 seconds later: a UI race, not a real sign-out.
      attendance({
        actorUsername: 'ravi_captain',
        createdAt: '2026-11-02T03:30:20.000Z',
        newStatus: 'off_duty',
      }),
      // Re-verifying for a site action must not open a second shift.
      attendance({
        actorUsername: 'ravi_captain',
        createdAt: '2026-11-02T04:10:00.000Z',
        verificationId: 'BIO-2',
        matchScore: 97.2,
      }),
      attendance({
        actorUsername: 'ravi_captain',
        createdAt: '2026-11-02T12:30:00.000Z',
        newStatus: 'off_duty',
      }),
    ],
    sites: [],
  });

  const day = report.days[0];
  assert.equal(day.sessions.length, 1);
  assert.equal(day.sessions[0].verifications, 2);
  assert.equal(day.sessions[0].start, '2026-11-02T03:30:00.000Z');
  assert.equal(day.sessions[0].end, '2026-11-02T12:30:00.000Z');
  assert.equal(day.sessions[0].minutes, 540);
  assert.equal(day.sessions[0].verificationId, 'BIO-2');
  assert.equal(day.minutesOnDuty, 540);
  assert.equal(day.checkInAt, '2026-11-02T03:30:00.000Z');
  assert.equal(day.checkOutAt, '2026-11-02T12:30:00.000Z');
  assert.equal(day.openSession, false);
  // The raw biometric log still counts both proofs for the disclosure.
  assert.equal(day.checkIns, 2);
  assert.equal(day.events.length, 4);
  assert.equal(report.totals.checkIns, 2);
  assert.equal(report.totals.minutesOnDuty, 540);
});

test('a sign-off with nothing open is ignored and two real shifts in a day are summed', () => {
  const report = buildAgentReport({
    username: 'ravi_captain',
    from: '2026-11-03',
    to: '2026-11-03',
    logs: [
      // Early off-duty that closes yesterday's shift: it must not become today's sign-out.
      attendance({
        actorUsername: 'ravi_captain',
        createdAt: '2026-11-03T02:00:00.000Z',
        newStatus: 'off_duty',
      }),
      attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-03T03:30:00.000Z' }),
      attendance({
        actorUsername: 'ravi_captain',
        createdAt: '2026-11-03T07:30:00.000Z',
        newStatus: 'off_duty',
      }),
      attendance({ actorUsername: 'ravi_captain', createdAt: '2026-11-03T09:30:00.000Z' }),
      attendance({
        actorUsername: 'ravi_captain',
        createdAt: '2026-11-03T13:30:00.000Z',
        newStatus: 'off_duty',
      }),
    ],
    sites: [],
  });

  const day = report.days[0];
  assert.equal(day.sessions.length, 2);
  assert.deepEqual(
    day.sessions.map((session) => session.minutes),
    [240, 240],
  );
  assert.equal(day.minutesOnDuty, 480);
  assert.equal(day.checkOutAt, '2026-11-03T13:30:00.000Z');
  assert.equal(day.checkInAt, '2026-11-03T03:30:00.000Z');
  assert.equal(day.openSession, false);
  assert.equal(report.totals.minutesOnDuty, 480);
});
