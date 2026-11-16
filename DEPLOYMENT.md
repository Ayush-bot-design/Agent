# Deploying this repo on Render

## TL;DR — what the error meant

Your Render deploy ended with:

```
npm error code ENOENT
npm error path /opt/render/project/src/package.json
npm error enoent Could not read package.json: Error: ENOENT:
no such file or directory, open '/opt/render/project/src/package.json'
==> Build failed 😞   (exit status 254)
```

Render cloned the repository, then ran its **default Node build command**:

```
npm install && npm run build
```

…inside `/opt/render/project/src` (that is the checkout directory — it is *not* a
`src` folder of your project). At that moment the repository had **no `package.json`**
at the root: it was a collection of loose `.ts` / `.css` files uploaded through the
GitHub web UI. `npm` therefore failed on the very first command, before any of your
code was read. Nothing was wrong with your code — there was simply no project to build.

The repository is now a real Vite + React + TypeScript project, so the same default
build works. You can redeploy as-is.

---

## Option A — Static Site (recommended, free)

1. In Render, open the failed service and press **Manual Deploy → Deploy latest commit**
   (or delete the service and create it again).
2. Settings:

   | Field | Value |
   | --- | --- |
   | Type | **Static Site** |
   | Repository | `Ayush-bot-design/Agent` |
   | Branch | `main` |
   | **Root Directory** | *leave empty* |
   | Build Command | `npm install && npm run build` |
   | Publish Directory | `dist` |

3. Save, deploy. Render builds `dist/` and serves it from its CDN.
4. Optional: add a rewrite `/* → /index.html` (Render adds it automatically for static
   sites in the UI; `render.yaml` in this repo already declares it).

> If your existing service is a **Web Service** (Node), either change it to a Static
> Site or set:
> **Build** `npm install && npm run build`, **Start** `npx vite preview --host 0.0.0.0 --port $PORT`
> — the static option is cheaper and faster.

## Option B — Blueprint

`render.yaml` is committed at the repository root. In Render choose
**New + → Blueprint → connect the repo** and it applies the static-site build,
publish directory, SPA rewrite and cache headers automatically.

---

## Verifying locally before you push

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle → dist/
npm run preview    # serve dist/ exactly like Render does
npm test           # typecheck + end-to-end DOM smoke test
```

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Could not read package.json` / `ENOENT … /project/src/package.json` | No `package.json` at the repo root (or the Root Directory points at a folder that has none) | Keep `package.json` at the root and leave **Root Directory** empty |
| Build passes but the site shows **404** | Publish Directory wrong | Set it to `dist` |
| Build passes but the page is blank / routes 404 on refresh | Missing SPA rewrite | Add rewrite `/*` → `/index.html` |
| `npm error could not determine executable to run: vite` | `node_modules` not installed because build command was changed | Build command must be `npm install && npm run build` |
| `Unsupported engine` / old Node | Repo requires Node ≥ 20 | Render → Environment → `NODE_VERSION=22` |
| Deploy takes ~50 s on first request | Free instance spun down | Normal on the free plan; upgrade or use a static site (always warm) |

---

## Environment variables

The current build needs **none** — it runs on a seeded demo worklist stored in the
browser's `localStorage`.

It is ready for Supabase, though; see `.env.example`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable anon key>
VITE_DATA_MODE=local
```

In Render these go under **Environment → Add Environment Variable**. Vite inlines
`VITE_*` values at build time, so redeploy after changing them.

Why it is not wired yet: the repository contains the domain logic and the
Supabase/Express server modules (`src/server/*`), but the upload did not include
`server.ts`, `src/lib/supabase.ts`, `src/lib/private-cache.ts`,
`src/lib/private-fetch.ts` or the Express route handlers. The production database
itself is intact (`sites`, `profiles`, `activity_logs`, `verified_hostnames`,
`face_templates`, `system_documents`, …), and every `InstallationSite` field maps to a
column of `public.sites`, so the next step is a data adapter behind
`src/lib/workspace-store.tsx`.

---

## Repository layout (after this change)

```
index.html                     Vite entry
render.yaml                    Render Blueprint (static site)
package.json                   scripts + dependencies
tsconfig.json                  front-end typecheck config
src/main.tsx, src/App.tsx      React bootstrap + tab shell
src/components/                Dashboard, review dialog, workspace wizard,
                               computer form, profile, reports, deployment page
src/lib/                       Local store, seeded worklist, flash/toast, downloads
src/utils/                     Domain logic: reservation rules, hostname capture,
                               stepper, CSV reports, activity pagination
src/server/                    Supabase + Express modules kept for the server build
src/styles/                    Glass design system and agent panel styles
public/                        PWA icons + manifest
docs/                          Import notes, security spec, reference screenshot
scripts/smoke.mjs              jsdom end-to-end smoke test
```
