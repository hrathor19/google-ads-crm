# DISCOVERY — `google-ads-crm`

Findings from reading both source projects in full, before any code was written.

- **Source of tech stack / conventions:** `~/Downloads/Counselling CRM`
- **Source of features / data logic / credentials:** `~/Downloads/google-ads-intelligence-main`

---

## 1. Counselling CRM — the stack we must copy

### Framework & language

| Concern | Choice |
|---|---|
| Framework | **Next.js 14.2.4**, App Router (`app/`), React 18 |
| Language | **TypeScript 5** (strict), `@/*` path alias |
| Runtime | Node, server components + route handlers (`app/api/**/route.ts`) |
| Package manager | npm (`package-lock.json` committed) |

### UI

| Concern | Choice |
|---|---|
| Styling | **Tailwind CSS 3.4**, `darkMode: 'class'`, CSS-variable HSL theme tokens in `app/globals.css` |
| Components | **shadcn/ui** pattern hand-rolled over **Radix UI** primitives in `components/ui/*` (avatar, badge, button, card, dialog, dropdown-menu, input, label, select, separator, switch, table, toast, toaster, use-toast) |
| Variants | `class-variance-authority` + `clsx` + `tailwind-merge` (`cn()` in `lib/utils.ts`) |
| Icons | `lucide-react` |
| Charts | `recharts` |
| Tables | `@tanstack/react-table` |
| Forms | `react-hook-form` + `@hookform/resolvers` + `zod` |
| Theme | `next-themes`, `attribute="class"`, `storageKey` |
| Motion | `framer-motion` + a hand-written animation system in `globals.css` (`fade-in-up`, `scale-in`, `stagger-N`, `hover-lift`, `skeleton-shimmer`, `btn-sheen`, reduced-motion guard) |
| Font | `next/font/google` → Inter |
| Radius | `--radius: 0.75rem` |
| Brand primary | `220.8 73.5% 19.2%` (deep navy) light / `217.2 91.2% 59.8%` dark |

### Data & state

| Concern | Choice |
|---|---|
| ORM | **Prisma 5.14** (`prisma/schema.prisma`, `provider = "postgresql"`) |
| DB | PostgreSQL |
| Client singleton | `lib/prisma.ts` — `globalThis` cache, dev-only reuse |
| Server state | **TanStack Query v5** (`staleTime: 0`, refetch on focus/mount) |
| CSV | `papaparse` |
| Seeding | `prisma/seed.ts` run by `ts-node` |

### Auth pattern (copied exactly)

- **NextAuth v4** `CredentialsProvider`, **JWT** strategy, 24 h `maxAge`, `pages.signIn = '/login'`.
- Passwords hashed with **bcryptjs**.
- In-memory **login rate limiting / lockout** (`lib/login-rate-limit.ts`): `getLockoutRemaining` → `recordFailedLogin` → `clearFailedLogins`.
- `jwt` callback re-validates the token against the DB every **5 minutes** (`TOKEN_REVALIDATE_SECONDS`) so deactivation and role changes land mid-session; sets `token.invalidated`.
- `session` callback returns `null` for an invalidated token → `getServerSession()` is null → every API route 401s.
- `middleware.ts` uses `withAuth` with a **longest-prefix-wins** `ROLE_ROUTES` map and `authorized: ({token}) => !!token && !token.invalidated`.

### Permission pattern (copied, then extended)

`lib/permissions.ts`:
- `Role` and `Feature` are **Prisma enums**; a `Permission` table stores `(role, feature) → canAccess` with a compound unique `role_feature`.
- `DEFAULT_PERMISSIONS: Record<Role, Feature[]>` is the fallback when no DB row exists.
- `SUPER_ADMIN` short-circuits to `true` everywhere.
- Helpers: `hasPermission`, `getRolePermissions`, `getAllPermissions`.
- `logActivity()` writes an `ActivityLog` row, with a central `UNLOGGED_ACTIONS` deny-set.

> **Extension required by the brief:** the Counselling CRM's roles are a *fixed
> Prisma enum*, so Super Admins cannot create custom roles. The new app keeps
> the same shape (matrix of role × feature toggles, DB-backed, `SUPER_ADMIN`
> bypass, sensible defaults) but moves `Role` from an enum to a **`Role` table**
> so roles can be created / cloned / edited / deleted, and adds
> **account-level scoping** (`RoleAccount` / `UserAccount`).

### Folder structure

```
app/
  api/**/route.ts        route handlers, grouped by resource
  dashboard/**/page.tsx  authenticated pages under one layout
  login/page.tsx
  layout.tsx providers.tsx globals.css
components/
  ui/                    shadcn primitives
  <domain>/              feature components
lib/                     server + client helpers, one concern per file
prisma/                  schema.prisma, migrations/, seed.ts
middleware.ts
```

