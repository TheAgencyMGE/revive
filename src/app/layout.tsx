import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: {
    default: 'Revive — bring abandoned repositories back to life',
    template: '%s · Revive',
  },
  description:
    'Paste an abandoned GitHub repository. Revive reconstructs the environment it originally ran in, diagnoses why it broke, applies the smallest repairs that work, and proves the result builds.',
  applicationName: 'Revive',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0c1017',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Theme is applied before first paint by an inline script so a reload never
 * flashes the wrong palette. Dark is the default; the choice persists locally.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('revive-theme');
    if (stored === 'light') document.documentElement.classList.add('light');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-brass focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:tracking-label focus:text-ground"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
