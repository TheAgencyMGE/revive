import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * Security headers applied to every response. Revive renders untrusted
 * repository content (file names, diffs, build logs), so the CSP is
 * deliberately strict and there is no dangerouslySetInnerHTML anywhere.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next injects inline bootstrap scripts; styles come from Tailwind's runtime layer.
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin tracing to this project so a lockfile in a parent directory is ignored.
  outputFileTracingRoot: path.resolve(__dirname),
  poweredByHeader: false,
  outputFileTracingIncludes: { '/api/**/*': ['./prisma/**/*'] },
  serverExternalPackages: ['@prisma/client', 'archiver'],
  eslint: { ignoreDuringBuilds: false, dirs: ['src'] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
