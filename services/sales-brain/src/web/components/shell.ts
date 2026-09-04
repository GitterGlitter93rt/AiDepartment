import { html, raw, type RawHtml } from '../html.js';
import type { SessionUser } from '../../domain/auth.js';
import { isManager } from '../../domain/auth.js';

/**
 * AppShell, SidebarNav, TopUtilityBar and PageHeader.
 * Authority: YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §3,
 * yad-sales-crm-component-contract.v1.yaml, yad-sales-crm-page-manifest.v1.yaml.
 *
 * Navigation is filtered from server-side permissions, not hidden with CSS: a nav
 * item a role may not use is never rendered, and the route refuses it anyway.
 */

export interface NavCounts {
  myProspects?: number;
  followUpsDue?: number;
  replies?: number;
  opportunities?: number;
  meetings?: number;
}

interface NavItem {
  href: string;
  label: string;
  count?: number | undefined;
  /** Renders the count in amber when it represents something overdue. */
  attention?: boolean;
}

interface NavGroup {
  section: string;
  items: NavItem[];
}

function navGroups(user: SessionUser, counts: NavCounts): NavGroup[] {
  const groups: NavGroup[] = [
    {
      section: 'Work',
      items: [
        { href: '/', label: 'Overview' },
        { href: '/find', label: 'Find Prospects' },
        { href: '/markets', label: 'Markets' },
        { href: '/prospects', label: 'My Prospects', count: counts.myProspects },
        { href: '/follow-ups', label: 'Follow-Ups', count: counts.followUpsDue, attention: true },
        { href: '/replies', label: 'Replies', count: counts.replies, attention: true },
        { href: '/opportunities', label: 'Opportunities', count: counts.opportunities },
        { href: '/meetings', label: 'Meetings', count: counts.meetings },
      ],
    },
  ];

  if (isManager(user.role) || user.role === 'RESEARCH_OPS') {
    groups.push({
      section: 'AI / Operations',
      items: [
        ...(isManager(user.role) ? [{ href: '/ai/pilot', label: 'Sales AI Pilot' }] : []),
        { href: '/mining', label: 'Mining' },
        { href: '/research-health', label: 'Research Health' },
        { href: '/imports', label: 'Imports' },
        ...(isManager(user.role) ? [
          { href: '/campaigns', label: 'Campaigns' },
          { href: '/analytics', label: 'Analytics' },
        ] : []),
      ],
    });
  }

  if (isManager(user.role)) {
    groups.push({
      section: 'Admin',
      items: [
        { href: '/team', label: 'Team & Ownership' },
        { href: '/settings', label: 'Settings' },
      ],
    });
  }

  return groups;
}

/** Mobile bottom bar prioritizes the rep core (§3 Mobile). */
const MOBILE_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/find', label: 'Find' },
  { href: '/prospects', label: 'Mine' },
  { href: '/follow-ups', label: 'Follow-Up' },
];

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

const ROLE_LABELS: Record<string, string> = {
  SALES_REP: 'Sales Rep', SALES_MANAGER: 'Sales Manager',
  RESEARCH_OPS: 'Research Ops', ADMIN: 'Admin',
};

function isCurrent(href: string, path: string): boolean {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}

export interface PageHeaderOptions {
  title: string;
  subtitle?: string | RawHtml | null;
  status?: RawHtml | null;
  primaryAction?: RawHtml | null;
  secondaryActions?: RawHtml | null;
  breadcrumbs?: { href: string; label: string }[];
}

/** One clear primary action by default (component contract). */
export function pageHeader(options: PageHeaderOptions): RawHtml {
  return html`<header class="page-header">
    <div class="page-header-main">
      ${options.breadcrumbs && options.breadcrumbs.length > 0 ? html`
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          ${options.breadcrumbs.map((crumb, index) => html`${
            index > 0 ? html`<span class="crumb-sep" aria-hidden="true">/</span>` : ''
          }<a href="${crumb.href}">${crumb.label}</a>`)}
        </nav>` : ''}
      <div class="row" style="gap:10px;align-items:center">
        <h1>${options.title}</h1>
        ${options.status ?? ''}
      </div>
      ${options.subtitle ? html`<p class="page-subtitle">${options.subtitle}</p>` : ''}
    </div>
    <div class="page-header-actions">
      ${options.secondaryActions ?? ''}
      ${options.primaryAction ?? ''}
    </div>
  </header>`;
}

export interface AppShellOptions {
  title: string;
  user: SessionUser;
  currentPath: string;
  counts?: NavCounts;
  header: RawHtml;
  body: RawHtml;
  /** Trusted per-page script. */
  script?: RawHtml | null;
  /** Extra markup appended to the modal layer. */
  overlays?: RawHtml | null;
}