### Scripts

`dev`, `build` (`prisma generate && next build`), `start`, `lint`, `db:generate`, `db:migrate`, `db:push`, `db:seed`, `db:studio`.

---

## 2. Google Ads Intelligence Main — the features we must reach parity with

**Stack (NOT reused):** Python 3.12 · FastAPI · SQLAlchemy 2 + Alembic · PostgreSQL · APScheduler · pydantic-settings · `google-ads` SDK · a separate Vite + React 18 SPA in `frontend/`.

### 2.1 Data model (28 tables, PostgreSQL)

Every entity has a **dimension** table (current state, upserted by natural key)
and, where it carries performance, an **append-only snapshot** table.

| Dimension | Snapshot(s) |
|---|---|
| `accounts` | — |
| `campaigns` | `campaign_snapshots`, `campaign_device_snapshots`, `campaign_geo_snapshots` |
| `ad_groups` | `ad_group_snapshots` |
| `ads` | `ad_snapshots` |
| `keywords` | `keyword_snapshots` (incl. Quality Score + 3 sub-components) |
| `search_terms` | `search_term_snapshots` |
| `budgets` | `budget_snapshots` |
| `recommendations` | (point-in-time) |
| `sync_logs` | one row per (entity, account, run) |

Plus: `alerts`, `audit_logs`, `users`, `user_accounts`, `api_tokens`,
`account_budgets`, `account_weekly_budgets`, `ad_copy_generations`,
`approval_events`, `scorecard_snapshots`, `alembic_version`.

**Shared mixins**
- `SnapshotMixin` → `snapshot_date`, `sync_time`, `account_id`, `sync_log_id`
- `MetricsMixin` → `impressions`, `clicks`, `interactions`, `cost_micros`, `ctr`,
  `average_cpc_micros`, `average_cpm_micros`, `conversions`, `conversions_value`,
  `all_conversions`, `video_views`

**Money is stored in micros** (integer, lossless); every read path divides by
`1_000_000` and rounds to 2 dp. **This is the single most important parity rule.**

**Idempotency:** `BaseRepository.replace_window()` deletes the account's rows in
`[start, end]` for the table, then bulk-inserts — so there is exactly one row per
`(entity, day)` and sums never double-count.

### 2.2 Live data in the local database

`DATABASE_URL=postgresql+psycopg://himanshurathore@localhost:5432/ads_intelligence`

| Table | Rows |
|---|---|
| accounts | 123 |
| campaigns | 1 085 |
| ad_groups | 11 335 |
| ads | 11 224 |
| keywords | 60 273 |
| search_terms | 15 624 |
| campaign_snapshots | 539 |
| keyword_snapshots | 8 795 |
| search_term_snapshots | 30 290 |
| campaign_device_snapshots | 1 240 |
| campaign_geo_snapshots | 864 |
| budgets | 1 174 |
| sync_logs | 7 170 |

Snapshot date range: **2026-08-31 → 2026-09-29**.

### 2.3 GAQL queries (the data contract — ported verbatim)

| Fetcher | `FROM` | Notes |
|---|---|---|
| `fetch_accounts` | `customer_client` | `WHERE customer_client.level <= 1` |
| `fetch_campaigns` | `campaign` | `status != 'REMOVED'`; networks joined from 4 boolean flags; `start_date`/`end_date` deliberately dropped for API v24 |
| `fetch_campaign_metrics` | `campaign` | + `segments.date`, `campaign_budget.amount_micros` |
| `fetch_campaign_device_metrics` | `campaign` | + `segments.device` |
| `fetch_campaign_geo_metrics` | `geographic_view` | + `country_criterion_id` |
| `fetch_ad_groups` / `_metrics` | `ad_group` | |
| `fetch_ads` / `_metrics` | `ad_group_ad` | RSA headlines/descriptions newline-joined; `policy_summary.approval_status` |
| `fetch_keywords` / `_metrics` | `keyword_view` | `quality_info.{quality_score, creative_quality_score, post_click_quality_score, search_predicted_ctr}` |
| `fetch_search_terms` | `search_term_view` | dimension + metrics in one query |
| `fetch_budgets` / `_metrics` | `campaign_budget` | `utilization = spend/amount` rounded to 4 dp |
| `fetch_recommendations` | `recommendation` | impact fields are `None` on API v24 |

