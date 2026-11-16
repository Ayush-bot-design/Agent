import { Badge, Card } from './ui';
import { Icon } from './icons';

const CODE_BLOCK =
  'mt-2 overflow-x-auto rounded-xl bg-slate-950 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-slate-100';

function Step({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
        {index}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <div className="mt-0.5 space-y-1 text-xs leading-relaxed text-slate-600">{children}</div>
      </div>
    </li>
  );
}

export function Deployment() {
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900">Deployment status</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              This build is a static Vite site. No server process, database or secret is required to run it.
            </p>
          </div>
          <Badge tone="emerald">
            <Icon name="check" className="h-3.5 w-3.5" />
            Buildable
          </Badge>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Runtime', 'Static site (dist/)'],
            ['Build', 'npm install && npm run build'],
            ['Data mode', 'Seeded demo + localStorage'],
            ['Backend', 'Optional Supabase'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-900/[0.05] ring-inset">
              <dt className="text-[10px] font-semibold tracking-[0.1em] text-slate-500 uppercase">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold tracking-tight text-slate-900">
          What the Render error was telling you
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          The deploy log ended with:
        </p>
        <pre className={CODE_BLOCK}>
{`npm error code ENOENT
npm error path /opt/render/project/src/package.json
npm error enoent Could not read package.json: Error: ENOENT:
no such file or directory, open '/opt/render/project/src/package.json'
==> Build failed 😞`}
        </pre>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Render checked the repository out into <code className="rounded bg-slate-100 px-1">/opt/render/project/src</code>{' '}
          and ran its default Node build command <code className="rounded bg-slate-100 px-1">npm install &amp;&amp; npm run build</code>.
          The repository contained only loose <code className="rounded bg-slate-100 px-1">.ts</code> /{' '}
          <code className="rounded bg-slate-100 px-1">.css</code> files uploaded through the GitHub web UI — no
          <code className="mx-1 rounded bg-slate-100 px-1">package.json</code>, no
          <code className="mx-1 rounded bg-slate-100 px-1">index.html</code>, no{' '}
          <code className="rounded bg-slate-100 px-1">src/</code> tree — so the very first command failed.
          The fix was to make the repository an actual project and keep every uploaded module under the path its
          imports expect.
        </p>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          {[
            ['package.json', 'Dependencies + dev/build/preview scripts'],
            ['index.html + src/main.tsx', 'Real entry point for the bundle'],
            ['src/utils, src/server, src/lib', 'Modules restored to their original paths'],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-xl bg-emerald-50/70 px-3 py-2 ring-1 ring-emerald-600/15 ring-inset">
              <p className="font-mono text-[11px] font-semibold text-emerald-800">{title}</p>
              <p className="mt-0.5 text-[11px] text-emerald-900/80">{detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Deploy on Render</h2>
          <ol className="mt-3 space-y-3">
            <Step index={1} title="Delete the failed service (or keep it and redeploy)">
              <p>
                The old service can be reused: pushing this commit is enough. Delete it only if you prefer a
                clean history.
              </p>
            </Step>
            <Step index={2} title="Create a Static Site">
              <p>
                Render → <strong>New +</strong> → <strong>Static Site</strong> → connect{' '}
                <code className="rounded bg-slate-100 px-1">Ayush-bot-design/Agent</code>.
              </p>
            </Step>
            <Step index={3} title="Fill the build settings">
              <p>
                Branch: <code className="rounded bg-slate-100 px-1">main</code> · Root Directory:{' '}
                <em>leave empty</em> · Build Command:{' '}
                <code className="rounded bg-slate-100 px-1">npm install &amp;&amp; npm run build</code> · Publish
                Directory: <code className="rounded bg-slate-100 px-1">dist</code>.
              </p>
            </Step>
            <Step index={4} title="Or use the Blueprint">
              <p>
                The repository ships <code className="rounded bg-slate-100 px-1">render.yaml</code>, so{' '}
                <strong>New +</strong> → <strong>Blueprint</strong> configures all of the above automatically.
              </p>
            </Step>
          </ol>
          <pre className={CODE_BLOCK}>
{`# local checks
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
npm run preview  # serve dist/ locally`}
          </pre>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Connecting Supabase later</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            The Supabase project already holds the production schema (<code className="rounded bg-slate-100 px-1">sites</code>,{' '}
            <code className="rounded bg-slate-100 px-1">profiles</code>,{' '}
            <code className="rounded bg-slate-100 px-1">activity_logs</code>,{' '}
            <code className="rounded bg-slate-100 px-1">verified_hostnames</code>,{' '}
            <code className="rounded bg-slate-100 px-1">face_templates</code>) and every field of{' '}
            <code className="rounded bg-slate-100 px-1">InstallationSite</code> maps 1:1 onto a column. To go live:
          </p>
          <ol className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600">
            <li>1. Add the env vars in Render → Environment (or in a local <code>.env</code>):</li>
          </ol>
          <pre className={CODE_BLOCK}>
{`VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable anon key>
VITE_DATA_MODE=supabase`}
          </pre>
          <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-600">
            <li>
              · <strong>Not wired in this build yet.</strong> The console runs on the seeded worklist until a data
              adapter replaces <code className="rounded bg-slate-100 px-1">src/lib/workspace-store.tsx</code>.
            </li>
            <li>
              · The uploaded server modules (<code className="rounded bg-slate-100 px-1">src/server/*</code>) were
              captured without <code className="rounded bg-slate-100 px-1">server.ts</code>,{' '}
              <code className="rounded bg-slate-100 px-1">src/lib/supabase.ts</code>,{' '}
              <code className="rounded bg-slate-100 px-1">src/lib/private-cache.ts</code> and the Express route
              handlers, so they are not part of the bundle.
            </li>
            <li>
              · Browser access also needs the Supabase RLS policies for agent self-service, plus Storage buckets for
              certificates and face snapshots.
            </li>
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-bold tracking-tight text-slate-900">Repository layout</h2>
        <pre className={CODE_BLOCK}>
{`index.html            Vite entry
render.yaml           Render Blueprint (static site)
src/main.tsx          React bootstrap
src/App.tsx           Tab shell
src/components/       Dashboard, workspace wizard, profile, reports
src/lib/              Local store, seed data, flash + download helpers
src/utils/            Domain logic (reservation, hostname, CSV, reporting)
src/server/           Supabase/Express modules kept for the server build
src/styles/           Glass design system + agent panels
public/               PWA icons + manifest
docs/                 Import notes, security spec, original AI Studio screenshot`}
        </pre>
        <p className="mt-2 text-xs text-slate-500">
          <code className="rounded bg-slate-100 px-1">npm run typecheck</code> covers the front-end; the legacy
          server tests are excluded because their missing modules were never uploaded.
        </p>
      </Card>
    </div>
  );
}
