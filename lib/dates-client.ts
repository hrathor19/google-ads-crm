/**
 * Date-range presets for the global picker. Client-safe (no DB access).
 *
 * The ranges end *yesterday*, not today: the sync stores complete days, so
 * including today would show a partial day next to whole ones and make every
 * period-over-period comparison read as a collapse.
 */

export type RangePreset = {
  key: string;
  label: string;
  days: number;
  /**
   * How many days before the anchor the window ends. 0 for every rolling
   * preset; 1 for "Yesterday", which is the only one that stops short of the
   * most recent day.
   */
  offsetDays?: number;
};

export const RANGE_PRESETS: RangePreset[] = [
  // "Today" is the latest day with data, not the wall-clock date — the same
  // anchor every other preset uses. The current calendar day is still
  // accumulating and is usually not synced at all, so pointing these at it
  // would show an empty screen rather than the day someone wants to see.
  { key: 'today', label: 'Today', days: 1, offsetDays: 0 },
  { key: 'yesterday', label: 'Yesterday', days: 1, offsetDays: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '14d', label: 'Last 14 days', days: 14 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '180d', label: 'Last 6 months', days: 180 },
  { key: '365d', label: 'Last 12 months', days: 365 },
  { key: 'all', label: 'All time', days: 3650 },
];

export const DEFAULT_PRESET = '30d';

export function presetDays(key: string): number {
  return RANGE_PRESETS.find((p) => p.key === key)?.days ?? 30;
}

export function presetOffset(key: string): number {
  return RANGE_PRESETS.find((p) => p.key === key)?.offsetDays ?? 0;
}

export function presetLabel(key: string): string {
  return RANGE_PRESETS.find((p) => p.key === key)?.label ?? 'Custom range';
}
