# UP Tender Deployment Console

Field-agent workspace for the Uttar Pradesh (DVVNL) tender software deployment: district
site reservation, workstation capture, server hostname verification, signed paperwork
and completion reporting — built on the domain logic from the original AI Studio export.

> **Deployment:** if Render is failing with `Could not read package.json`, read
> [`DEPLOYMENT.md`](./DEPLOYMENT.md). Short version: the repository had no
> `package.json`, so Render's default `npm install && npm run build` failed instantly.
> It is a real Vite project now — redeploy as a **Static Site** with build command
> `npm install && npm run build` and publish directory `dist`.

## What the console does

- **District worklist** — 24 seeded UP offices across 10 districts, with search,
  district/status filters and sorting by district, name or pending systems.
- **Atomic reservation** — one active site per agent, 24-hour window with automatic
  expiry, cross-agent lockouts and the “Pending — original agent only” rule
  (`src/utils/deployment-logic.ts`, `site-selection.ts`).
- **Installation workspace** — three-phase stepper, milestone checklist, per-device
  capture (RAM, Windows build, architecture, verified hostname, exception reasons),
  document attachment with SHA-256 checksums and completion gate enforcement.
- **Biometric gates** — arrival check and completion seal, simulated locally.
- **Profile & reporting** — per-user isolation, personal CSV export, district progress
  breakdown, activity log pagination (`paginateActivityLogs`).

All rules live in `src/utils/*` (the pure domain layer that shipped with the repo) and
are consumed by the React UI in `src/components/*`. The demo persists to
`localStorage`; a Supabase adapter can replace `src/lib/workspace-store.tsx` without
touching the domain logic.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `http://localhost:5173` |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve `dist/` like Render does |
| `npm run typecheck` | TypeScript check of the front-end |
| `npm run smoke` | jsdom end-to-end test: sign in → reserve → record device → paperwork → seal |
| `npm test` | `typecheck` + `smoke` |

## Stack

Vite 7 · React 19 · TypeScript 5.9 · Tailwind CSS 4 (via `@tailwindcss/vite`) ·
zero backend required, optional Supabase.

## Notes on the imported source

The original upload contained 84 loose files (domain logic, tests, styles, PWA assets)
but no project scaffolding. They are now arranged by the paths their imports expect:

- `src/utils/` — domain logic, validators, wizard helpers (with their `node:test` suites)
- `src/server/` — Supabase/Express modules, request timing, route tests
- `src/lib/` — `expiring-cache` plus the new local store, seed data and helpers
- `src/styles/` — the glass/agent CSS that `src/index.css` imports

The server modules still reference files that were never uploaded (`server.ts`,
`src/lib/supabase.ts`, `src/lib/private-cache.ts`, `src/lib/private-fetch.ts`,
`src/server/identity-validation.ts`, `pglite`/`web-push` packages). They are excluded
from the front-end typecheck and are not bundled, but kept intact for the future
server build.
