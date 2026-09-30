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
  title: 'KollegeApply Ads CRM',
  description: 'Google Ads performance, ad request workflow and role-based access for KollegeApply',
  // The same mark Counselling CRM uses, so the two apps read as one product.
  // Declared here rather than via app/icon.* because that file convention
  // overrides the whole `icons` object.
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
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
