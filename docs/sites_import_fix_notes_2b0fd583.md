# sites table import — what broke and how it was fixed

**Project:** Project mohan (`clnpfrzgkwbzewobcolh`) · **Table:** `public.sites`
**Source file:** `uploads/DVVNL_Aayush_pending_location_with_name.csv` (567 data rows)
**Status:** ✅ 567 / 567 rows loaded, verified in the database.

---

## Why the import failed

The insert was rejected by Postgres with a **not-null violation**, not a file-format problem:

```
ERROR 23502: null value in column "location" of relation "sites" violates not-null constraint
DETAIL: Failing row contains (…, name, null, null, null, pending, …)
```

`sites` has three `NOT NULL` columns that **do not exist in your CSV**:

| column in `sites` | nullable | in your CSV? | what was sent |
|---|---|---|---|
| `location` | `NOT NULL` | ❌ missing | `null` → **error** |
| `district` | `NOT NULL` | ❌ missing (CSV has `District`) | `null` → error |
| `client_name` | `NOT NULL` | ❌ missing (CSV has `Discom`) | `null` → error |
| `name` | `NOT NULL` | ✅ `name` | ok |

Postgres reports only the *first* failing column, so after fixing `location` the
import would have failed again on `district`, then on `client_name`.
That is why it looked like a never-ending error loop.

**Root cause:** column-name mismatch (case + missing columns), not bad data.

---

## The fix applied

| DB column | Filled with |
|---|---|
| `location` | `Location Key` (your choice — full hierarchy string) |
| `district` | `District` (fallback: first segment of `Location Key`) |
| `client_name` | `DVVNL` |
| `name`, `District`, `Discom`, `Zone`, `Circle`, `Division`, `Sub Division/Other`, `Sub Station Name`, `Office Type`, `Office Address`, `Number of departmental Desktop/Laptop`, `Contact Person Name and Designation`, `Phone Number`, `Preferred time for Remote Assistant (If any)`, `Remark`, `Source Workbook`, `Location Key`, `Available Systems`, `Pending system` | mapped 1:1 |

Also normalised:
- `Discom` — 25 rows were `Dvvnl`, 6 rows wrongly had `AGRA` → all set to `DVVNL`.
- `address` — copied from `Office Address`.
- `target_devices` — set from `Number of departmental Desktop/Laptop` (no more blanket `10`).
- `status` — set to `pending` on every row.
- `Available Systems` — 531 blanks sent as `NULL` instead of empty string.
- The one row with a blank `District` (CSV line 313) filled from its `Location Key` prefix.

---

## Verification (live query)

```
rows_loaded            567
distinct Location Keys 535
missing location         0
missing district         0
missing client_name      0
```

---

## ⚠️ One thing to decide later: 32 duplicate rows

Your CSV has **21 `Location Key` values that repeat** (32 extra rows), e.g.
`ALIGARH|ALIGARH|EUDC ALIGARH|APT|APT THANA,BARAHDWARI` appears 3×,
`MATHURA|MATHURA|EDC-I MATHURA|EDD- RURAL|DIVISION|…` appears 4×.

You asked for all 567 rows, so they are all in the table now. A "unique sites"
version (**535 rows**) is kept at `out/sites_import_ready_unique.csv` if you'd
rather de-duplicate.

To clean up later (keeps the most recently loaded row per Location Key):

```sql
-- preview first!
select "Location Key", count(*)
from public.sites
group by 1 having count(*) > 1;

-- then, if you want one row per key:
delete from public.sites a
using public.sites b
where a."Location Key" = b."Location Key"
  and a.created_at < b.created_at;
```

---

## Reusing this next time (any zone / any CSV)

The `sites` table expects these three values on every row — include them in your
import file or the insert will fail again:

1. `location` — not null
2. `district` — not null
3. `client_name` — not null

### Column-name gotchas
The DVVNL columns are stored **with spaces, slashes and capitals**, so they must be
double-quoted in SQL, and must match exactly in the CSV header:

```sql
"Sub Division/Other"
"Number of departmental Desktop/Laptop"
"Contact Person Name and Designation"
"Preferred time for Remote Assistant (If any)"
"Source Workbook"
"Location Key"
"Available Systems"
"Pending system"
```

Lower-case look-alikes (`location key`, `sub division/other`) will be rejected
with *"column does not exist"* / *"null value violates not-null constraint"*.

### Ready-to-run minimal template
```sql
insert into public.sites (
  name, location, district, client_name, "District", "Discom", "Zone", "Circle",
  "Division", "Sub Division/Other", "Office Type", "Office Address",
  "Number of departmental Desktop/Laptop", "Contact Person Name and Designation",
  "Phone Number", "Source Workbook", "Location Key", "Pending system", status
)
select
  "name", "Location Key", "District", 'DVVNL', "District", 'DVVNL', "Zone", "Circle",
  "Division", "Sub Division/Other", "Office Type", "Office Address",
  "Number of departmental Desktop/Laptop", "Contact Person Name and Designation",
  "Phone Number", "Source Workbook", "Location Key", "Pending system", 'pending'
from staging_sites;   -- your raw CSV loaded into a staging table
```
Loading into a `staging_sites` table (all columns `text`) first, then running a
`SELECT` like the above, is the safest pattern — it lets you preview exactly what
will land in `sites` before committing.

---

## Files produced

| file | what it is |
|---|---|
| `out/sites_import_ready.csv` | 567 rows, all NOT NULL columns filled, exact `sites` column order |
| `out/sites_import_ready_unique.csv` | 535 rows, de-duplicated by `Location Key` |
| `out/duplicates_dropped.csv` | the 32 rows that de-duplication would remove |
| `build_import.py` | the cleaning script (rerun for another zone's CSV) |
