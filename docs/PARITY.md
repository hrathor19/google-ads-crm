# Metric parity with Google Ads Intelligence

## How parity is achieved

`google-ads-crm` points Prisma at the **same PostgreSQL database** the Python
project syncs into (`ads_intelligence`). Both applications therefore read
identical rows; what had to be reproduced is the *arithmetic on top of them*.

Three rules from `app/repositories/ops.py` carry the parity, and all three are
load-bearing:

| Rule | Why it matters |
|---|---|
| Money is stored in **micros**; every read divides by 1,000,000 and rounds to 2 dp | Dividing per row before summing, or rounding twice, drifts by cents per campaign and by hundreds across an account |
| Derived metrics are computed **after** summing — `SUM(clicks)/SUM(impressions)`, never `AVG(ctr)` | Averaging daily CTRs weights a 10-impression day the same as a 10,000-impression one |
| CTR and CPC are **null**, not zero, when the denominator is zero | `0.00%` reads as a measured failure; the truth is that there is nothing to measure |

Snapshot tables are append-only with a delete-window-then-insert refresh
(`replaceWindow`), so there is exactly one row per `(entity, day)` and sums
never double-count. The TypeScript sync engine reproduces that contract.

## Verification

```bash
# 1. Capture the source project's figures
cd ~/Downloads/google-ads-intelligence-main
./.venv/bin/python -c "…"   > /tmp/python-parity.json   # see below

# 2. Compare
cd ~/Downloads/"Ads CRM"/google-ads-crm
npm run parity -- --reference=/tmp/python-parity.json
```

## Result — 2026-09-30, window 2026-08-31 → 2026-09-29

```
metric                   python                node                  match
───────────────────────────────────────────────────────────────────────────
window                   ["2026-08-31","2026-  ["2026-08-31","2026-  yes
counts.accounts          121                   121                   yes
counts.campaigns_active  168                   168                   yes
counts.ad_groups_active  10926                 10926                 yes
counts.keywords_active   50755                 50755                 yes
30d.impressions          148680                148680                yes
30d.clicks               11504                 11504                 yes
30d.cost                 657512.62             657512.61             yes
30d.conversions          735                   735                   yes
30d.ctr                  0.0773742265267689    0.0773742265267689    yes
30d.avg_cpc              57.155130389429765    57.155129520166895    yes
30d.cost_per_conv        894.5749931972789     894.5749795918367     yes
latestDay.impressions    9787                  9787                  yes
latestDay.clicks         1033                  1033                  yes
latestDay.cost           40238.89              40238.89              yes
latestDay.conversions    67.4816               67.4816               yes
series_days              30                    30                    yes
limited_by_budget        10                    10                    yes
low_qs_keywords          30                    30                    yes
keyword_rows             2599                  2599                  yes
keyword_cost_sum         643677.82             643677.82             yes
search_term_total        15624                 15624                 yes
topTerm[0].cost          11859.87              11859.87              yes
topTerm[1].cost          11648.77              11648.77              yes
topTerm[2].cost          11162.26              11162.26              yes
topTerm[3].cost          8496.07               8496.07               yes
topTerm[4].cost          7931.64               7931.64               yes

27/27 match
```

### On the ₹0.01 difference in `30d.cost`

Python reports `657512.62`, this app `657512.61`. The comparison tolerance is
one paisa, and the difference is not a bug in either:

- Python's figure is `sum(round(daily_cost, 2) for each of 30 days)` — it
  rounds each day, then adds.
- This app's is `round(SUM(cost_micros) / 1e6, 2)` — it adds in integer
  micros, then rounds once.

Rounding once at the end is the more accurate of the two, and it is what the
Python code itself does on its own `account_day_totals` path. The dashboards
agree; only the 30-day roll-up of pre-rounded daily figures differs, by the
accumulated half-paisa.

The derived ratios (`avg_cpc`, `cost_per_conv`) differ in the 7th decimal for
the same reason and are identical to display precision.

### Two divergences found and corrected during the port

1. **Previous-period window overlapped the current one.** `previousWindow`
   anchored its end on the window's *end* rather than its *start*, so a
   30-day view compared itself against a window containing 29 of its own days.
   Fixed in `lib/ops/dates.ts`; a regression test pins the boundary.

2. **Keyword rows were left-joined.** This app returned 5,000 rows where the
   source returned 2,599, because a `LEFT JOIN` padded the list with keywords
   that had no snapshot in the window. The totals matched (the extra rows were
   all zero) but the count did not. Now an inner join, matching
   `keyword_metrics`: a keyword with no snapshot has no data, which is not the
   same as zero.

## The reference script

```python
import json
from datetime import timedelta
from app.database.session import SessionLocal
from app.repositories.ops import OpsRepository
from app.services.ops.dates import resolve_ref_dates

db = SessionLocal()
refs = resolve_ref_dates(db)
ops = OpsRepository(db)
start = refs.latest - timedelta(days=29)

series = ops.daily_series(start, refs.latest, None)
tot = {
    'impressions': sum(r['impressions'] for r in series),
    'clicks': sum(r['clicks'] for r in series),
    'cost': round(sum(r['cost'] for r in series), 2),
    'conversions': round(sum(r['conversions'] for r in series), 4),
}
tot['ctr'] = (tot['clicks'] / tot['impressions']) if tot['impressions'] else None
tot['avg_cpc'] = (tot['cost'] / tot['clicks']) if tot['clicks'] else None
tot['cost_per_conv'] = (tot['cost'] / tot['conversions']) if tot['conversions'] else None

kw = ops.keyword_metrics(start, refs.latest, None, cap=5000)
st, st_total = ops.search_terms_explore(start=start, end=refs.latest, limit=10, sort='cost')

print(json.dumps({
    'window': [str(start), str(refs.latest)],
    'counts': ops.entity_counts(None),
    'window_totals': tot,
    'day_totals_latest': ops.account_day_totals(refs.latest, None),
    'series_days': len(series),
    'limited_by_budget': ops.campaigns_limited_by_budget_count(refs.latest, None),
    'low_qs_keywords': ops.low_quality_keyword_count(refs.latest, 5, None),
    'keyword_rows': len(kw),
    'keyword_cost_sum': round(sum(k['cost'] for k in kw), 2),
    'search_term_total': st_total,
    'search_term_top': [
        {'q': r['query'], 'cost': r['cost'], 'clicks': r['clicks']} for r in st[:5]
    ],
}, indent=2, default=str))
```

## Write-path parity

The TypeScript sync was verified against the Python sync on the same account
(`8104811686`, campaigns, 3-day window). After the TypeScript sync rewrote the
window, the aggregates were byte-identical to what the Python sync had
produced:

| Day | Rows | Impressions | Clicks | Cost (micros) |
|---|---|---|---|---|
| 2026-09-27 | 3 | 734 | 51 | 5,307,120,000 |
| 2026-09-28 | 3 | 295 | 26 | 2,463,490,000 |

Status values were written as enum **names** (`ENABLED`, `MAXIMIZE_CONVERSIONS`,
`MOBILE`), not integers — see below.

### One Node/Python SDK difference that would have broken everything

The Python `google-ads` SDK returns proto-plus enums whose `.name` was written
straight into the varchar status columns. The Node `google-ads-api` SDK returns
the raw **integer** instead. Without mapping, a sync from this app would have
filled `status` with `"2"` and silently broken every read-side filter
(`status = 'ENABLED'`, `approval_status = 'DISAPPROVED'`, `device = 'MOBILE'`).

Every enum field is therefore mapped through the SDK's own enum registry in
`lib/google-ads/reports.ts`, and a value that is already a name passes through
unchanged.
