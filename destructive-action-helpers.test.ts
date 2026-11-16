import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDestructiveUserDeleteWarning,
  getDestructiveSiteDeleteWarning,
  getDestructiveBulkSiteDeleteWarning,
  getDestructiveReleaseWarning,
  getDestructiveDocumentRemoveWarning,
} from './destructive-action-helpers';
import { InstallationSite, createDefaultMilestones } from './deployment-logic';

/**
 * Minimal local fixture. There is no seeded site list in the app — site data
 * comes exclusively from Supabase — so tests build their own objects.
 */
function makeSite(overrides: Partial<InstallationSite> = {}): InstallationSite {
  return {
    id: 'site-fixture',
    siteCode: 'UP-LKO-100',
    district: 'Lucknow',
    clientName: 'Fixture Site',
    facilityName: 'Fixture Facility',
    address: 'Lucknow, Uttar Pradesh',
    zone: 'Lucknow',
    contactPerson: 'Site Contact',
    contactPhone: '9000000000',
    softwarePackage: 'UP Tender Suite',
    expectedHostnamePrefix: 'UP-NODE',
    sampleValidHostname: 'UP-NODE01.UP.GOV.LOCAL',
    slaWindow: '24h',
    status: 'available',
    milestones: createDefaultMilestones(),
    computerCount: 1,
    hostnameVerifications: [],
    documents: [],
    ...overrides,
  };
}

describe('Destructive Action Warnings & Impact Evaluator', () => {
  it('detects when deleting a user has active site reservations', () => {
    const mockSites: InstallationSite[] = [
      makeSite({
        id: 'site-1',
        siteCode: 'UP-LKO-101',
        clientName: 'Lucknow Collectorate',
        status: 'in_progress',
        reservedByUser: 'ayush',
      }),
    ];

    const warning = getDestructiveUserDeleteWarning(
      {
        id: 'usr-1',
        username: 'ayush',
        email: 'ayush@aether.local',
        serialNo: 'SN-UP-1001',
      },
      mockSites,
    );

    assert.equal(warning.title, 'Delete User Account');
    assert.equal(warning.severity, 'critical');
    assert.match(warning.impacts[0], /User currently holds active reservation on 1 site/);
    assert.match(warning.confirmButtonLabel, /Delete User Account/);
  });

  it('marks safe warning severity when user has no active reservations', () => {
    const warning = getDestructiveUserDeleteWarning(
      {
        id: 'usr-2',
        username: 'new_technician',
        email: 'new_technician@aether.local',
        serialNo: 'SN-UP-1006',
      },
      [],
    );

    assert.equal(warning.title, 'Delete User Account');
    assert.equal(warning.severity, 'warning');
    assert.equal(warning.itemIdentifier, '@new_technician (SN-UP-1006)');
  });

  it('generates site deletion warnings with reserved agent notification', () => {
    const site: InstallationSite = makeSite({
      siteCode: 'UP-VNS-201',
      clientName: 'Varanasi District Hospital',
      status: 'in_progress',
      reservedByUser: 'ravi_captain',
    });

    const warning = getDestructiveSiteDeleteWarning(site);
    assert.equal(warning.title, 'Delete Installation Site');
    assert.equal(warning.severity, 'critical');
    assert.match(warning.impacts[0], /currently reserved by field agent @ravi_captain/);
  });

  it('summarises a bulk site deletion and escalates when live work is included', () => {
    const available = [
      makeSite({
        siteCode: 'UP-AGR-401',
        clientName: 'Agra Office',
        district: 'Agra',
        status: 'available',
      }),
      makeSite({
        siteCode: 'UP-AGR-402',
        clientName: 'Agra Annex',
        district: 'Agra',
        status: 'available',
      }),
    ];
    const plain = getDestructiveBulkSiteDeleteWarning(available);
    assert.equal(plain.title, 'Delete 2 Installation Sites');
    assert.equal(plain.severity, 'warning');
    assert.equal(plain.itemIdentifier, '2 selected sites');
    assert.equal(plain.badgeLabel, 'Agra');
    assert.equal(plain.confirmButtonLabel, 'Delete 2 Sites');
    assert.match(
      plain.summary,
      /Permanently delete 2 selected installation sites from the database\?/,
    );
    assert.match(plain.impacts[0], /permanently removed from the Uttar Pradesh directory/);
    assert.match(plain.impacts.at(-1)!, /cannot be undone/);

    const mixed = getDestructiveBulkSiteDeleteWarning([
      ...available,
      makeSite({
        siteCode: 'UP-LKO-403',
        clientName: 'Lucknow Office',
        district: 'Lucknow',
        status: 'in_progress',
        reservedByUser: 'ravi_captain',
      }),
      makeSite({
        siteCode: 'UP-LKO-404',
        clientName: 'Lucknow Annex',
        district: 'Lucknow',
        status: 'completed',
      }),
    ]);
    assert.equal(mixed.severity, 'critical');
    assert.equal(mixed.badgeLabel, '2 districts');
    assert.match(
      mixed.impacts[0],
      /1 selected site is in progress — @ravi_captain's installation will be terminated/,
    );
    assert.match(mixed.impacts[1], /1 selected site is completed/);
  });

  it('evaluates release reservation warning impacts', () => {
    const site: InstallationSite = makeSite({
      siteCode: 'UP-AYO-301',
      clientName: 'Ayodhya Command Center',
      status: 'in_progress',
      reservedByUser: 'ayush',
    });

    const warning = getDestructiveReleaseWarning(site);
    assert.equal(warning.title, 'Release Site Reservation');
    assert.equal(warning.severity, 'caution');
    assert.match(warning.impacts[0], /returned to "Available" status/);
  });

  it('evaluates document remove warning impacts', () => {
    const warning = getDestructiveDocumentRemoveWarning('aadhaar_card_proof.pdf');
    assert.equal(warning.title, 'Remove Document');
    assert.equal(warning.severity, 'caution');
    assert.match(warning.summary, /aadhaar_card_proof.pdf/);
  });
});
