import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { assertRequiredEnv } from '@/lib/env';

const inter = Inter({ subsets: ['latin'] });

// Fails the first render with a readable list rather than a null-pointer three
// layers down when a deploy is missing a variable.
assertRequiredEnv();

export const metadata: Metadata = {
  title: 'Google Ads CRM',
  description: 'Google Ads performance, ad request workflow and role-based access for KollegeApply',
  // app/icon.svg is picked up by the file convention; naming it here as well
  // stops the browser probing /favicon.ico and 404ing.
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0d2455',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
