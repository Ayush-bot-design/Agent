# Reconciling the department data with the app template — recommendation

**Status: advice only. No database rows, schema or files were changed.**
Checked against `public.sites` / `public.installation_sites` (both currently empty) on 2026-11-10.

---

## 1. What the "conflict" actually is

You have two files that look like they describe the same thing. They don't. They have
**different grains**, **different identities**, and **different vocabularies**.

| | App template | Department file |
|---|---|---|
| File | `up-tender-sites-all-districts-all.csv` | `DVVNL_Aayush_pending_location_with_name.csv` |
| Rows | **0** (header only — it's a template) | **567** |
| Columns | 15 | 19 |
| One row = | **one deployed machine** (one Verified Hostname, one Resolved IP, one Approval Code, one biometric seal, one Completed At) | **one office / location** (headcount, contact person, pending systems) |
| Identity | `Site Code` | `Location Key` (hand-typed) |
| Purpose | deployment **tracker** | **inventory master** |

### The conflict in one sentence

> The department gave you **535 offices containing 1,095 machines**, and the app's
> template can store **exactly one machine's verification per row**.

If you import one row per office, then an office with 21 desktops (`CHIEF OFFICE, AGRA
ZONE`) gets **one** hostname slot — you can never record that 1 of 21 machines is done.
Progress becomes unmeasurable, which is the whole point of the app.

If you flatten to one row per machine, you get 1,095 rows that each repeat the same
contact person and headcount — and the export no longer matches the department's master.

**Neither file is wrong. Trying to make one table serve both grains is the conflict.**

---

## 2. Four concrete mismatches, with evidence

### (a) Grain: 535 offices vs 1,095 machines

```
567 raw rows  →  535 unique offices  →  1,095 target devices
                                         (1,061 after removing duplicate rows)
Pending systems: 968 total (936 after dedupe)     → 34 phantom devices from duplicates
```

### (b) Identity: no usable key in either direction

- The template keys on `Site Code`. **That column does not exist in the department file at all.**
- The department file keys on `Location Key` — and it is **hand-typed in Excel**:

| problem | evidence |
|---|---|
| Not a fixed 7-level key | 412 rows have 7 segments, **136 have 8**, 12 have 6, 5 have 5, 2 have 4 |
| Duplicate keys | **21 groups / 32 extra rows**. 8 groups are byte-identical; **13 groups are the same office with a different contact person** (e.g. `…|TECH -2 11KV & LT|OTHER|DIVISION|MASANI` → Er. Anil Pal **and** Rajkumar) |
| Placeholders as values | `-` used in Circle (17), Division (12), Sub Division (40), Sub Station Name (44) |
| Mixed case | district appears as both `Mathura` and `MATHURA`; 18 spellings for ~12 real districts |
| No protection | `sites` has **no unique constraint on `site_code`** → every re-import silently appends a full duplicate set |

That last line is the reason you ended up importing 567 rows and then deleting all of
them. It will happen again on the next import unless uniqueness is enforced.

### (c) Vocabulary: the status value that makes sites invisible

The app's reservation engine recognises **exactly three** statuses:

```sql
-- trigger handle_sites_reservation_timestamps()
IF NEW.status IN ('reserved', 'in_progress') THEN ... reserved_at = NOW()
ELSIF NEW.status = 'available' THEN ... release the agent

-- partial indexes
idx_sites_one_active_per_user ... WHERE status IN ('reserved','in_progress')
```

`sites.status` has `DEFAULT 'pending'` — **and `'pending'` is not part of the reservation
flow at all.** A site sitting at `'pending'` is never offered to an agent, never reserved,
never swept by the 24-hour expiry job. It is, functionally, invisible to the app.

The earlier import set all 567 rows to `'pending'`. Even with perfect data, agents would
have seen an empty worklist. **This is the most important thing to fix before any re-import.**

### (d) Office Type is unusable as-is

**60 distinct raw values** collapse to ~15 real categories:

```
308  SUB STATION        (from: SUB- STATION, SUBSTATION, SUB-STATION, SUB STATION, SUBSTAION, SUBSTATION MANT …)
 99  SUB DIVISION       (SUB DIVISION, SUB- DIVISION, SUB-DIVISION, SUBDIVISION, EDSD-* …)
 35  DIVISION
 31  OTHER / BLANK      (27 rows are literally "-", 4 are empty)
 17  TEST DIVISION      7 TEST LAB      4 METER TEST LAB
 15  CIRCLE             7 ZONE          7 COM        5 STORE    5 APT    4 WORKSHOP    2 ANTI-THEFT THANA
```

If any screen, filter or workflow branches on Office Type, it is currently broken.

### (e) But one thing is beautifully consistent — use it

I checked every row: **`Available Systems + Pending system = Number of departmental Desktop/Laptop`**,
with **0 exceptions in 567 rows**, and where `Available Systems` is blank, `Pending == Total`.

```
Total 1,095 = Installed 127 + Remaining 968
399 sites have exactly 1 system pending — nothing is fully complete yet
```

So the department data already encodes deployment progress. That means you do **not** need
to invent it — and you should not overwrite the app's `status` (an *agent workflow* field)
with it. Keep them separate: `target_devices` / `devices_installed` are facts,
`status` is a workflow state.

---

## 3. The recommendation

**Keep the app template as the contract. Do not widen `sites` again.**

The previous import bolted all 19 department columns onto `sites` as literal column names
with spaces, capitals and slashes — `"Sub Division/Other"`,
`"Preferred time for Remote Assistant (If any)"`, `"Number of departmental Desktop/Laptop"`.
That is why every insert needed quoting and why it failed on NOT NULL columns that looked
optional. `sites` now has 40 columns, half of them department-specific, and the app's
15-column template can never round-trip cleanly through it.

### Use three layers instead of one wide table

```
┌────────────────────────────────────────────────────────────────┐
│ STAGING      staging_sites (all text, straight CSV load)       │
│              · nothing reaches public.sites from here directly │
└───────────────────────────┬────────────────────────────────────┘
                            │  normalize + validate + dedupe
┌───────────────────────────▼────────────────────────────────────┐
│ MASTER       sites  — one row per OFFICE (535)                 │
│              site_code UNIQUE · district · name · address      │
│              status ∈ {available,reserved,in_progress,verified}│
│              target_devices · expected_hostname_prefix         │
│              site_data jsonb {zone, circle, division,          │
│                sub_division, office_type, contacts:[…],        │
│                devices_installed, source_workbook, loc_key}    │
└───────────────────────────┬────────────────────────────────────┘
                            │  1 : N
┌───────────────────────────▼────────────────────────────────────┐
│ TRACKER      site_devices — one row per MACHINE (1,095)        │
│              site_code FK · device_seq · verified_hostname     │
│              resolved_ip · approval_code · document_url        │
│              completed_at · biometric_* — i.e. the template    │
└────────────────────────────────────────────────────────────────┘
```

**Why this is the right split**

- The template's 15 columns map **1:1 onto `site_devices`** — it is literally a
  per-machine sheet, so it round-trips with no translation.
- `sites` holds only what is true per office: identity, hierarchy, headcount, workflow.
- The department's 19 columns land in **`site_data` jsonb** (already exists, default `'{}'`)
  or a companion table — no more 40-column inserts, no more quoting, and the app's
  existing `select *` keeps working.
- Multiple contacts per office stop being "duplicates": they become
  `site_data.contacts[]` and **no information is dropped** (this rescues the 13 conflicting groups).
- One deployment row per machine means `Completed At` and biometric fields become
  *meaningful* instead of being a single slot for a 21-PC office.

### Field-by-field

| Department column | Goes to | Rule |
|---|---|---|
| `name` | `sites.name` | trim, collapse spaces |
| `District` | `sites.district` + `sites."District"` | **uppercase + lookup** (18 → 12 canonical); 1 blank row → derive from `Location Key` |
| `Discom` | `site_data.discom` | force `DVVNL` (25 rows said `Dvvnl`, 6 wrongly said `AGRA`) |
| `Zone` | `site_data.zone` | `-` → `NULL` |
| `Circle` | `site_data.circle` | `-` → `NULL` |
| `Division` | `site_data.division` | `-` → `NULL` |
| `Sub Division/Other` | `site_data.sub_division` | `-` → `NULL` |
| `Sub Station Name` | `site_data.sub_station` | `-` → `NULL` |
| `Office Type` | `site_data.office_type` (+ keep raw) | **60 → 15 via mapping table** |
| `Office Address` | `sites.address` | also used for `location` if you ever need it |
| `Number of departmental Desktop/Laptop` | `sites.target_devices` | integer; also `site_data.headcount` |
| `Available Systems` | `site_data.devices_installed` | blank → **0**, not NULL (it means zero installed) |
| `Pending system` | `site_data.devices_pending` | must equal `target − installed`; assert it |
| `Contact Person Name and Designation` | `site_data.contacts[].name` | split name/designation on comma |
| `Phone Number` | `site_data.contacts[].phone` | keep as text; 10–12 digits, some multi-number — don't cast to int |
| `Preferred time for Remote Assistant (If any)` | `site_data.contacts[].preferred_time` | blank → NULL |
| `Remark` | `site_data.remark` | |
| `Source Workbook` | `site_data.source_workbook` | **provenance — keep it** |
| `Location Key` | `site_data.location_key` | matching key only, **never the DB identity** |

| Then generate (never ask the department for these) | Value |
|---|---|
| `sites.site_code` | `DV{DIST3}{SEQ4}` → `DVAGR0001` |
| `sites.expected_hostname_prefix` | same as `site_code` |
| `site_devices.device_seq` | `01 … target_devices` |
| `sites.status` | `available` (see §2c — **not** `pending`) |
| template workflow cols | leave NULL on import |

**Keep the site code short on purpose.** Windows computer names are limited to
**15 characters (NetBIOS)**. `DVVNL-AGRA-0001` is 14, so its second machine becomes
`DVVNL-AGRA-0001-02` → 17 chars → the agent fails at the hostname step and it looks like
an app bug. `DVAGR0001` (9) + `-02` = 12. Safe.

---

## 4. The import pipeline that stops the delete-and-retry cycle

The current workflow is *load → something's wrong → delete everything → repeat*. Replace it:

1. **Load raw CSV into `staging_sites`** (every column `text`). The CSV can never
   corrupt `sites` because it isn't pointing at it.
2. **Normalise in place** — uppercase district via lookup, map Office Type, `-`→NULL,
   trim, split contacts.
3. **Dedupe by the real identity**, not `Location Key`:
   `(district, zone, circle, division, sub_division, upper(name))` — and when a group
   disagrees only on contact person, **merge contacts** rather than dropping rows.
   Print how many groups merged and what device totals changed (you'd see 1,095 → 1,061).
4. **Generate deterministic site codes** from the hierarchy order. Deterministic is the
   whole trick: re-running gives the *same* codes, so step 5 is idempotent.
5. **Upsert**: `insert … on conflict (site_code) do update set …`. Re-import becomes
   safe and repeatable — a corrected file heals the data instead of doubling it.
6. **Validate before commit** — a few asserts, all of which currently fail or would have caught bugs:
   - every row has non-null `location`, `district`, `client_name` (the three NOT NULL traps)
   - `installed + pending = target_devices`
   - `status IN ('available','reserved','in_progress','verified')`
   - `district` is in the canonical list
   - `site_code` is unique
7. **Record the batch**: add `import_batch uuid DEFAULT gen_random_uuid()` on `sites` and
   `site_devices`. If a batch is bad you roll back **one batch**, not the whole table.
   This alone retires the "delete all sites" step.

### Constraints to add before the next import (clean slate — do it now)

```sql
-- 1. this is what makes upsert idempotent, and what was missing
create unique index sites_site_code_uidx on public.sites (site_code);

-- 2. stop the status free-for-all
alter table public.sites add constraint sites_status_chk
  check (status in ('available','reserved','in_progress','verified'));

-- 3. one hostname, one machine
create unique index site_devices_hostname_uidx
  on public.site_devices (lower(verified_hostname))
  where verified_hostname is not null;

-- 4. traceability / batch rollback
alter table public.sites add column import_batch uuid default gen_random_uuid();
```

Also consider **soft delete** (`deleted_at`) instead of `DELETE` — "the app still shows
sites" is much easier to diagnose when rows are marked, not gone.

---

## 5. Process fix: stop the format conflict at the source

Don't ask the department to restructure 19 columns — they won't, and their file is a
perfectly good inventory master. Instead:

- Maintain the **mapping layer yourself** (a normalisation sheet: 60 office-type variants
  → 15 codes, 18 district spellings → 12). That's a one-time, reusable asset for every
  future zone.
- Send them a **locked Excel** with:
  - only the columns you actually need: District, Site Name, Address, Office Type,
    Headcount, Contact name, Phone, Preferred time
  - **dropdown validation** on District and Office Type — this prevents the 60-variant
    and mixed-case problems structurally
  - three example rows, no merged cells, one header row
- Ask for **one contact per row** (or a separate contacts sheet) instead of two people
  crammed into one site, which is what created those 13 "conflicting duplicates".
- Always ask for `Source Workbook` / a `Sent On` date so you can tell a re-issue from a
  correction.

---

## 6. If you want to keep it simpler — the options ranked

| Option | What it costs | Verdict |
|---|---|---|
| **A. One wide `sites` table, all 19 columns, one row per office** | Fastest to load; you lose per-machine verification, keep the 40-column quoting pain, and can't measure progress past 1 device | Works, but you'll hit the same wall next zone |
| **B. `sites` (office master) + `site_devices` (machine tracker), department extras in `site_data`** | One extra table + a mapping sheet | **Recommended** — matches both files' grains, template round-trips, progress is measurable |
| **C. Ask department to resubmit in the app template** | Slow, likely refused, still needs office→machine expansion | Only as a fallback for a small zone |

**My recommendation: B**, done on the clean slate you now have. Specifically, in this order:

1. Add the four constraints in §4 (5 minutes, permanent benefit).
2. Decide the canonical status vocabulary and set imported sites to `available`,
   otherwise the app will show an empty worklist no matter how good the data is.
3. Build the normalisation sheet (Office Type 60→15, District 18→12).
4. Reload through staging → normalise → dedupe/merge contacts → generate site codes →
   validate → idempotent upsert.
5. Expand to `site_devices` (1,095 rows) so per-machine verification has somewhere to live.

---

### One loose end from before

The app's **export** produced 0 data rows while the **screen** still showed sites — the same
app, same moment, reading two different sources. That points at fallback data inside the
app bundle (or a second project URL), not at Supabase. Worth fixing in the same pass:
if the app falls back to demo rows when the table is empty, no import you ever do will
look correct on screen, and an empty state will be indistinguishable from a failed load.
