import { html, raw, type RawHtml } from './html.js';
import type { SessionUser } from '../domain/auth.js';
import { isManager } from '../domain/auth.js';

export interface NavCounts {
  myProspects?: number;
  followUpsDue?: number;
}

interface NavItem {
  href: string;
  label: string;
  count?: number | undefined;
  attention?: boolean;
}

function navItems(user: SessionUser, counts: NavCounts): { section: string; items: NavItem[] }[] {
  const sections: { section: string; items: NavItem[] }[] = [
    {
      section: 'Prospecting',
      items: [
        { href: '/', label: 'Overview' },
        { href: '/find', label: 'Find Prospects' },
        { href: '/markets', label: 'Markets' },
      ],
    },
    {
      section: 'My Book',
      items: [
        { href: '/my-prospects', label: 'My Prospects', count: counts.myProspects },
        { href: '/follow-ups', label: 'Follow-Ups', count: counts.followUpsDue, attention: true },
      ],
    },
  ];
  if (isManager(user.role)) {
    sections.push({ section: 'Manage', items: [{ href: '/team', label: 'Team' }] });
  }
  return sections;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

const ROLE_LABELS: Record<string, string> = {
  SALES_REP: 'Sales Rep',
  SALES_MANAGER: 'Sales Manager',
  RESEARCH_OPS: 'Research Ops',
  ADMIN: 'Admin',
};

export interface LayoutOptions {
  title: string;
  subtitle?: string | RawHtml;
  user: SessionUser;
  currentPath: string;
  counts?: NavCounts;
  actions?: RawHtml;
  body: RawHtml;
  /** Extra page-specific script, already trusted. */
  script?: RawHtml;
}

export function renderPage(options: LayoutOptions): string {
  const { title, subtitle, user, currentPath, counts = {}, actions, body, script } = options;

  const nav = navItems(user, counts).map(
    (group) => html`
      <div class="nav-section">${group.section}</div>
      ${group.items.map((item) => {
        const isCurrent = item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href);
        return html`<a class="nav-link" href="${item.href}" ${raw(isCurrent ? 'aria-current="page"' : '')}>
          <span>${item.label}</span>
          ${item.count ? html`<span class="count">${item.count}</span>` : ''}
        </a>`;
      })}
    `,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeTitle(title)} · YAD Sales</title>
<link rel="stylesheet" href="/assets/portal.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%232563EB'/><text x='16' y='22' font-family='sans-serif' font-size='15' font-weight='bold' fill='white' text-anchor='middle'>Y</text></svg>">
</head>
<body>
<div class="app">
  <nav class="nav" aria-label="Main">
    <a class="brand" href="/">
      <span class="brand-mark">YAD</span>
      <span class="brand-text"><strong>Sales Brain</strong><span>Your AI Department</span></span>
    </a>
    ${nav.join('')}
    <div class="nav-footer">
      <div class="nav-user">
        <span class="avatar">${initials(user.displayName)}</span>
        <span class="nav-user-meta">
          <strong>${escapeTitle(user.displayName)}</strong>
          <span>${ROLE_LABELS[user.role] ?? user.role}</span>
        </span>
      </div>
      <form method="post" action="/logout"><button class="nav-link" type="submit" style="width:100%;border:0;background:none;text-align:left;font:inherit;cursor:pointer">Sign out</button></form>
    </div>
  </nav>
  <main class="main">
    <header class="page-header">
      <div>
        <h1>${escapeTitle(title)}</h1>
        ${subtitle ? `<p>${typeof subtitle === 'string' ? escapeTitle(subtitle) : subtitle.value}</p>` : ''}
      </div>
      ${actions ? `<div class="row">${actions.value}</div>` : ''}
    </header>
    <div class="page-body">${body.value}</div>
  </main>
</div>
<div class="toast-host" id="toasts" aria-live="polite"></div>
<div class="drawer-scrim" id="drawer-scrim"></div>
<aside class="drawer" id="drawer" aria-label="Account detail" aria-hidden="true">
  <div class="drawer-head">
    <button class="drawer-close" id="drawer-close" aria-label="Close">&times;</button>
    <div id="drawer-head-content"></div>
  </div>
  <div class="drawer-body" id="drawer-body"></div>
</aside>
<script src="/assets/portal.js" defer></script>
${script ? `<script>${script.value}</script>` : ''}
</body>
</html>`;
}

function escapeTitle(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
<div class="login-page">
  <form class="login-card" method="post" action="/login">
    <div class="row" style="gap:10px;margin-bottom:18px">
      <span class="brand-mark">YAD</span>
      <div><h1>Sales Brain</h1><p class="muted small" style="margin:0">Internal prospect workspace</p></div>
    </div>
    ${error ? `<div class="form-error">${escapeTitle(error)}</div>` : ''}
    <div class="field">
      <label for="email">Work email</label>
      <input id="email" name="email" type="email" autocomplete="username" required
             value="${escapeTitle(email ?? '')}" autofocus>
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
    </div>
    <button class="btn btn-primary" type="submit" style="width:100%;margin-top:6px">Sign in</button>
    <p class="muted micro" style="margin:16px 0 0;text-align:center">
      Authorized use only. Activity on this system is logged.
    </p>
  </form>
</div>
</body>
</html>`;
}