export function renderShell(options: AppShellOptions): string {
  const { title, user, currentPath, counts = {}, header, body, script, overlays } = options;

  const sidebar = navGroups(user, counts).map((group) => html`
    <div class="nav-section">${group.section}</div>
    ${group.items.map((item) => html`
      <a class="nav-link" href="${item.href}"${raw(isCurrent(item.href, currentPath) ? ' aria-current="page"' : '')}>
        <span>${item.label}</span>
        ${item.count ? html`<span class="count${item.attention ? ' count-attention' : ''}">${item.count}</span>` : ''}
      </a>`)}
  `);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeText(title)} · YAD Sales</title>
<link rel="stylesheet" href="/assets/portal.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%232563EB'/><text x='16' y='22' font-family='sans-serif' font-size='15' font-weight='bold' fill='white' text-anchor='middle'>Y</text></svg>">
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="app">
  <nav class="nav" aria-label="Main navigation">
    <a class="brand" href="/">
      <span class="brand-mark">YAD</span>
      <span class="brand-text"><strong>Sales</strong><span>Your AI Department</span></span>
    </a>
    <div class="nav-scroll">${sidebar.join('')}</div>
    <div class="nav-footer">
      <div class="nav-user">
        <span class="avatar">${initials(user.displayName)}</span>
        <span class="nav-user-meta">
          <strong>${escapeText(user.displayName)}</strong>
          <span>${ROLE_LABELS[user.role] ?? user.role}</span>
        </span>
      </div>
      <form method="post" action="/logout">
        <button class="nav-signout" type="submit">Sign out</button>
      </form>
    </div>
  </nav>

  <div class="main">
    <div class="utility-bar">
      <form class="global-search" method="get" action="/search" role="search">
        <input type="search" name="q" placeholder="Search company, person, phone, email or city"
               aria-label="Search accounts" autocomplete="off">
      </form>
      <div class="utility-actions">
        <a class="btn btn-secondary btn-sm" href="/find">Find Prospects</a>
      </div>
    </div>
    <main id="main-content">
      ${header.value}
      <div class="page-body">${body.value}</div>
    </main>
  </div>
</div>

<nav class="mobile-nav" aria-label="Primary">
  ${MOBILE_ITEMS.map((item) => `<a href="${item.href}"${isCurrent(item.href, currentPath) ? ' aria-current="page"' : ''}>${item.label}</a>`).join('')}
  <a href="/markets">More</a>
</nav>

<div class="toast-host" id="toasts" aria-live="polite"></div>
<div class="drawer-scrim" id="drawer-scrim"></div>
<aside class="drawer" id="drawer" aria-label="Account detail" aria-hidden="true">
  <div class="drawer-head">
    <button class="drawer-close" id="drawer-close" aria-label="Close">&times;</button>
    <div id="drawer-head-content"></div>
  </div>
  <div class="drawer-body" id="drawer-body"></div>
</aside>
${overlays ? overlays.value : ''}
<script src="/assets/portal.js" defer></script>
${script ? `<script>${script.value}</script>` : ''}
</body>
</html>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderLogin(options: { error?: string; email?: string }): string {
  const { error, email } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in · YAD Sales</title>
<link rel="stylesheet" href="/assets/portal.css">
</head>
<body>
<div class="auth-split">
  <section class="auth-brand">
    <span class="brand-mark brand-mark-lg">YAD</span>
    <h1>Your AI Department</h1>
    <p>The sales operating system. One shared record of every company, every
       conversation and every commitment.</p>
    <ul class="auth-points">
      <li>Researched prospects, ready to work</li>
      <li>Ownership that survives a restart</li>
      <li>Contact routes you can trust</li>
    </ul>
  </section>
  <section class="auth-form-side">
    <form class="login-card" method="post" action="/login">
      <h2>Sign in</h2>
      <p class="muted small" style="margin:4px 0 18px">Internal use only.</p>
      ${error ? `<div class="form-error" role="alert">${escapeText(error)}</div>` : ''}
      <div class="field">
        <label for="email">Work email</label>
        <input id="email" name="email" type="email" autocomplete="username" required
               value="${escapeText(email ?? '')}" autofocus>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn btn-primary" type="submit" style="width:100%;margin-top:8px">Sign in</button>
      <p class="muted micro" style="margin:18px 0 0;text-align:center">
        Authorized use only. Activity on this system is logged.
      </p>
    </form>
  </section>
</div>
</body>
</html>`;
}
