import 'server-only';
import { prisma } from '@/lib/prisma';
import { STATUS_LABELS } from '@/lib/workflow/state-machine';

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
  highlights: Array<{ label: string; value: string; muted: boolean }>;
  sections: BriefSection[];
};

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
    },
  });
  if (!r) return null;

  const monthly = r.leadTargets
    .map(
      (t) =>
        `${new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(t.month)}: ${t.leads}`
    )
    .join(' · ');

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
        { label: 'Product / service', value: text(r.productService), wide: true },
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
        { label: 'Monthly lead targets', value: monthly || DASH, wide: true, notOps: true },
      ],
    },
    { heading: 'Destinations', rows: destinationRows },
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
    {
      heading: 'People',
      rows: [
        // The intro already names who raised it, and nobody is assigned
        // yet, so the whole section is noise on the first mail.
        { label: 'Raised by', value: r.createdBy.name || r.createdBy.email, always: true, notOps: true },
        { label: 'Ad Specialist', value: r.adSpecialist?.name ?? DASH, always: true, notOps: true },
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

  const allHighlights = [
    { label: 'Assigned budget', value: rupees(r.budget), muted: r.budget === null, ops: false },
    { label: 'Required CPL', value: rupees(r.requiredCpl), muted: r.requiredCpl === null, ops: false },
    { label: 'Required leads', value: count(r.requiredLeads), muted: r.requiredLeads === null, ops: true },
  ];

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
    highlights: (opts.onlyOpsFields ? allHighlights.filter((h) => h.ops) : allHighlights).map(
      ({ label, value, muted }) => ({ label, value, muted })
    ),
    sections: visibleSections,
  };
}
