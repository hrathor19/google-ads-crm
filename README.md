# KollegeApply Ads CRM

A role-based CRM over the Google Ads data that
[`google-ads-intelligence`](../../google-ads-intelligence-main) syncs: executive
reporting, account drill-downs, an ad-request approval workflow, AI ad copy and
a landing-page scorer — with a permission matrix a Super Admin can change at
runtime.

Built on the [Counselling CRM](../../Counselling%20CRM) stack, reading the same
PostgreSQL database as the Google Ads Intelligence project.

---

## Quick start

```bash
npm install
cp .env.example .env     # fill in the values — see "Environment variables"
npx prisma migrate deploy
npm run db:seed          # 4 default roles + the Super Admin
npm run dev              # http://localhost:3000
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. You will be required to
change the password before anything else opens — the seeded one is in a file on
disk and in the shell history of whoever ran the seed.

### Requirements

- Node 20+
- PostgreSQL 14+ — **the same database the Python project syncs into**
- Google Ads API credentials (developer token, OAuth client, refresh token, MCC id)

---

## Architecture

```
Next.js 14 (App Router, TypeScript)
   ├─ NextAuth v4 · credentials + JWT · bcrypt        ← Counselling CRM pattern
   ├─ Prisma 5 ──────────────────────────►  PostgreSQL  ads_intelligence
   │                                          ├─ 28 Google Ads tables   (read)
   │                                          └─ 12 crm_* tables        (read/write)
   ├─ lib/google-ads/   GAQL fetchers + sync engine → Google Ads API
   ├─ lib/ops/          scoring rules + aggregations
   ├─ lib/ai/           Gemini ad copy · landing-page scorer
   ├─ lib/ga4/          Analytics Data API
   ├─ lib/rbac/         the permission catalogue and engine
   └─ lib/workflow/     the Ad Request state machine
```

**Why one database.** The Python project already syncs Google Ads into
PostgreSQL. Pointing this app at the same tables makes metric parity a matter
of reading identical rows rather than re-deriving them, and it is verifiable:
`npm run parity` diffs the two engines' output on the same window. See
[docs/PARITY.md](docs/PARITY.md).

Prisma was introduced over an Alembic-owned schema by **baselining**: the
existing tables were introspected into `prisma/schema.prisma` and marked
applied (`0_init`), then a second migration adds only the `crm_*` tables. The
`crm_` prefix makes ownership obvious in `psql` and keeps the two migration
histories from ever colliding.

### Layout

```
app/
  api/**/route.ts          route handlers, one per resource
  dashboard/**/page.tsx    authenticated pages under one shell
  login/  change-password/
components/
  ui/                      shadcn primitives (copied from Counselling CRM)
  shell/                   sidebar, top bar, navigation
  data/                    tables, tiles, charts, panels
  providers/               permissions + global filters
lib/
  ai/  ga4/  google-ads/  ops/  rbac/  workflow/
  api.ts                   route guards and error handling
  redact.ts                financial redaction
