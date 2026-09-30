"""Emit the source project's figures as JSON, for the parity comparison.

Run inside the Google Ads Intelligence virtualenv; `npm run parity` invokes it
automatically so both sides are measured at the same moment against the same
database. Comparing against a snapshot captured hours earlier is worse than
useless: a sync in between moves the numbers and the tool reports a divergence
that isn't one.
"""

import json
import sys
from datetime import timedelta

from app.database.session import SessionLocal
from app.repositories.ops import OpsRepository
from app.services.ops.dates import resolve_ref_dates

db = SessionLocal()
refs = resolve_ref_dates(db)
ops = OpsRepository(db)
_days = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--days=")), "29")
start = refs.latest - timedelta(days=int(_days))

series = ops.daily_series(start, refs.latest, None)
tot = {
    "impressions": sum(r["impressions"] for r in series),
    "clicks": sum(r["clicks"] for r in series),
    "cost": round(sum(r["cost"] for r in series), 2),
    "conversions": round(sum(r["conversions"] for r in series), 4),
}
tot["ctr"] = (tot["clicks"] / tot["impressions"]) if tot["impressions"] else None
tot["avg_cpc"] = (tot["cost"] / tot["clicks"]) if tot["clicks"] else None
tot["cost_per_conv"] = (tot["cost"] / tot["conversions"]) if tot["conversions"] else None

kw = ops.keyword_metrics(start, refs.latest, None, cap=5000)
st, st_total = ops.search_terms_explore(start=start, end=refs.latest, limit=10, sort="cost")

print(json.dumps({
    "window": [str(start), str(refs.latest)],
    "counts": ops.entity_counts(None),
    "window_totals": tot,
    "day_totals_latest": ops.account_day_totals(refs.latest, None),
    "series_days": len(series),
    "limited_by_budget": ops.campaigns_limited_by_budget_count(refs.latest, None),
    "low_qs_keywords": ops.low_quality_keyword_count(refs.latest, 5, None),
    "keyword_rows": len(kw),
    "keyword_cost_sum": round(sum(k["cost"] for k in kw), 2),
    "search_term_total": st_total,
    "search_term_top": [
        {"q": r["query"], "cost": r["cost"], "clicks": r["clicks"]} for r in st[:5]
    ],
}, indent=2, default=str))
