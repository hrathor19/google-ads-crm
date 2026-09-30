'use client';

import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Suspense, useState } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Google Ads data is synced, not live, so a short cache costs
            // nothing in freshness and saves re-querying 60k keywords every
            // time someone switches tabs.
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="ads-crm-theme">
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={200}>
            {/* The filters provider reads useSearchParams, which needs a
                Suspense boundary to keep the rest of the tree from opting the
                whole app into dynamic rendering. */}
            <Suspense fallback={null}>{children}</Suspense>
          </TooltipProvider>
          <Toaster />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