`default_date_range()` ends at **yesterday** (today's metrics still accumulate).

### 2.4 Aggregation logic (`repositories/ops.py`, `repositories/dashboard.py`)

All set-based, grouped, no N+1. Derived metrics computed **after** summing:

```
ctr      = clicks / impressions          (null when impressions = 0)
avg_cpc  = cost   / clicks               (null when clicks = 0)
cost     = round(cost_micros / 1e6, 2)
```

Key methods: `entity_counts`, `account_day_totals`, `new_search_terms_count`,
`low_quality_keyword_count`, `campaigns_limited_by_budget_count`,
`campaign_metrics_by_day`, `campaign_meta`, `avg_quality_score_by_campaign`,
`disapproved_ads_by_campaign`, `keyword_metrics`, `search_terms_explore`,
`daily_series`, `daily_entity_counts`, `latest_budget_snapshots`.

**Reference-date rule** (`services/ops/dates.py`): "today" = `MAX(snapshot_date)`
across **all** accounts, never the selected account's own max — a dormant account
must read ~0 for a recent window rather than showing its last active day.

### 2.5 Scoring rules (`config/ops_rules.py` + `services/ops/scoring.py`)

Pure functions over dataclasses, all thresholds in one file, env-overridable
with the `OPS_` prefix.

- **Campaign health** — starts at 100, subtracts: low CTR (<2 %) −15, CTR drop
  ≥20 % −15, CPC rise ≥20 % −10, avg QS <5 −15, budget ≥85 % −10 / ≥100 % −20,
  optimization score <60 % −10, disapproved ads −20, disapproved keywords −10.
  Zero impressions forces the critical band. Paused/removed → `ignored`.
  Bands: ≥80 healthy, ≥60 warning, ≥40 high, else critical.
- **Keyword health** — QS ≤3 −40, QS <5 −25, CTR <1 % −15, ≥500 spend with 0
  conversions −20. Bands: ≥80 healthy, ≥60 warning, else critical.
- **Budget risk** — warn at 85 %, critical at 100 %; end-of-day projection by
  linear extrapolation with a 5 % minimum-elapsed floor.
- **Priority** — `0.7 × (100 − health) + 0.3 × spend_pressure`, where
  `spend_pressure = min(100, spend/5000 × 100)`; review minutes
  `min(30, 3 + 2 × issues)`; wasted spend `spend × (100 − health)/100`.
- **Alerts** — CTR drop 20 %, CPC rise 25 %, spend spike 50 %, QS drop ≥1,
  25 new search terms, budget util ≥95 %; critical at CTR −40 % / spend +100 %;
  ignores CTR alerts under 100 impressions.

### 2.6 Pages in the old SPA (19 routes)

`/` Overview · `/accounts` · `/explorer` Campaign Explorer · `/priorities` ·
`/alerts` · `/campaigns` Campaign Health · `/campaigns/:id` detail · `/keywords` ·
`/search-terms` · `/budgets` · `/trends` · `/reports` (admin) · `/ai/ad-copy` ·
`/accountability` · `/account-budgets` · `/weekly-budgets` · `/execution-audit` ·
`/landing-auditor` · `/admin/users` (admin) · `/login`.

Global filters live in a `FiltersContext` (account + date window), header-based
role auth (`X-Role` / `X-Actor`).

### 2.7 API surface (`/api/v1`, 31 routers)

`health`, `accounts`, `campaigns`, `campaign_health`, `campaign_explorer`,
`ad_groups`, `ads`, `keywords`, `keyword_health`, `search_terms`,
`search_explorer`, `budgets`, `budget_monitor`, `weekly_budgets`,
`account_budget`, `metrics`, `sync`, `overview`, `ops_dashboard`, `dashboard`,
`trends`, `priorities`, `alerts`, `reports`, `audit`, `auth`, `admin_users`,
`admin_diagnostics`, `ad_copy`.

### 2.8 AI features

**Ad Copy Generator** (`services/ai/ad_copy_service.py`, 1 127 lines + ~25
collaborating modules). An 11-step pipeline:

1. campus brief lookup (`campus_config`) → 2. Final-URL discovery
(`campus_service`) → 3. landing-page fetch + parse (`landing_page_service`) →
4. historical intelligence → 5-7. keyword research (Keyword Planner) → intent
classification → scoring → 8. grouping → 9. generation (LLM, with a
deterministic fallback engine) → 10. RSA validation (`rsa_validator`,
**H_MAX = 30**, **D_MAX = 90**) → 11. persistence + approval workflow.

Also produces: display paths, callouts, structured snippets, sitelinks,
negative keywords, seasonality, budget plan, CPL optimizer, reverse planner,
bid audit, setup guide, scorecard, last-year summary.

**LLM client** (`ai_clients/llm_client.py`): pluggable **Anthropic** or
**Gemini**; `provider = "auto"` prefers Anthropic, falls back to Gemini, then to
the deterministic engine. Tenacity retry on transient errors. Gemini is called
with `response_mime_type: application/json`.

**Landing Page Scorer** (`landing_quality.py` + `landing_page_service.py` +
`landing_auditor.py`):
- SSRF-guarded fetch (http(s) only, private/loopback IPs refused, body size cap).
- Parses title/meta/H1-H3/CTAs, buckets text by regex cues (courses, fees,
  eligibility, scholarships, placements, rankings, accreditations, dates,
  deadlines), detects tracking tags (GTM, GA4, AW-, Meta Pixel, consent,
  remarketing), counts external links using an **eTLD+1** comparison with a
  multi-TLD table, and probes ≤15 links for 404/410/5xx.
- Detects **page type** (exam vs college) and scores against the matching
  weighted check-list + tracking (22 pts) + links (10 pts). Grade A ≥85,
  B ≥70, C ≥50, else D. Suggestions are emitted **only for failed checks**,
  heaviest weight first.

### 2.9 Environment variables (names only)

`AD_COPY_LLM_PROVIDER`, `APP_DEBUG`, `APP_ENV`, `APP_LOG_JSON`,
`AUTH_ADMIN_EMAILS`, `AUTH_ALLOWED_DOMAINS`, `AUTH_ENABLED`, `BREVO_API_KEY`,
`DATABASE_URL`, `DB_MAX_OVERFLOW`, `DB_POOL_SIZE`, `EMAIL_FROM`,
`GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_ADS_CLIENT_ID`,
`GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
`GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_REFRESH_TOKEN`,
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SCHEDULER_ENABLED`,
`SESSION_SECRET`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_PASSWORD`, `SMTP_PORT`,
`SMTP_USER`, `PUBLIC_BASE_URL`.

Also read by `settings.py` but absent from `.env`: `ANTHROPIC_API_KEY`,
`GOOGLE_ADS_API_VERSION`, `GOOGLE_ADS_YAML_PATH`, `API_KEY`, `RESEND_API_KEY`,
`SYNC_*`, `LANDING_PAGE_*`, `OPS_*`.

---

## 3. Gaps between the brief and what actually exists

| Brief asks for | Reality in the source project |
|---|---|
| "Full GA4 section as in the old project: traffic, sources/mediums, landing pages, engagement, conversions, audience, devices, geo" | **There is no GA4 reporting integration.** `GA4` appears only as *tag detection* inside the landing-page auditor (does the page carry a `G-…` id or `gtag`). There are **no GA4 credentials** in `.env` — no property id, no service-account JSON, no OAuth scope for the Analytics Data API. Nothing can be ported, and nothing can be fetched without new credentials. |
| "Ad Requests workflow, Draft → Submitted → Approved …" | Does not exist. The old app has an *ad-copy generation* approval flow (`approval_service.py`, `approval_events`) with `draft / submitted / approved / rejected / changes_requested` — reused as the state-machine model for the new Ad Request entity. |
| "Role creation UI, permission matrix" | Old app has two hard-coded roles (`admin`, `manager`) plus a header-based `X-Role` gate. Counselling CRM has the matrix but with a fixed role enum. Both are extended. |
| Device / geo reports | Data **is** synced (`campaign_device_snapshots`, `campaign_geo_snapshots`) but the old SPA has no dedicated device or geo page — geo carries a `country_criterion_id` with `location_name = None`. |

---

## 4. Architecture decision for `google-ads-crm`

**Same stack as Counselling CRM, same database as Google Ads Intelligence.**

```
Next.js 14 (App Router, TS)
   ├─ NextAuth v4 credentials + JWT      ← Counselling CRM pattern
   ├─ Prisma 5  ──────────────────────►  PostgreSQL  ads_intelligence
   │                                        ├─ 28 existing Google Ads tables  (read)
   │                                        └─ new CRM tables                 (read/write)
   ├─ lib/google-ads/    GAQL fetchers ported 1:1 → Google Ads API
   ├─ lib/ops/           scoring rules + aggregations ported 1:1
   └─ lib/ai/            Gemini ad copy + landing-page scorer
```

Reading the **same rows** the Python app reads is what makes metric parity
verifiable rather than aspirational: the aggregation SQL is re-expressed in
Prisma/SQL, and a parity test compares its output against the same query run
directly on the database for a fixed date range.

Prisma is introduced over an Alembic-owned schema by **baselining**: introspect
the existing tables, add the CRM models, and generate a migration that creates
only the new tables.
