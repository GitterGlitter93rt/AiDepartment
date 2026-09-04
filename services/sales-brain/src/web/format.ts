/** Display helpers. Every "unknown" must read as unknown, never as a zero or a no. */

export function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return 'never';
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = Date.now() - date.getTime();
  const future = diffMs < 0;
  const seconds = Math.abs(diffMs) / 1000;

  const pick = (): string => {
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
    if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d`;
    if (seconds < 2_592_000) return `${Math.round(seconds / 604_800)}w`;
    return `${Math.round(seconds / 2_592_000)}mo`;
  };
  const magnitude = pick();
  if (magnitude === 'just now') return magnitude;
  return future ? `in ${magnitude}` : `${magnitude} ago`;
}

export function formatDateTime(value: Date | string | null | undefined, timeZone = 'America/New_York'): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone,
  }).format(date);
}

export function formatDate(value: Date | string | null | undefined, timeZone = 'America/New_York'): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone })
    .format(date);
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

/** Tier plus score, e.g. "A · 13". Score is omitted rather than shown as 0 when unscored. */
export function tierLabel(tier: string | null, score: number | null): string {
  if (!tier) return 'Unscored';
  return score === null || score === undefined ? tier : `${tier} · ${score}`;
}

export function ownerLabel(
  ownerId: string | null, ownerName: string | null, viewerId: string,
): string {
  if (!ownerId) return 'Unclaimed';
  return ownerId === viewerId ? 'You' : (ownerName ?? 'Another rep');
}
