import 'server-only';
import { prisma } from '@/lib/prisma';
import { STATUS_LABELS } from '@/lib/workflow/state-machine';
import { urlVariants } from '@/lib/ai/landing-score-store';

/**
 * The requirement, as it goes out in every mail about a request.
 *
 * One builder for all five notifications, so the report somebody reads at
 * submission is the same report they read at launch — the figures simply
 * fill in as the flow sets them. Budget and Required CPL are blank in the
 * first mail and carry values from the budget step onward; they are always
 * *present* as rows, because a missing line reads as an oversight while an
 * em dash reads as "not decided yet".
 *
 * Nothing here is conditional on who is reading: the recipients are chosen
 * per event in the Email settings, and a brief that changed shape per
 * audience would make two people quoting "the mail" to each other describe
 * different documents.
 */

const DASH = '—';

const CLIENT_TYPE_LABELS: Record<string, string> = {
  CLIENT: 'Client',
  GENERIC: 'Generic',
  NON_CLIENT: 'Non-client',
  EXAM: 'Exam',
};

const AGE_LABELS: Record<string, string> = {
  OPEN: 'Open',
  AGE_18_24: '18–24 years',
};

const OBJECTIVE_LABELS: Record<string, string> = {
  LEAD_GENERATION: 'Lead generation',
  WEBSITE_TRAFFIC: 'Website traffic',
  BRAND_AWARENESS: 'Brand awareness',
  APP_PROMOTION: 'App promotion',
  SALES: 'Sales',
  LOCAL_VISITS: 'Local visits',
};

/** Indian grouping, no decimals: the figures people quote to each other. */
function rupees(value: unknown): string {
  if (value === null || value === undefined) return DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function date(value: Date | null | undefined): string {
  if (!value) return DASH;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value);
}

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : DASH);
const count = (v: number | null | undefined) =>
  v === null || v === undefined ? DASH : new Intl.NumberFormat('en-IN').format(v);

/**
 * One fact in the brief.
 *
 * `wide` spans the full width — a landing page URL in a half-width cell
 * wraps onto four lines and undoes the point of the two-column layout.
 * `always` survives the empty-row cull: the budget and CPL are deliberately
 * blank in the first mail, and hiding them there would lose the one thing
 * the reader is checking for.
 */
export type BriefRow = {
  label: string;
  value: string;
  wide?: boolean;
  always?: boolean;
  /**
   * Not something Operations types. The objective defaults, the account and
   * campaigns are picked later, the budget is a Manager's call — all of it
   * is noise in the mail announcing what Ops actually asked for.
   */
  notOps?: boolean;
};
export type BriefSection = { heading: string; rows: BriefRow[] };

/**
 * A real table, for data that is a table.
 *
 * The monthly lead plan used to be flattened into one line — "Jan 26: 100 ·
 * Feb 26: 120 · …" — which wrapped into an unreadable ribbon and was the
 * part of the brief people said they could not find. Twelve months with a
 * total is a table; rendering it as a sentence was the mistake.
 */
export type BriefTable = {
  heading: string;
  head: string[];
  body: string[][];
  /** A summary row, rendered in bold against a tinted background. */
  foot?: string[];
  /** Columns after the first are right-aligned, as figures should be. */
  numeric?: boolean;
};

/**
 * The landing page score, when one has been run.
 *
 * Looked up by request first, then by URL. The scorer is reachable from the
 * menu as well as from inside a request, and a run started from the menu
 * saves with no `request_id` — so matching on the request alone would show
 * nothing for the very score somebody had just taken.
 */
export type BriefLandingScore = {
  /** Already a percentage: 97 means 97 out of 100. */
  score: number;
  /** Weighted points earned, and available — what the percentage is of. */
  passed: number;
  maxPoints: number;
  grade: string;
  pageType: string;
  url: string;
  scoredAt: Date;
  categories: Array<{ name: string; score: number }>;
  /** True when it was matched on the URL rather than attached to the request. */
  matchedByUrl: boolean;
};

