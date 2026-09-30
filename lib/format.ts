/**
 * Display formatting. Shared by every table, tile and chart so the same number
 * never renders two different ways on two screens.
 *
 * `null` means "not measurable", not zero — a campaign with no impressions has
 * no CTR, and printing "0.00%" would read as a measured failure rather than an
 * absence. Every formatter renders that as an em dash.
 */

const DASH = '—';

let currencyCode = 'INR';

/** Set once from the account data; the MCC's accounts are all one currency. */
export function setCurrency(code: string | null | undefined): void {
  if (code) currencyCode = code;
}

export function getCurrency(): string {
  return currencyCode;
}

export function formatCurrency(
  value: number | null | undefined,
  opts: { compact?: boolean; code?: string } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: opts.code ?? currencyCode,
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.compact ? 1 : value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatNumber(
  value: number | null | undefined,
  opts: { compact?: boolean; decimals?: number } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return new Intl.NumberFormat('en-IN', {
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.decimals ?? (opts.compact ? 1 : 0),
  }).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  opts: { decimals?: number } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${(value * 100).toFixed(opts.decimals ?? 2)}%`;
}

/** A signed delta for period-over-period comparisons. */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return DASH;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return DASH;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return DASH;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return DASH;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return 'never';
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

/** For a metric where a rise is good (clicks) vs one where a fall is (CPC). */
export function deltaTone(
  delta: number | null | undefined,
  direction: 'up-good' | 'down-good' = 'up-good'
): 'positive' | 'negative' | 'neutral' {
  if (delta === null || delta === undefined || Math.abs(delta) < 0.001) return 'neutral';
  const good = direction === 'up-good' ? delta > 0 : delta < 0;
  return good ? 'positive' : 'negative';
}

export const EM_DASH = DASH;
