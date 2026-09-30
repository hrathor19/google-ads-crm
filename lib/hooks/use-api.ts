'use client';

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

/**
 * Thin fetch wrapper for the app's own API.
 *
 * Surfaces the server's `error` string rather than "Failed to fetch", so a 403
 * from the permission layer reaches the toast as the sentence the guard wrote.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as
      | { error?: string; detail?: unknown }
      | null;
    throw new Error(parsed?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function useApi<T>(
  key: unknown[],
  path: string,
  options: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'> = {}
) {
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: () => apiGet<T>(path),
    ...options,
  });
}
