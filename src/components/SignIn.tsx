import { useState } from 'react';
import { UP_DISTRICTS } from '../utils/deployment-logic';
import { useWorkspace } from '../lib/workspace-store';
import { Alert, Button, Card, Field, SelectInput, TextInput } from './ui';

const PRESETS = [
  { name: 'Ayush Srivastava', zone: 'Lucknow', email: 'ayush@aether.local' },
  { name: 'Ravi Pratap Singh', zone: 'Kanpur Nagar', email: 'ravi@aether.local' },
  { name: 'Neha Verma', zone: 'Varanasi', email: 'neha@aether.local' },
];

export function SignIn() {
  const { signIn } = useWorkspace();
  const [name, setName] = useState('Ayush Srivastava');
  const [email, setEmail] = useState('ayush@aether.local');
  const [zone, setZone] = useState('Lucknow');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 3) {
      setError('Enter your full name (at least 3 characters).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    signIn({ name: name.trim(), email: email.trim(), zone });
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-10 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/[0.06] px-3 py-1 text-[11px] font-semibold tracking-[0.1em] text-slate-600 uppercase">
            Uttar Pradesh · Tender deployment
          </div>
          <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.03em] text-slate-900 sm:text-5xl">
            Field agent console for
            <span className="block bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-600 bg-clip-text text-transparent">
              software rollout tracking
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-600">
            Reserve one district site at a time, capture every workstation, verify hostnames against the
            central registry and close the job with signed paperwork. The 24-hour reservation rule,
            per-user isolation and completion gates are enforced by the same domain logic that runs in
            production.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ['75', 'UP districts'],
              ['1 active', 'site per agent'],
              ['24 h', 'reservation window'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl bg-white/70 px-3.5 py-3 ring-1 ring-slate-900/[0.06]">
                <dt className="text-lg font-bold text-slate-900">{value}</dt>
                <dd className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Card className="p-5 sm:p-6">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Sign in to your workspace</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter the identity you use on site. This demo stores everything in your browser — no
            Supabase keys are required to explore the workflow.
          </p>
          <form className="mt-5 space-y-3.5" onSubmit={submit}>
            <Field label="Full name">
              <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ayush Srivastava"
                autoComplete="name"
              />
            </Field>
            <Field label="Work email" hint="Used to derive your user key, e.g. ayush@aether.local → @ayush">
              <TextInput
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ayush@aether.local"
                autoComplete="email"
              />
            </Field>
            <Field label="Operating zone">
              <SelectInput value={zone} onChange={(event) => setZone(event.target.value)}>
                {UP_DISTRICTS.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Button type="submit" size="lg" className="w-full">
              Enter deployment console
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => {
                  setName(preset.name);
                  setEmail(preset.email);
                  setZone(preset.zone);
                }}
                className="rounded-full bg-slate-900/[0.05] px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-900/10"
              >
                Use {preset.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </Card>
      </div>
      <p className="mt-10 text-center text-xs text-slate-500">
        Demo build · identity checks, photos and server attestation are simulated. Wire Supabase to run
        against live data.
      </p>
    </div>
  );
}
