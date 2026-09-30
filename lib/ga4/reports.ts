import 'server-only';
import { runReport, ga4Configured } from './client';

/**
 * The GA4 report set the brief asks for: traffic, sources/mediums, landing
 * pages, engagement, conversions, audience, devices and geo.
 *
 * Every report is one `runReport` call with the dimensions and metrics that
 * section needs. They run in parallel because the API bills per request, not
 * per second, and eight sequential round-trips would make the page feel broken.
 */

export type Ga4Section = {
  key: string;
  label: string;
  dimensionLabel: string;
  columns: string[];
  rows: Array<{ label: string; values: number[] }>;
  totals: number[];
};

export type Ga4Overview = {
  configured: boolean;
  /** Present only when `configured` is false — what to set, names only. */
  missing?: string[];
  range?: { start: string; end: string };
  summary?: {
    activeUsers: number;
    newUsers: number;
    sessions: number;
    engagedSessions: number;
    engagementRate: number | null;
    averageSessionDuration: number | null;
    screenPageViews: number;
    conversions: number;
    bounceRate: number | null;
  };
  timeseries?: Array<{ date: string; activeUsers: number; sessions: number; conversions: number }>;
  sections?: Ga4Section[];
};

const CORE_METRICS = [
  'activeUsers',
  'newUsers',
  'sessions',
  'engagedSessions',
  'engagementRate',
  'averageSessionDuration',
  'screenPageViews',
  'conversions',
  'bounceRate',
] as const;

function toSection(
  key: string,
  label: string,
  dimensionLabel: string,
  columns: string[],
  report: Awaited<ReturnType<typeof runReport>>
): Ga4Section {
  return {
    key,
    label,
    dimensionLabel,
    columns,
    rows: report.rows.map((r) => ({
      label: r.dimensions.join(' / ') || '(not set)',
      values: r.metrics,
    })),
    totals: report.totals,
  };
}

export async function buildGa4Overview(params: {
  startDate: string;
  endDate: string;
}): Promise<Ga4Overview> {
  if (!ga4Configured()) {
    return {
      configured: false,
      missing: ['GA4_PROPERTY_ID', 'GA4_CLIENT_EMAIL', 'GA4_PRIVATE_KEY'],
    };
  }

  const { startDate, endDate } = params;
  const range = { startDate, endDate };

  const [summary, daily, sources, landingPages, devices, geo, audience, pages] = await Promise.all([
    runReport({ ...range, dimensions: [], metrics: [...CORE_METRICS], limit: 1 }),
    runReport({
      ...range,
      dimensions: ['date'],
      metrics: ['activeUsers', 'sessions', 'conversions'],
      limit: 400,
    }),
    runReport({
      ...range,
      dimensions: ['sessionSource', 'sessionMedium'],
      metrics: ['sessions', 'activeUsers', 'engagementRate', 'conversions'],
      orderByMetric: 'sessions',
      limit: 25,
    }),
    runReport({
      ...range,
      dimensions: ['landingPage'],
      metrics: ['sessions', 'activeUsers', 'bounceRate', 'conversions'],
      orderByMetric: 'sessions',
      limit: 25,
    }),
    runReport({
      ...range,
      dimensions: ['deviceCategory'],
      metrics: ['sessions', 'activeUsers', 'engagementRate', 'conversions'],
      orderByMetric: 'sessions',
      limit: 10,
    }),
    runReport({
      ...range,
      dimensions: ['country', 'city'],
      metrics: ['sessions', 'activeUsers', 'conversions'],
      orderByMetric: 'sessions',
      limit: 25,
    }),
    runReport({
      ...range,
      dimensions: ['newVsReturning'],
      metrics: ['activeUsers', 'sessions', 'engagementRate'],
      limit: 5,
    }),
    runReport({
      ...range,
      dimensions: ['pagePath'],
      metrics: ['screenPageViews', 'activeUsers', 'userEngagementDuration'],
      orderByMetric: 'screenPageViews',
      limit: 25,
    }),
  ]);

  const t = summary.totals;
  const value = (i: number) => t[i] ?? 0;

  return {
    configured: true,
    range: { start: startDate, end: endDate },
    summary: {
      activeUsers: value(0),
      newUsers: value(1),
      sessions: value(2),
      engagedSessions: value(3),
      engagementRate: t[4] ?? null,
      averageSessionDuration: t[5] ?? null,
      screenPageViews: value(6),
      conversions: value(7),
      bounceRate: t[8] ?? null,
    },
    timeseries: daily.rows
      .map((r) => ({
        // GA4 returns `YYYYMMDD`; the charts want an ISO day.
        date: `${r.dimensions[0]?.slice(0, 4)}-${r.dimensions[0]?.slice(4, 6)}-${r.dimensions[0]?.slice(6, 8)}`,
        activeUsers: r.metrics[0] ?? 0,
        sessions: r.metrics[1] ?? 0,
        conversions: r.metrics[2] ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    sections: [
      toSection('sources', 'Traffic sources', 'Source / medium',
        ['Sessions', 'Users', 'Engagement rate', 'Conversions'], sources),
      toSection('landingPages', 'Landing pages', 'Landing page',
        ['Sessions', 'Users', 'Bounce rate', 'Conversions'], landingPages),
      toSection('pages', 'Engagement by page', 'Page path',
        ['Views', 'Users', 'Engagement time (s)'], pages),
      toSection('devices', 'Devices', 'Device',
        ['Sessions', 'Users', 'Engagement rate', 'Conversions'], devices),
      toSection('geo', 'Geography', 'Country / city',
        ['Sessions', 'Users', 'Conversions'], geo),
      toSection('audience', 'Audience', 'New vs returning',
        ['Users', 'Sessions', 'Engagement rate'], audience),
    ],
  };
}