prisma/                    schema, migrations, seed
scripts/                   sync, parity, e2e, responsive checks
tests/                     vitest suites
```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (parity, scoring, RBAC, workflow) |
| `npm run e2e` | Workflow + RBAC end-to-end, over HTTP (needs the dev server up) |
| `npm run check:responsive` | Real Chrome at 360 / 768 / 1280 px, plus accessibility checks |
| `npm run parity` | Diff this app's aggregation against the Python app's, both captured live. `-- --days=N` widens the window; the default 30 days only covers what the dashboards show, so use a long window after a backfill |
| `npm run check:writes` | Sync every entity for one account and one month and assert rows actually land. `npm run parity` cannot catch a broken writer — both engines read the same table, so one that has never worked still reports parity |
| `npm run check:secrets` | Fail if a value from `.env` reached the browser bundle. Run it after `npm run build`, never against a `next dev` bundle — it refuses one |
| `npm run sync` | Manual Google Ads sync |
| `npm run db:seed` / `db:migrate` / `db:studio` | Prisma |

### Syncing

```bash
npm run sync                                             # everything, 30-day lookback
npm run sync -- --entities=campaigns --days=7            # one entity, shorter window
npm run sync -- --customers=8104811686 --entities=keywords
```

The same code backs the **Refresh** button in the top bar.

#### Scheduling the sync

Nothing syncs on its own. `scripts/cron-sync.sh` is the scheduled entry point:

```cron
15 * * * *  /path/to/google-ads-crm/scripts/cron-sync.sh hourly   # campaigns, 2-day window
15 4 * * *  /path/to/google-ads-crm/scripts/cron-sync.sh daily    # every entity, 30-day window
```

That mirrors the source project's APScheduler cadence (hourly light, daily
full at 04:15 UTC). What differs is that the scheduler lives **outside** the
app rather than inside the web process: on a serverless or multi-instance
deploy an in-process scheduler means N schedulers racing, all calling the same
API with the same credentials. An external timer is one scheduler however many
web instances are running.

The script takes a lock so a slow run cannot overlap the next tick — two
overlapping passes would double the API load and interleave two
`replaceWindow` writes over the same window. The lock uses `mkdir` rather than
`flock`, which is absent on macOS, and reclaims itself if a killed run leaves
it behind for more than six hours. Logs go to `storage/logs/sync-<mode>.log`.

#### Backfilling history (`npm run backfill`)

The scheduled sync only ever pulls a **rolling window** (30 days by default),
so any date before your first sync renders empty — which reads as "nothing was
spent" when it actually means "never fetched". Google keeps the history; it
just has to be asked for.

For a single window, `sync` takes an explicit range:

```bash
npm run sync -- --start=2026-04-01 --end=2026-04-30
```

For a long history, use `backfill`, which splits the range into **month-sized
chunks**:

```bash
npm run backfill -- --from=2025-11 --to=2026-09
npm run backfill -- --from=2026-01 --to=2026-03 --entities=campaigns
```

Month chunks matter for three reasons: each Google Ads query stays bounded so a
wide account can't time out; `replaceWindow` clears and rewrites exactly the
window it is given, making a month the unit of idempotency; and an interrupted
run leaves whole completed months behind, so resuming is just running the same
command again.

Start with `--entities=campaigns` — it carries devices and geo with it, and
covers the dashboard, trends, accounts and the map. Widen to ad groups,
keywords and search terms only if you need the drill-downs; keywords are the
largest table by an order of magnitude.

> Note on search terms: Google's `search_term_view` is retention-limited and
> returns nothing for older dates, so a deep backfill of that entity is mostly
> empty queries. Campaign, ad group, ad and keyword history goes back much
> further.

Or from the UI: **Administration → Integrations health → Backfill historical
data** — which needs **`INTEGRATIONS:MANAGE`** on top of `SYNC:CREATE`. The
rolling Refresh is routine and a backfill is not: it can be hours of calls
against a shared daily API quota, and exhausting that stops the scheduled sync
for everyone. Of the seeded roles, only Super Admin can run one; the Google
Ads Team can still refresh. A run with an explicit range is recorded in `sync_logs` as
`sync_type = 'backfill'` rather than `'manual'`, so the two are distinguishable
afterwards.

Backfill is deliberately separate from the Refresh button: a wide range across
every account is minutes of API calls against a shared quota, and that should
be a decision rather than an accidental click. Start with the campaigns preset
— it covers the dashboard, trends and the geography map — and widen only if you
need keyword or search-term history. Each `(entity,
account, run)` writes one `sync_logs` row and each snapshot window is deleted
and re-inserted, so a re-run over an overlapping range cannot stack duplicate
rows and inflate every sum.

---

## Environment variables

Reused from the Google Ads Intelligence project:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL. **Required.** |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |
| `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` | OAuth client |
| `GOOGLE_ADS_REFRESH_TOKEN` | OAuth refresh token |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | The MCC id |
| `GEMINI_API_KEY` | AI ad copy. Without it the deterministic engine runs. |
| `GEMINI_MODEL` | Defaults to `gemini-flash-lite-latest` |
| `APP_ENV`, `APP_DEBUG`, `SCHEDULER_ENABLED` | Carried over; informational |
| `SESSION_SECRET`, `AUTH_*`, `SMTP_*`, `BREVO_API_KEY`, `PUBLIC_BASE_URL` | Carried over from the source `.env`; not read by this app |

Added by this app:

| Variable | Purpose |
|---|---|
| `NEXTAUTH_URL` | Base URL. **Required in production.** |
| `NEXTAUTH_SECRET` | Signs the session JWT. **Required.** |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | The Super Admin created by the seed. **Required.** |
| `GA4_PROPERTY_ID` | GA4 property. Analytics stays "not configured" without it. |
| `GA4_CLIENT_EMAIL` / `GA4_PRIVATE_KEY` | GA4 service account |
| `OPS_<GROUP>__<RULE>` | Override any scoring rule, e.g. `OPS_HEALTH__CTR_FLOOR=0.03` |
| `SYNC_MAX_RETRIES`, `SYNC_DEFAULT_LOOKBACK_DAYS` | Sync tuning |
| `LANDING_PAGE_TIMEOUT_SECONDS`, `LANDING_PAGE_MAX_BYTES` | Scraper bounds |

`assertRequiredEnv()` runs at first render and fails with a readable list, so a
misconfigured deploy says what is missing instead of throwing a null-pointer
three layers down.

### Suspended accounts

`SYNC_INCLUDE_SUSPENDED` (default `true`) is a deliberate divergence from the
source project, which syncs only accounts whose Google Ads status is
`ENABLED` (`is_syncable = status == "ENABLED"`).

That rule hides money that was really spent. In this MCC, 19 non-ENABLED
accounts hold roughly 237,909 clicks and ₹39 lakh, including the earliest
activity anywhere — 2025-05-16, a week before the 2025-05-23 that the
ENABLED-only history appears to start on.

Two consequences worth knowing:

- **The two apps share one database, and neither filters reporting by
  `is_syncable`.** Backfilling these accounts therefore changes the Google Ads
  Intelligence dashboards too, not just this app's.
- `npm run parity` is unaffected, because both engines read the same tables.

Set it to `false` to match the source app exactly. The `is_syncable` column
itself is never written by this app: the source project maintains it and would
overwrite any change, so the decision is made in the query instead.

### Secrets

`.env` is gitignored. Every module that touches a credential imports
`server-only`, which makes importing it from a client component a **build
error** rather than a code-review question. The build is checked for leaked
secret values; no Google Ads, Gemini or database credential appears in
`.next/static`.

---

## Roles and permissions

### The catalogue

A permission is `"<MODULE>:<ACTION>"`. Modules and their applicable actions are
declared in one file, [`lib/rbac/features.ts`](lib/rbac/features.ts), which
drives the matrix UI, the API guards and the seed together.

14 modules × the actions each supports = 34 permissions. Notable ones:

- **`FINANCIALS:VIEW`** — a permission of its own. Without it, cost, CPC,
  cost/conversion and budgets are stripped **server-side**, so the figures
  never reach the browser at all.
- **`AD_REQUESTS:APPROVE`** — who can approve. Notifications are routed by
  querying this permission, not by role name, so a custom reviewer role works
  without a code change.
- **`AD_COPY:GENERATE_AI`**, **`LANDING_SCORE:GENERATE_AI`** — the AI tools.

### The default roles

| Role | Summary |
|---|---|
| **Super Admin** | Bypasses every check. Cannot be deleted; its matrix is not editable because it would be ignored. |
| **Manager** | All reporting including spend, approves ad requests, no user/role management. |
| **Operations** | Raises and tracks requests. Reporting **without** financial data. |
| **Google Ads Team** | Works approved requests: AI copy, landing scores, takes a request live. |

Seeded roles are marked `isSystem` and cannot be deleted. A role with users
assigned cannot be deleted either.

### Custom roles

A Super Admin can create, clone, edit and delete roles at
**Administration → Roles & permissions**. Toggles save immediately; the JWT
re-validates against the database every five minutes, so a revoked permission
bites without anyone signing out. Every change is written to the audit log with
its before and after value.

A clone copies the source's **effective** matrix, not just its stored rows —
a seeded role's grants mostly live in the defaults, so copying only the rows
would produce an empty role that looked identical in the UI.

### Account scoping

A role or an individual user can be limited to specific Google Ads accounts.
The user's own scope takes precedence, so pinning one account to one person
does not require cloning a role.

An empty allow-list returns **nothing**, not everything —
`{ id: { in: [] } }`. That is the failure mode that matters, and there is a
test for it.

### Adding a permission

1. Add the action to the module's `actions` in `lib/rbac/features.ts` — or add a
   new module entry.
2. Grant it to whichever `SEED_ROLES` should have it by default.
3. Guard the endpoint: `await requirePermission('MODULE', 'ACTION')`.
4. Hide the UI: `can('MODULE', 'ACTION')` or `<Can module= action=>`.
5. `npm run db:seed` — idempotent; it adds the missing rows and never
   overwrites a live edit.

The matrix UI needs no change: it renders from `MODULES`.

> Hiding a button is a courtesy. The guard is the control — no endpoint relies
> on the UI having hidden anything.

---

## The Ad Request workflow

```
DRAFT ──► SUBMITTED ──┬──► APPROVED ──► IN_PROGRESS ──► READY ──► LIVE ──► COMPLETED
   ▲                  ├──► REJECTED ──────┐
   │                  └──► CHANGES_REQUESTED
   └──────────────── resubmit ────────────┘