/** A KPI tile. The tone is the colour it is drawn in, not a judgement. */
export type BriefHighlight = {
  label: string;
  value: string;
  muted: boolean;
  /** Optional: the renderer falls back to a neutral tile with no glyph. */
  tone?: 'rose' | 'blue' | 'green' | 'violet' | 'amber';
  icon?: string;
};

/** The copy, final if one has been signed off and the latest draft if not. */
export type BriefAdCopy = {
  version: number;
  /** False when nobody has marked a version final yet. */
  isFinal: boolean;
  headlines: string[];
  descriptions: string[];
  sitelinks: Array<{ text: string; description1: string; description2: string }>;
  keywords: Array<{ keyword: string; volume: number }>;
};

export type RequestBrief = {
  reference: string;
  title: string;
  status: string;
  statusLabel: string;
  requesterEmail: string | null;
  requesterName: string | null;
  specialistEmail: string | null;
  specialistName: string | null;
  managerEmail: string | null;
  /** The three figures the flow turns on, for the strip at the top. */
  /** The line under the title: what, where, and what for. */
  subtitle: string[];
  /** Icon/label/value chips beside the status. */
  meta: Array<{ icon: string; label: string; value: string }>;
  /** Who raised it and who is building it. */
  ownership: Array<{ role: string; name: string }>;
  highlights: BriefHighlight[];
  /** Null until a version has been marked final. */
  adCopy: BriefAdCopy | null;
  /** Null until somebody has run the scorer for this page. */
  landingScore: BriefLandingScore | null;
  sections: BriefSection[];
  tables: BriefTable[];
};

