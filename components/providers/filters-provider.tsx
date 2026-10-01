'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_PRESET, presetDays, presetOffset } from '@/lib/dates-client';

/**
 * The global account + date-window filter shown in the top bar.
 *
 * State lives in the URL rather than in React state, so a filtered view is a
 * link someone can send to a colleague, the back button behaves, and a refresh
 * doesn't silently reset the window under a number the user was reading.
 */

type FiltersValue = {
  accountId: number | null;
  preset: string;
  days: number;
  /** Days the window stops short of the latest synced day ("Yesterday"). */
  offset: number;
  start: string | null;
  end: string | null;
  setAccount: (id: number | null) => void;
  setPreset: (key: string) => void;
  setCustomRange: (start: string, end: string) => void;
  /** The filter as a query string, for API calls. */
  queryString: (extra?: Record<string, string | number | null | undefined>) => string;
};

const FiltersContext = createContext<FiltersValue | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const accountParam = params.get('account');
  const accountId = accountParam && accountParam !== 'all' ? Number(accountParam) : null;
  const start = params.get('start');
  const end = params.get('end');
  const preset = start && end ? 'custom' : (params.get('range') ?? DEFAULT_PRESET);

  const push = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(params.toString());
      mutate(sp);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  const value = useMemo<FiltersValue>(() => {
    const days = preset === 'custom' ? 0 : presetDays(preset);
    const offset = preset === 'custom' ? 0 : presetOffset(preset);
    return {
      accountId,
      preset,
      days,
      offset,
      start,
      end,
      setAccount: (id) =>
        push((sp) => {
          if (id === null) sp.delete('account');
          else sp.set('account', String(id));
        }),
      setPreset: (key) =>
        push((sp) => {
          sp.set('range', key);
          sp.delete('start');
          sp.delete('end');
        }),
      setCustomRange: (s, e) =>
        push((sp) => {
          sp.set('start', s);
          sp.set('end', e);
          sp.delete('range');
        }),
      queryString: (extra = {}) => {
        const sp = new URLSearchParams();
        if (accountId !== null) sp.set('accountId', String(accountId));
        if (start && end) {
          sp.set('start', start);
          sp.set('end', end);
        } else {
          sp.set('days', String(days));
          // Only sent when it means something, so every existing URL and
          // cached query key stays byte-identical.
          if (offset > 0) sp.set('offset', String(offset));
        }
        for (const [k, v] of Object.entries(extra)) {
          if (v !== null && v !== undefined && v !== '') sp.set(k, String(v));
        }
        return sp.toString();
      },
    };
  }, [accountId, preset, start, end, push]);

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters(): FiltersValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside a FiltersProvider.');
  return ctx;
}
