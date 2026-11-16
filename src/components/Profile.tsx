import { useEffect, useMemo, useState } from 'react';
import {
  generateSitesCsvReport,
  normalizeUserKey,
  UP_DISTRICTS,
  type UserProfile,
} from '../utils/deployment-logic';
import { completedSiteDetails } from '../utils/completed-site-details';
import { useWorkspace } from '../lib/workspace-store';
import { useFlash } from '../lib/flash';
import { downloadTextFile, istDateStamp } from '../lib/download';
import { Badge, Button, Card, DataRow, Field, SelectInput, StatTile, TextInput, TextArea } from './ui';
import { Icon } from './icons';

const PROOF_TYPES: UserProfile['legalProofType'][] = [
  'Aadhaar',
  'PAN Card',
  'Voter ID',
  'Driving License',
  'Govt Tech ID',
];

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
});

export function Profile() {
  const { profile, sites, updateProfile, resetDemoData, signOut } = useWorkspace();
  const { flash } = useFlash();
  const [draft, setDraft] = useState<Partial<UserProfile>>({});

  useEffect(() => {
    setDraft({});
  }, [profile?.id]);

  const userKey = normalizeUserKey(profile?.userKey || '');
  const mine = useMemo(
    () =>
      sites.filter(
        (site) => site.status === 'completed' && normalizeUserKey(site.completedByUser || '') === userKey,
      ),
    [sites, userKey],
  );

  if (!profile) return null;

  const merged: UserProfile = { ...profile, ...draft };
  const devicesInstalled = mine.reduce((sum, site) => sum + site.computerCount, 0);
  const districtsCovered = new Set(mine.map((site) => site.district)).size;

  const update = (patch: Partial<UserProfile>) => setDraft((current) => ({ ...current, ...patch }));

  const save = () => {
    if (!merged.fullName.trim()) {
      flash('Full name cannot be empty.', 'error');
      return;
    }
    if (!/^[0-9+\s-]{6,20}$/.test(merged.phone.trim())) {
      flash('Enter a valid phone number.', 'error');
      return;
    }
    updateProfile({
      fullName: merged.fullName.trim(),
      phone: merged.phone.trim(),
      alternatePhone: merged.alternatePhone?.trim(),
      address: merged.address.trim(),
      operatingZone: merged.operatingZone,
      legalProofType: merged.legalProofType,
      legalProofNumber: merged.legalProofNumber.trim(),
      onDuty: merged.onDuty,
    });
    setDraft({});
    flash('Profile updated.', 'success');
  };

  const exportMine = () => {
    if (mine.length === 0) {
      flash('You have no completed sites to export yet.', 'error');
      return;
    }
    downloadTextFile(`agent-${userKey}-${istDateStamp()}.csv`, generateSitesCsvReport(mine));
    flash(`Exported ${mine.length} completed site(s) to CSV.`, 'success');
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Serial" value={<span className="text-base">{profile.serialNo || '—'}</span>} hint="Assigned by registry" />
        <StatTile label="Completed" value={mine.length} hint="Sites sealed" tone="emerald" />
        <StatTile label="Devices" value={devicesInstalled} hint="Installed by you" tone="indigo" />
        <StatTile label="Districts" value={districtsCovered} hint="Coverage" tone="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold tracking-tight text-slate-900">Agent profile</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Identity fields are isolated per user; only the registry can change your serial number.
              </p>
            </div>
            <Badge tone={merged.onDuty ? 'emerald' : 'slate'}>{merged.onDuty ? 'On duty' : 'Off duty'}</Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <TextInput value={merged.fullName} onChange={(event) => update({ fullName: event.target.value })} />
            </Field>
            <Field label="Username (user key)" hint="Derived from your sign-in identity">
              <TextInput value={merged.username} readOnly disabled />
            </Field>
            <Field label="Employee ID">
              <TextInput value={merged.employeeId} readOnly disabled />
            </Field>
            <Field label="Department">
              <TextInput value={merged.department} readOnly disabled />
            </Field>
            <Field label="Phone">
              <TextInput value={merged.phone} onChange={(event) => update({ phone: event.target.value })} placeholder="+91 90000 00000" />
            </Field>
            <Field label="Alternate phone">
              <TextInput
                value={merged.alternatePhone || ''}
                onChange={(event) => update({ alternatePhone: event.target.value })}
                placeholder="Optional"
              />
            </Field>
            <Field label="Operating zone">
              <SelectInput
                value={merged.operatingZone}
                onChange={(event) => update({ operatingZone: event.target.value })}
              >
                <option value="">Select a district…</option>
                {UP_DISTRICTS.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Legal proof type">
              <SelectInput
                value={merged.legalProofType}
                onChange={(event) => update({ legalProofType: event.target.value as UserProfile['legalProofType'] })}
              >
                {PROOF_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Legal proof number">
              <TextInput
                value={merged.legalProofNumber}
                onChange={(event) => update({ legalProofNumber: event.target.value })}
                placeholder="XXXX XXXX 1234"
              />
            </Field>
            <Field label="Email">
              <TextInput value={merged.email} readOnly disabled />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <TextArea
                value={merged.address}
                onChange={(event) => update({ address: event.target.value })}
                placeholder="Street, city, PIN"
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={merged.onDuty}
                onChange={(event) => update({ onDuty: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              Available for dispatch
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0}>
                Reset changes
              </Button>
              <Button onClick={save} disabled={Object.keys(draft).length === 0}>
                Save profile
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-bold tracking-tight text-slate-900">Your completed work</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Only sites sealed under your user key appear here.
            </p>
            <ul className="mt-3 space-y-2">
              {mine.length === 0 ? (
                <li className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                  No completed installations yet.
                </li>
              ) : (
                mine.map((site) => {
                  const details = completedSiteDetails(site);
                  return (
                    <li key={site.id} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-900/[0.06] ring-inset">
                      <p className="text-sm font-semibold text-slate-800">{site.clientName}</p>
                      <p className="text-[11px] text-slate-500">
                        {site.district} · {site.computerCount} devices ·{' '}
                        {site.completedAt ? DATE_FORMAT.format(new Date(site.completedAt)) : '—'}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">{details.hostname}</p>
                    </li>
                  );
                })
              )}
            </ul>
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={exportMine}>
              <Icon name="download" />
              Export my CSV
            </Button>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold tracking-tight text-slate-900">Session</h2>
            <dl className="mt-2 divide-y divide-slate-100">
              <DataRow label="Signed in as" value={`@${profile.userKey}`} />
              <DataRow label="Last verified" value={profile.lastVerifiedAt ? DATE_FORMAT.format(new Date(profile.lastVerifiedAt)) : '—'} />
              <DataRow label="Face match" value={profile.lastMatchScore ? `${profile.lastMatchScore}%` : '—'} />
              <DataRow label="Storage" value="Browser (localStorage)" />
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={resetDemoData}>
                <Icon name="reset" />
                Reset demo data
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <Icon name="logout" />
                Sign out
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              Resetting restores the seeded worklist. Your profile and activity history stay intact.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