async function landingScoreFor(
  requestId: string,
  landingPageUrl: string | null
): Promise<BriefLandingScore | null> {
  const select = {
    score: true,
    passed: true,
    maxPoints: true,
    grade: true,
    pageType: true,
    url: true,
    createdAt: true,
    categories: true,
  } as const;

  const own = await prisma.crmLandingScore.findFirst({
    where: { requestId },
    orderBy: { createdAt: 'desc' },
    select,
  });

  const row =
    own ??
    (landingPageUrl
      ? await prisma.crmLandingScore.findFirst({
          where: { url: { in: urlVariants(landingPageUrl), mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
          select,
        })
      : null);

  if (!row) return null;

  const categories = Array.isArray(row.categories)
    ? (row.categories as Array<{ name?: unknown; score?: unknown }>)
        .map((c) => ({ name: String(c?.name ?? ''), score: Number(c?.score ?? 0) }))
        .filter((c) => c.name)
    : [];

  return {
    score: row.score,
    passed: row.passed,
    maxPoints: row.maxPoints,
    grade: row.grade,
    pageType: row.pageType,
    url: row.url,
    scoredAt: row.createdAt,
    categories,
    matchedByUrl: !own,
  };
}

/**
 * Load a request and lay it out.
 *
 * Returns null when the request has vanished between the transition and the
 * mail — which can happen, and is not worth throwing over: the state change
 * already committed.
 */
export async function buildRequestBrief(
  requestId: string,
  opts: { onlyOpsFields?: boolean } = {}
): Promise<RequestBrief | null> {
  const r = await prisma.crmAdRequest.findUnique({
    where: { id: requestId },
    select: {
      reference: true,
      title: true,
      status: true,
      objective: true,
      trackingId: true,
      clientType: true,
      ageRestriction: true,
      productService: true,
      location: true,
      blockedLocations: true,
      startDate: true,
      focusedMonths: true,
      applicationDeadline: true,
      targetAdmission: true,
      targetApplication: true,
      performanceParameter: true,
      reportingPanel: true,
      accountVisibility: true,
      budget: true,
      requiredCpl: true,
      requiredLeads: true,
      landingPageUrl: true,
      adUrlKapplpDesktop: true,
      adUrlKapplpMobile: true,
      adUrlKapplpBing: true,
      adUrlClientlpDesktop: true,
      adUrlClientlpMobile: true,
      adUrlClientlpBing: true,
      usps: true,
      keywords: true,
      notes: true,
      createdBy: { select: { name: true, email: true } },
      adSpecialist: { select: { name: true, email: true } },
      accountManager: { select: { name: true, email: true } },
      account: { select: { descriptive_name: true } },
      leadTargets: { orderBy: { month: 'asc' }, select: { month: true, leads: true } },
      campaignLinks: { select: { campaign: { select: { name: true } } } },
      // The finished copy, so the launch mail carries what actually went
      // into Google rather than pointing at a screen.
      // Final first, then the newest draft. Showing only the final version
      // meant a mail carrying fifteen real headlines showed none of them
      // because nobody had pressed "Mark final" yet — and an empty card is
      // indistinguishable from no copy having been written.
      adCopyVersions: {
        orderBy: [{ isFinal: 'desc' }, { version: 'desc' }],
        take: 1,
        select: {
          version: true,
          isFinal: true,
          headlines: true,
          descriptions: true,
          sitelinks: true,
          keywords: true,
        },
      },
    },
  });
  if (!r) return null;

  const monthLabel = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);

  const planTotal = r.leadTargets.reduce((sum, t) => sum + t.leads, 0);
  const leadPlan: BriefTable | null = r.leadTargets.length
    ? {
        heading: 'Month-by-month lead target',
        head: ['Month', 'Leads', 'Share'],
        body: r.leadTargets.map((t) => [
          monthLabel(t.month),
          count(t.leads),
          planTotal > 0 ? `${Math.round((t.leads / planTotal) * 100)}%` : DASH,
        ]),
        foot: ['Total', count(planTotal), '100%'],
        numeric: true,
      }
    : null;

  const campaigns = r.campaignLinks
    .map((l) => l.campaign.name)
    .filter((n): n is string => Boolean(n));

  // Six destination fields usually hold the same URL. Printing it six times
  // is most of the mail's length and tells the reader nothing the first one
  // did, so identical destinations collapse into a single line naming them.
  const destinations: Array<[string, string | null]> = [
    ['KAPP desktop', r.adUrlKapplpDesktop],
    ['KAPP mobile', r.adUrlKapplpMobile],
    ['KAPP Bing', r.adUrlKapplpBing],
    ['Client desktop', r.adUrlClientlpDesktop],
    ['Client mobile', r.adUrlClientlpMobile],
    ['Client Bing', r.adUrlClientlpBing],
  ];
  const byUrl = new Map<string, string[]>();
  for (const [label, url] of destinations) {
    if (!url?.trim()) continue;
    const key = url.trim();
    byUrl.set(key, [...(byUrl.get(key) ?? []), label]);
  }
  const destinationRows: BriefRow[] = Array.from(byUrl.entries()).map(([url, labels]) => ({
    label: labels.length === destinations.length ? 'All destinations' : labels.join(', '),
    value: url,
    wide: true,
  }));

  const landing = await landingScoreFor(requestId, r.landingPageUrl);

  // Its own section, not a tile: the score only means something next to the
  // page it was taken on and the date it was taken, and a bare "97" beside
  // the budget would read as another figure somebody agreed.
  // Always present, even unscored. An absent section reads as "this app
  // does not check landing pages"; a section saying "not scored yet" reads
  // as a job somebody still has to do, which is what it is.
  const landingSection: BriefSection | null = !r.landingPageUrl
    ? null
    : landing
    ? {
        heading: 'Landing page score',
        rows: [
          // `score` is already a percentage — 136 of 140 weighted points is
          // 97%. Printing "97 of 140" put the percentage next to the raw
          // total and read as a score that had lost 43 points it never had.
          { label: 'Score', value: `${landing.score} / 100`, always: true },
          { label: 'Grade', value: landing.grade, always: true },
          {
            label: 'Weighted points',
            value: `${count(landing.passed)} of ${count(landing.maxPoints)}`,
          },
          ...landing.categories.map((c) => ({
            label: c.name,
            value: `${Math.round(c.score)}%`,
          })),
          { label: 'Page type', value: text(landing.pageType) },
          { label: 'Scored on', value: date(landing.scoredAt) },
          {
            label: landing.matchedByUrl ? 'Page scored (matched by URL)' : 'Page scored',
            value: landing.url,
            wide: true,
          },
        ],
      }
    : {
        heading: 'Landing page score',
        rows: [
          {
            label: 'Score',
            value: 'Not scored yet',
            always: true,
          },
          {
            label: 'Grade',
            value: DASH,
            always: true,
          },
          {
            label: 'Page to score',
            value: r.landingPageUrl,
            wide: true,
          },
        ],
      };

  const sections: BriefSection[] = [
    {
      heading: 'Campaign',
      rows: [
        { label: 'Tracking ID', value: text(r.trackingId) },
        {
          label: 'Client type',
          value: r.clientType ? (CLIENT_TYPE_LABELS[r.clientType] ?? r.clientType) : DASH,
        },
        {
          label: 'Objective',
          value: OBJECTIVE_LABELS[r.objective] ?? r.objective,
          notOps: true,
        },
        { label: 'Google Ads account', value: text(r.account?.descriptive_name), notOps: true },
        // "Courses", matching the requirement form's own label for this
        // field. The mail calling it something else made two people
        // describing the same box use different words for it.
        { label: 'Courses', value: text(r.productService), wide: true },
        { label: 'Campaigns', value: campaigns.join(', ') || DASH, notOps: true },
        { label: 'Performance parameter', value: text(r.performanceParameter) },
      ],
    },
    {
      heading: 'Targeting and timing',
      rows: [
        { label: 'Location', value: text(r.location) },
        { label: 'Blocked locations', value: text(r.blockedLocations) },
        {
          label: 'Age restriction',
          value: r.ageRestriction ? (AGE_LABELS[r.ageRestriction] ?? r.ageRestriction) : DASH,
        },
        { label: 'Start date', value: date(r.startDate) },
        { label: 'Focused months', value: text(r.focusedMonths) },
        { label: 'Application deadline', value: text(r.applicationDeadline) },
      ],
    },
    {
      // Budget, CPL and required leads are in the strip at the top; repeating
      // them here was a third of this section for no new information.
      heading: 'Targets',
      rows: [
        { label: 'Target application', value: count(r.targetApplication) },
        { label: 'Target admission', value: text(r.targetAdmission) },
      ],
    },
    { heading: 'Destinations', rows: destinationRows },
    ...(landingSection ? [landingSection] : []),
    {
      heading: 'Notes',
      rows: [
        { label: 'Reporting panel', value: text(r.reportingPanel) },
        { label: 'Account visibility', value: text(r.accountVisibility) },
        { label: 'USPs and offers', value: text(r.usps), wide: true, notOps: true },
        { label: 'Keywords', value: text(r.keywords), wide: true, notOps: true },
        { label: 'Other notes', value: text(r.notes), wide: true },
      ],
    },
  ];

  // The mail announcing what Operations asked for shows what Operations
  // typed, and nothing else: an "Assigned budget —" tile reads as an
  // omission on their part rather than a decision nobody has taken yet.
  const visibleSections = opts.onlyOpsFields
    ? sections
        .map((sec) => ({ ...sec, rows: sec.rows.filter((row) => !row.notOps) }))
        .filter((sec) => sec.rows.length > 0)
    : sections;

  // Five tiles, in the order someone reads a plan: what it costs, how many
  // leads that buys, at what price each, and what those turn into. `ops`
  // marks the ones Operations fills in — the rest are a Manager's decision
  // and are left off the mail that announces what Ops asked for.
  const allHighlights: Array<BriefHighlight & { ops: boolean }> = [
    { label: 'Assigned budget', value: rupees(r.budget), muted: r.budget === null, tone: 'rose', icon: '\u{1F4B0}', ops: false },
    // "Required", not "Target": that is what the requirement form calls
    // these, and a mail that renames a field makes two people quoting the
    // same number describe different things.
    { label: 'Required leads', value: count(r.requiredLeads), muted: r.requiredLeads === null, tone: 'blue', icon: '\u{1F3AF}', ops: true },
    { label: 'Required CPL', value: rupees(r.requiredCpl), muted: r.requiredCpl === null, tone: 'green', icon: '\u{1F465}', ops: false },
    { label: 'Target applications', value: count(r.targetApplication), muted: r.targetApplication === null, tone: 'violet', icon: '\u{1F4C4}', ops: true },
    { label: 'Target admissions', value: text(r.targetAdmission), muted: !r.targetAdmission, tone: 'amber', icon: '\u{1F393}', ops: true },
  ];

  const finalCopy = r.adCopyVersions[0];
  const assetText = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((a) => String((a as { text?: unknown })?.text ?? '')).filter(Boolean)
      : [];

  const adCopy: BriefAdCopy | null = finalCopy
    ? {
        version: finalCopy.version,
        isFinal: finalCopy.isFinal,
        headlines: assetText(finalCopy.headlines),
        descriptions: assetText(finalCopy.descriptions),
        sitelinks: Array.isArray(finalCopy.sitelinks)
          ? (finalCopy.sitelinks as Array<Record<string, unknown>>).map((sl) => ({
              text: String(sl?.text ?? ''),
              description1: String(sl?.description1 ?? ''),
              description2: String(sl?.description2 ?? ''),
            }))
          : [],
        keywords: Array.isArray(finalCopy.keywords)
          ? (finalCopy.keywords as Array<Record<string, unknown>>).map((k) => ({
              keyword: String(k?.keyword ?? ''),
              volume: Number(k?.volume ?? 0),
            }))
          : [],
      }
    : null;

  return {
    reference: r.reference,
    title: r.title,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] ?? r.status,
    requesterEmail: r.createdBy.email,
    requesterName: r.createdBy.name,
    specialistEmail: r.adSpecialist?.email ?? null,
    specialistName: r.adSpecialist?.name ?? null,
    managerEmail: r.accountManager?.email ?? null,
    subtitle: [text(r.productService), text(r.location), OBJECTIVE_LABELS[r.objective] ?? r.objective]
      .filter((v) => v && v !== DASH),
    meta: [
      { icon: '\u{1F4C5}', label: 'Start date', value: date(r.startDate) },
      { icon: '\u{1F4CD}', label: 'Location', value: text(r.location) },
      {
        icon: '\u{1F465}',
        label: 'Age',
        value: r.ageRestriction ? (AGE_LABELS[r.ageRestriction] ?? r.ageRestriction) : DASH,
      },
    ].filter((m) => m.value !== DASH),
    ownership: [
      { role: 'Raised by', name: r.createdBy.name || r.createdBy.email },
      ...(r.adSpecialist ? [{ role: 'Ad Specialist', name: r.adSpecialist.name }] : []),
      ...(r.account?.descriptive_name && !opts.onlyOpsFields
        ? [{ role: 'Google Ads account', name: r.account.descriptive_name }]
        : []),
    ],
    highlights: (opts.onlyOpsFields ? allHighlights.filter((h) => h.ops) : allHighlights).map(
      ({ label, value, muted, tone, icon }) => ({ label, value, muted, tone, icon })
    ),
    // Only once the copy is signed off, and never on the Ops mail — there
    // is no copy yet when the requirement is raised.
    adCopy: opts.onlyOpsFields ? null : adCopy,
    landingScore: landing,
    sections: visibleSections,
    // Ops fills this in on the requirement form, so it belongs in the first
    // mail too — it is the only part of the brief that says *when* the
    // leads are wanted, and it had been marked as a non-Ops field and
    // dropped from exactly the mail that announces what Ops asked for.
    tables: leadPlan ? [leadPlan] : [],
  };
}
