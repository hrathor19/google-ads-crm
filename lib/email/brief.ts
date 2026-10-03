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

export type BriefSection = { heading: string; rows: Array<[string, string]> };

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
export async function buildRequestBrief(requestId: string): Promise<RequestBrief | null> {
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

  const sections: BriefSection[] = [
    {
      heading: 'Campaign',
      rows: [
        ['Tracking ID', text(r.trackingId)],
        ['Client type', r.clientType ? (CLIENT_TYPE_LABELS[r.clientType] ?? r.clientType) : DASH],
        ['Product / service', text(r.productService)],
        ['Objective', OBJECTIVE_LABELS[r.objective] ?? r.objective],
        ['Google Ads account', text(r.account?.descriptive_name)],
        ['Campaigns', campaigns.length ? campaigns.join(', ') : DASH],
      ],
    },
    {
      heading: 'Targeting',
      rows: [
        ['Location', text(r.location)],
        ['Blocked locations', text(r.blockedLocations)],
        [
          'Age restriction',
          r.ageRestriction ? (AGE_LABELS[r.ageRestriction] ?? r.ageRestriction) : DASH,
        ],
      ],
    },
    {
      heading: 'Timing',
      rows: [
        ['Start date', date(r.startDate)],
        ['Focused months', text(r.focusedMonths)],
        ['Application deadline', text(r.applicationDeadline)],
      ],
    },
    {
      // The step-10 decision. Blank until a Manager makes it, which is the
      // difference between the first mail and every one after it.
      heading: 'Budget and targets',
      rows: [
        ['Assigned budget', rupees(r.budget)],
        ['Required CPL', rupees(r.requiredCpl)],
        ['Required leads', count(r.requiredLeads)],
        ['Target application', count(r.targetApplication)],
        ['Target admission', text(r.targetAdmission)],
        ['Monthly lead targets', monthly || DASH],
        ['Performance parameter', text(r.performanceParameter)],
      ],
    },
    {
      heading: 'Destinations',
      rows: [
        ['KAPP LP — desktop', text(r.adUrlKapplpDesktop)],
        ['KAPP LP — mobile', text(r.adUrlKapplpMobile)],
        ['KAPP LP — Bing', text(r.adUrlKapplpBing)],
        ['Client LP — desktop', text(r.adUrlClientlpDesktop)],
        ['Client LP — mobile', text(r.adUrlClientlpMobile)],
        ['Client LP — Bing', text(r.adUrlClientlpBing)],
      ],
    },
    {
      heading: 'Notes',
      rows: [
        ['USPs and offers', text(r.usps)],
        ['Keywords', text(r.keywords)],
        ['Reporting panel', text(r.reportingPanel)],
        ['Account visibility', text(r.accountVisibility)],
        ['Other notes', text(r.notes)],
      ],
    },
    {
      heading: 'People',
      rows: [
        ['Raised by', r.createdBy.name || r.createdBy.email],
        ['Manager', r.accountManager?.name ?? DASH],
        ['Ad Specialist', r.adSpecialist?.name ?? DASH],
      ],
    },
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
    highlights: [
      { label: 'Assigned budget', value: rupees(r.budget), muted: r.budget === null },
      { label: 'Required CPL', value: rupees(r.requiredCpl), muted: r.requiredCpl === null },
      { label: 'Required leads', value: count(r.requiredLeads), muted: r.requiredLeads === null },
    ],
    sections,
  };
}