```

Every transition is declared in one table
([`lib/workflow/ad-requests.ts`](lib/workflow/ad-requests.ts)) with the
permission it needs, the statuses it is reachable from, and whether it demands
a reason. `transition()` is the only way a status changes, and it writes the
timeline event, the notifications and the audit row on the same path — so a
status cannot move without a trace.

- Rejection and "request changes" require a reason; the API refuses without one.
- Only the person who raised a request can submit it.
- Once approved, the brief is locked: the Ads team is building against it, and
  a silent edit would make the approval meaningless.
- On approval the request enters the Ads team's queue, where copy generation,
  landing-page scoring, version history and the campaign link all live on one
  screen.

---

## AI features

### Ad copy

Grounded generation: the brief plus the **live landing page**, with an explicit
instruction never to invent a ranking, fee, placement figure or deadline. Output
is validated against Google's limits — 30 characters for headlines, 90 for
descriptions — and anything over is dropped rather than truncated, because a
cut headline is a fragment.

If no `GEMINI_API_KEY` is set, or the model fails, or it returns fewer than
Google's minimum of three headlines and two descriptions, a **deterministic
engine** builds copy from the same facts. Generating copy never hard-fails.

Ad Strength is predicted with the source project's additive model over headline
volume, description count, uniqueness and keyword coverage.

### Landing-page scorer

Fetches the page and scores it on the elements that drive ad conversions,
weighted, with exam pages judged on exam signals and college pages on college
signals. Tracking (GTM, GA4, Google Ads conversion, Meta Pixel, consent) and
link hygiene are part of the score, so a page cannot reach 100% while being
unmeasurable. Suggestions appear only for failed checks, heaviest lever first.

The fetcher is SSRF-guarded: http(s) only, every resolved address checked
against private, loopback, link-local, CGNAT and IPv4-mapped ranges, **re-checked
at every redirect hop**, with a body size cap and a bounded link probe.

---

## Geography

Google Ads reports geography as a **criterion id**, and the source project
stored `location_name` as `null` on every row — so its own reports could only
show `Country 2356`.

Two things fixed that:

- **The sync now names locations.** It resolves the ids through Google's
  `geo_target_constant` resource and caches the result in the column that was
  already there and always empty. Cached per process; a failed lookup never
  fails a sync.
- **A static ISO table names anything synced earlier**, so existing rows read
  correctly with no re-sync.

The map join is deliberately not a name match. A Google Ads country criterion
id is `2000 + ISO 3166-1 numeric` — India's 356 becomes 2356 — and the world
topojson keys its features on the same numeric code, so one subtraction
connects a reporting row to a polygon. Name matching is where these maps
usually break ("Ivory Coast" vs "Côte d'Ivoire"); none of that can happen here.

The choropleth (`/dashboard/segments`) shades by spend, clicks, impressions or
conversions, buckets on a square root so one dominant market doesn't flatten
the rest, and uses a single-hue sequential scale that survives greyscale and
colour blindness. The topojson is served from `public/world-110m.json` as a
static asset and the component is `dynamic()`-imported, so d3-geo costs
nothing on any other page. Regenerate the country table with
`node scripts/generate-country-codes.js`.

## Analytics (GA4)

Built against the Analytics Data API and **gated behind credentials that do not
exist yet**.

The source project has no GA4 reporting to port — GA4 appears there only as tag
*detection* inside the landing-page auditor, and its `.env` carries no GA4
credentials. Rather than pretend the section exists, the module reports "not
configured" and names the three variables to set. Supply them and the full
report set (traffic, sources/mediums, landing pages, engagement, conversions,
audience, devices, geography) comes to life.

---

## Testing

```bash
npm test                  # 130 unit tests
npm run e2e               # 65 end-to-end checks (dev server must be running)
npm run check:responsive  # 291 assertions in real Chrome
npm run parity            # 27 metric comparisons against the Python app
npm run check:secrets     # no .env value in the client bundle (after a build)
npm run check:writes      # every sync entity can actually write (hits the live API)
```

- **Parity** is asserted as a *relationship*, not a frozen snapshot: the Python
  project writes into this database and the figures move with every sync, so
  hardcoded expectations would fail for the wrong reason. The tests pin
  micros ÷ 1e6, CTR derived after summing, null-not-zero on a zero denominator,
  and that every rollup sums back to the window total.
- **E2E** drives the real HTTP API, so a guard that exists only in a component
  cannot make it pass. It walks the whole workflow across three signed-in
  users, then creates a custom role, toggles a permission, confirms the change
  bites on a live session, and confirms the delete guards hold.
- **Responsive** drives real Chrome and asserts what actually breaks on a
  phone: horizontal overflow (naming the offending element), an unopenable
  navigation, unlabelled inputs, unnamed icon buttons and touch targets under
  32px.

---

## Deployment notes

- `npm run build` runs `prisma generate` first.
- Apply migrations with `npx prisma migrate deploy` — never `db push`, which
  would compare the whole schema including the Alembic-owned tables.
- Set `NEXTAUTH_URL` to the deployed origin, or callbacks resolve to localhost.
- The sync and AI routes declare `maxDuration` (300s / 120s); a serverless host
  needs a plan that permits it, or the sync should run from `npm run sync` on a
  scheduler instead.
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`) are set in `next.config.js`.

---

## Documentation

- [docs/DISCOVERY.md](docs/DISCOVERY.md) — what both source projects contain,
  and the gaps between the brief and what actually exists
- [docs/PARITY.md](docs/PARITY.md) — the metric comparison, in full
