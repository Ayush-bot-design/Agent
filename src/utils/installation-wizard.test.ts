import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computerDraftError,
  computerStepError,
  computerSteps,
  createComputerDraft,
  firstPendingComputer,
  savedComputer,
} from './installation-wizard';
import type { InstallationSite } from './deployment-logic';
const site = {
  computerCount: 3,
  hostnameVerifications: [{ verified: true, hostname: 'PC01' }],
  domainComputerIndices: [2],
} as InstallationSite;

test('resumes the first pending slot, including missing array entries and legacy single-computer records', () => {
  assert.equal(firstPendingComputer(site), 1);
  assert.equal(firstPendingComputer({ ...site, computerCount: 1 }), -1);
  assert.equal(
    firstPendingComputer({
      computerCount: 1,
      hostnameVerification: { verified: true, hostname: 'OLD' },
    } as InstallationSite),
    -1,
  );
  assert.equal(savedComputer(site, 0)?.hostname, 'PC01');
});
test('domain slots default to the exception branch and saved evidence hydrates the review', () => {
  assert.equal(createComputerDraft(site, 2).reason, 'domain_pc');
  assert.equal(createComputerDraft(site, 2).mode, 'excuse');
  const old = {
    ...site,
    hostnameVerifications: [
      {
        verified: true,
        hostname: 'PC01',
        ramGB: 8,
        windowsVersion: 'Windows 11',
        systemArchitecture: 'x64',
        workstationProofPhoto: 'photo',
      },
    ],
  } as InstallationSite;
  assert.equal(createComputerDraft(old, 0).ramGB, '8');
  assert.equal(createComputerDraft(old, 0).photo, 'photo');
});
test('standard flow requires complete hardware, hostname and live evidence', () => {
  const draft = createComputerDraft(site, 1);
  assert.deepEqual(computerSteps('standard'), ['result', 'details', 'hostname', 'photo', 'review']);
  assert.match(computerStepError('details', draft)!, /RAM/);
  const complete = {
    ...draft,
    ramGB: '8',
    windowsVersion: 'Windows 11 24H2',
    systemArchitecture: 'x64' as const,
    hostname: 'OFFICE01',
    photo: 'live-photo',
  };
  assert.equal(computerDraftError(complete), null);
  for (const ramGB of ['0', '-1', 'Infinity', '4097', ''])
    assert.ok(computerDraftError({ ...complete, ramGB }));
  assert.ok(computerDraftError({ ...complete, hostname: '  ' }));
  assert.ok(computerDraftError({ ...complete, photo: '' }));
});
test('exception flow skips hardware and hostname but requires a reason, live evidence and five words for Other', () => {
  const draft = {
    ...createComputerDraft(site, 1),
    mode: 'excuse' as const,
    reason: 'pc_unavailable' as const,
    photo: 'live-photo',
  };
  assert.deepEqual(computerSteps('excuse'), ['result', 'reason', 'photo', 'review']);
  assert.equal(computerDraftError(draft), null);
  assert.ok(computerDraftError({ ...draft, reason: '' }));
  assert.ok(computerDraftError({ ...draft, photo: '' }));
  assert.ok(computerDraftError({ ...draft, reason: 'other', description: 'Too short' }));
  assert.equal(
    computerDraftError({
      ...draft,
      reason: 'other',
      description: 'The workstation power supply is broken',
    }),
    null,
  );
});
