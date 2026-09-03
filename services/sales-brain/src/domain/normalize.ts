/**
 * Identity normalization. Every dedupe decision in the system starts here, so these
 * functions must be deterministic and boring.
 * Authority: outbound-sales-brain-data-contract.md §35 (identity/dedupe match order).
 */

/** Legal-form and noise suffixes that should not distinguish two records of one company. */
const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'l l c', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'pa', 'pc', 'pllc', 'plc',
]);

/** Words carrying no identity signal in a US SMB name. */
const NOISE_WORDS = new Set(['the', 'and', 'of']);

export function normalizeCompanyName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = cleaned
    .split(' ')
    .filter((token) => token.length > 0 && !NOISE_WORDS.has(token));

  // Collapse runs of single letters so "A.B.C. Air" and "ABC Air" resolve to the
  // same identity instead of looking like two different companies.
  const tokens: string[] = [];
  let initialism = '';
  for (const token of rawTokens) {
    if (token.length === 1 && /[a-z]/.test(token)) {
      initialism += token;
      continue;
    }
    if (initialism) {
      tokens.push(initialism);
      initialism = '';
    }
    tokens.push(token);
  }
  if (initialism) tokens.push(initialism);

  // Strip trailing legal forms only. "LLC Plumbing" keeps its first word.
  while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

/**
 * US/NANP phone normalization to E.164. Returns null when the input cannot be
 * trusted as a dialable number — an unparseable number is never stored as if it were one.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  // Drop a trailing extension before counting digits: "904-555-0100 x12" is one number.
  const withoutExtension = String(input).replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '');
  const digits = withoutExtension.replace(/\D/g, '');

  if (digits.length === 10) {
    if (digits[0] === '0' || digits[0] === '1') return null;   // invalid NANP area code
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    if (digits[1] === '0' || digits[1] === '1') return null;
    return `+${digits}`;
  }
  // Plausible international number, kept only when explicitly written as one.
  if (String(input).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

export function extractExtension(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = String(input).match(/(?:x|ext\.?|extension)\s*(\d{1,6})\s*$/i);
  return match ? match[1]! : null;
}

export function formatPhoneDisplay(e164: string): string {
  const match = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

const EMAIL_PATTERN = /^[^\s@,;:<>()[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/** Role mailboxes: `info@` must never be presented as a named person's address. */
const ROLE_MAILBOXES = new Set([
  'info', 'contact', 'sales', 'support', 'admin', 'office', 'hello', 'help', 'service',
  'estimates', 'estimate', 'scheduling', 'billing', 'accounting', 'careers', 'jobs', 'hr',
  'marketing', 'team', 'inquiries', 'enquiries', 'general', 'mail', 'email', 'webmaster',
  'noreply', 'no-reply', 'customerservice', 'frontdesk', 'reception', 'intake', 'dispatch',
]);

export type EmailRoleClass = 'DIRECT_PERSON_EMAIL' | 'ROLE_EMAIL' | 'GENERAL_BUSINESS_EMAIL' | 'UNKNOWN_EMAIL_TYPE';

export function classifyEmail(normalized: string): EmailRoleClass {
  const local = normalized.split('@')[0] ?? '';
  const bare = local.replace(/[._-]/g, '');
  if (bare === 'info' || bare === 'contact' || bare === 'hello' || bare === 'mail') {
    return 'GENERAL_BUSINESS_EMAIL';
  }
  if (ROLE_MAILBOXES.has(bare)) return 'ROLE_EMAIL';
  // A local part shaped like a person ("john", "john.smith", "jsmith") reads as personal,
  // but that is only a shape — identity still needs separate evidence.
  if (/^[a-z]+([._-][a-z]+)?$/.test(local) && local.length >= 2) return 'DIRECT_PERSON_EMAIL';
  return 'UNKNOWN_EMAIL_TYPE';
}

/** Hostname for identity purposes: no scheme, no `www.`, no port, no trailing dot. */
export function normalizeHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = String(input).trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0] ?? '';
  value = value.split('?')[0] ?? '';
  value = value.split('#')[0] ?? '';
  value = value.split('@').pop() ?? '';
  value = value.replace(/:\d+$/, '');
  value = value.replace(/\.$/, '');
  if (value.startsWith('www.')) value = value.slice(4);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return null;
  return value;
}

/** Registrable-ish domain: enough to tell one SMB site from another. */
const MULTIPART_TLDS = new Set(['co.uk', 'com.au', 'co.nz', 'com.br', 'co.za', 'com.mx']);

export function registrableDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTIPART_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

export function normalizePostalCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = String(input).trim().match(/^(\d{5})(?:-\d{4})?$/);
  return match ? match[1]! : null;
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

export function normalizeState(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = String(input).trim();
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  return STATE_ABBREVIATIONS[value.toLowerCase()] ?? null;
}

export function normalizeCity(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = String(input).trim().replace(/\s+/g, ' ');
  return value.length > 0 ? value : null;
}

export function splitPersonName(fullName: string): { first: string | null; last: string | null } {
  const parts = fullName.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}
