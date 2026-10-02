/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next dev` and `next build` both write into `.next`, so building while the
  // dev server is up makes the build read half-written manifests and fail with
  // "Cannot find module for page". Setting this lets a verification build run
  // beside a live dev server without disturbing it.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
    // The Google Ads SDK and the landing-page scraper are server-only and pull
    // in Node built-ins; keeping them external stops Next from bundling them
    // into the server chunks (and makes it impossible for them to leak into
    // the client bundle).
    serverComponentsExternalPackages: ['google-ads-api', 'cheerio'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Blocks the app from being embedded in an iframe (clickjacking)
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stops browsers guessing content types (MIME sniffing)
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Never leak internal URLs to other sites
          { key: 'Referrer-Policy', value: 'same-origin' },
          // The app never needs these browser capabilities
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
