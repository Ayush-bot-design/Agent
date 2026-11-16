import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InstallationSite } from './deployment-logic';
import { getSiteReviewAction } from './site-selection';

const site: InstallationSite = {
  id: 'site-1',
  siteCode: 'UP-LKO-101',
  district: 'Lucknow',
  clientName: 'Test Office',
  facilityName: 'Installation Room',
  address: 'Hazratganj, Lucknow',
  zone: 'Lucknow Zone',
  contactPerson: 'Nodal Officer',
  contactPhone: '+91 90000 00000',
  softwarePackage: 'Tender Suite',
  expectedHostnamePrefix: 'UP-LKO',
  sampleValidHostname: 'UP-LKO01',
  slaWindow: 'Working days',
  status: 'available',
  computerCount: 2,
  milestones: [],
  hostnameVerifications: [],
  documents: [],
};

test('available sites offer reservation confirmation, not an automatic claim', () => {
  const action = getSiteReviewAction(site, 'agent');
  assert.equal(action.kind, 'reserve');
  assert.equal(action.label, 'Confirm & Reserve Site');
  assert.match(action.description, /reserved only after your identity is verified/);
});

test('an active reservation offers start-work confirmation without a second claim', () => {
  const reserved = { ...site, status: 'in_progress' as const, reservedByUser: 'Agent' };
  const action = getSiteReviewAction(reserved, 'agent', reserved);
  assert.equal(action.kind, 'start');
  assert.equal(action.label, 'Confirm & Start Work');
  assert.match(action.description, /already reserved to you/);
});

test('other technicians cannot reserve or start a reserved site', () => {
  const action = getSiteReviewAction(
    { ...site, status: 'in_progress', reservedByUser: 'other' },
    'agent',
  );
  assert.equal(action.kind, 'unavailable');
  assert.match(action.description, /@other/);
});

test('a technician must finish their active site before reserving another', () => {
  const active = {
    ...site,
    id: 'other-site',
    clientName: 'Active Office',
    status: 'in_progress' as const,
    reservedByUser: 'agent',
  };
  const action = getSiteReviewAction(site, 'agent', active);
  assert.equal(action.kind, 'unavailable');
  assert.match(action.description, /Active Office/);
});

test('completed work is read-only and never starts another biometric reservation', () => {
  const completed = { ...site, status: 'completed' as const, completedByUser: 'agent' };
  assert.equal(getSiteReviewAction(completed, 'agent').kind, 'view-completed');
  assert.equal(getSiteReviewAction(completed, 'other').kind, 'unavailable');
  assert.equal(
    getSiteReviewAction(
      {
        ...site,
        biometricCompletionSeal: {
          verified: true,
          verifiedByUser: 'other',
          verificationId: 'BIO-1',
          matchScore: 99,
          verifiedAt: '2026-11-12T10:00:00Z',
        },
      },
      'agent',
    ).kind,
    'unavailable',
  );
});

test('site coordinates do not affect review or reservation eligibility', () => {
  assert.equal(
    getSiteReviewAction({ ...site, latitude: undefined, longitude: undefined }, 'agent').kind,
    'reserve',
  );
  assert.equal(
    getSiteReviewAction({ ...site, latitude: 0, longitude: 0 }, 'agent').kind,
    'reserve',
  );
  assert.equal(
    getSiteReviewAction({ ...site, latitude: -20, longitude: -100 }, 'agent').kind,
    'reserve',
  );
});
