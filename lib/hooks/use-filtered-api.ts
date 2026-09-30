'use client';

import { useFilters } from '@/components/providers/filters-provider';
import { useApi } from './use-api';
import type { UseQueryOptions } from '@tanstack/react-query';

/**
 * A query that re-runs when the global account/date filter changes.
 *
 * The filter is part of the query key, so switching accounts shows that
 * account's cached data instantly rather than the previous account's numbers
 * under the new name.
 */
export function useFilteredApi<T>(
  key: string,
  path: string,
  extra: Record<string, string | number | null | undefined> = {},
  options: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'> = {}
) {
  const filters = useFilters();
  const qs = filters.queryString(extra);
  return useApi<T>([key, qs], `${path}?${qs}`, options);
}
