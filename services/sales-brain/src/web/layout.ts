import { html, type RawHtml } from './html.js';
import type { SessionUser } from '../domain/auth.js';
import { pageHeader, renderShell, renderLogin, type NavCounts } from './components/shell.js';

/**
 * Compatibility layer over the CRM AppShell.
 * Existing pages call `renderPage`; it now composes AppShell + PageHeader so the
 * whole product picks up the shared shell without rewriting every page at once
 * (CRM addendum §7: "Existing working routes may be refactored into this order
 * rather than rewritten from scratch").
 */

export interface LayoutOptions {
  title: string;
  subtitle?: string | RawHtml;
  user: SessionUser;
  currentPath: string;
  counts?: NavCounts;
  actions?: RawHtml;
  status?: RawHtml;
  breadcrumbs?: { href: string; label: string }[];
  body: RawHtml;
  script?: RawHtml;
  overlays?: RawHtml;
}

export function renderPage(options: LayoutOptions): string {
  const header = pageHeader({
    title: options.title,
    subtitle: options.subtitle ?? null,
    status: options.status ?? null,
    // Existing pages pass a single `actions` block; the shell renders it on the right.
    primaryAction: options.actions ?? null,
    breadcrumbs: options.breadcrumbs ?? [],
  });

  return renderShell({
    title: options.title,
    user: options.user,
    currentPath: options.currentPath,
    counts: options.counts ?? {},
    header,
    body: options.body,
    script: options.script ?? null,
    overlays: options.overlays ?? null,
  });
}

export { renderLogin, pageHeader, html };
export type { NavCounts };
