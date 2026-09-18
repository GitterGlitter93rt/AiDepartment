import { normalizeEmail, normalizePhone } from '../domain/normalize.js';

/**
 * Deciding whether a published route belongs to a named person or to the company.
 *
 * The defect this exists to close, measured on production: `contact_id` is null on all
 * 609 communication endpoints. Sales Brain can independently discover a named owner and
 * that owner's personal address on the same contact page, and never connect the two.
 * Person extraction and endpoint extraction run alongside each other and never meet.
 *
 * The obvious fix is the wrong one. Attributing an endpoint to a person because both
 * appear somewhere on the same site would hand every owner the company's `info@` address,
 * which is worse than having nothing: a rep who believes they have the owner's direct
 * line stops looking for it.
 *
 * So attribution needs a stated reason, and the reasons are ranked. A mailto wrapped
 * around a person's name is the company saying so. A shared contact card is the company
 * laying it out that way. A local part that spells the person's own name is close to a
 * signature. Everything weaker than that stays company-level, which is not a failure --
 * it is the truth about what was published.
 */

export type AttributionBasis =
  /** The person's name is the link text of a mailto, or its parent element. */
  | 'MAILTO_ON_PERSON'
  /** Person and endpoint are inside one team or contact card. */
  | 'SAME_CONTACT_CARD'
  /** A schema.org Person carrying the endpoint in its own record. */
  | 'STRUCTURED_PERSON_RECORD'
  /** Prose that says so: "Reach Yadiel at ...". */
  | 'EXPLICIT_TEXT_STATEMENT'
  /** A provider returned the endpoint attached to the person. */
  | 'PROVIDER_STATED'
  /** The local part spells the person's name. */
  | 'LOCAL_PART_MATCHES_NAME'
  /** Nothing links them. */
  | 'NONE';

/** Bases strong enough to move an endpoint from the company to a person. */
const PERSON_LEVEL: ReadonlySet<AttributionBasis> = new Set<AttributionBasis>([
  'MAILTO_ON_PERSON', 'SAME_CONTACT_CARD', 'STRUCTURED_PERSON_RECORD',
  'EXPLICIT_TEXT_STATEMENT', 'PROVIDER_STATED', 'LOCAL_PART_MATCHES_NAME',
]);

export type EndpointRole =
  | 'DIRECT_PERSON_EMAIL' | 'DIRECT_PERSON_PHONE'
  | 'GENERAL_BUSINESS_EMAIL' | 'ROLE_EMAIL' | 'MAIN_BUSINESS_LINE'
  | 'UNKNOWN_EMAIL_TYPE';

export interface AttributionVerdict {
  role: EndpointRole;
  basis: AttributionBasis;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** The person this is attributed to, or null when it stays with the company. */
  attributedTo: string | null;
  reasons: string[];
}

/**
 * Mailboxes that belong to a function, not a person.
 *
 * Checked before anything else and never overridden. `info@` sitting inside the owner's
 * team card is still `info@`: the card's layout does not change who reads the mail. This
 * is the false positive Michael named, and it is the one that would do real damage.
 */
const ROLE_LOCAL_PARTS = new Set([
  'info', 'office', 'service', 'services', 'sales', 'support', 'contact', 'admin',
  'billing', 'accounts', 'accounting', 'hello', 'help', 'team', 'inquiries', 'enquiries',
  'schedule', 'scheduling', 'dispatch', 'booking', 'booknow', 'estimates', 'quotes',
  'customerservice', 'noreply', 'no-reply', 'mail', 'email', 'general', 'shop', 'hr',
  'careers', 'jobs', 'marketing', 'webmaster', 'postmaster',
]);

export function isRoleMailbox(email: string): boolean {
  const local = (normalizeEmail(email) ?? email).split('@')[0] ?? '';
  const bare = local.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ROLE_LOCAL_PARTS.has(bare)
    // "service1@", "info.tampa@" and friends are the same mailbox with a suffix.
    || [...ROLE_LOCAL_PARTS].some((r) => r.length >= 4 && bare.startsWith(r)
        && /^[0-9]*$/.test(bare.slice(r.length)));
}

/**
 * Whether an email's local part spells this person's name.
 *
 * Both name parts have to appear, so "jsmith@" does not claim John Smith on the strength
 * of one letter and a common surname, and "alexmorgan2@example.test" does claim Alex
 * Morgan. A single-token person can never satisfy this, which is the right outcome: one
 * name is not enough identity to own a mailbox by.
 */
export function localPartNamesPerson(email: string, personName: string): boolean {
  const local = (normalizeEmail(email) ?? email).split('@')[0] ?? '';
  const bare = local.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parts = personName.toLowerCase().split(/\s+/)
    .map((p) => p.replace(/[^a-z0-9]/g, ''))
    .filter((p) => p.length >= 3);
  if (parts.length < 2 || bare.length < 6) return false;
  return parts.every((part) => bare.includes(part));
}

export interface AttributionInput {
  endpointKind: 'EMAIL' | 'PHONE';
  value: string;
  /** The person under consideration, if any. */
  personName?: string | null;
  /** How the extractor found them together, as observed. Never inferred here. */
  observedBasis?: AttributionBasis;
  /** True when the source presents the endpoint as the company's main line. */
  isMainLine?: boolean;
}

/**
 * The role an endpoint should carry, and why.
 *
 * Pure, so it can be tested against the shapes production actually produced without
 * reaching a network. The caller supplies what it observed; this decides what that means.
 */
export function attributeEndpoint(input: AttributionInput): AttributionVerdict {
  const reasons: string[] = [];
  const person = (input.personName ?? '').trim();
  const basis = input.observedBasis ?? 'NONE';

  if (input.endpointKind === 'EMAIL') {
    if (isRoleMailbox(input.value)) {
      // Deliberately before every other test.
      return {
        role: 'ROLE_EMAIL', basis: 'NONE', confidence: 'HIGH', attributedTo: null,
        reasons: ['the mailbox belongs to a function rather than a person, whatever else '
          + 'shares the page with it'],
      };
    }

    if (!person) {
      return { role: 'GENERAL_BUSINESS_EMAIL', basis: 'NONE', confidence: 'MEDIUM',
        attributedTo: null, reasons: ['published without a person attached'] };
    }

    // A local part that spells the name is evidence in itself, whatever the layout said.
    const spellsName = localPartNamesPerson(input.value, person);
    const effective: AttributionBasis =
      PERSON_LEVEL.has(basis) ? basis : (spellsName ? 'LOCAL_PART_MATCHES_NAME' : 'NONE');

    if (effective === 'NONE') {
      return { role: 'GENERAL_BUSINESS_EMAIL', basis: 'NONE', confidence: 'MEDIUM',
        attributedTo: null,
        reasons: [`${person} and this address appear on the same site, which is not evidence `
          + 'that the address is theirs'] };
    }

    if (spellsName) reasons.push(`the local part spells ${person}`);
    if (effective !== 'LOCAL_PART_MATCHES_NAME') reasons.push(describeBasis(effective, person));
    return {
      role: 'DIRECT_PERSON_EMAIL', basis: effective, attributedTo: person,
      // Two independent reasons is a fact; one is a good reason to say so and record why.
      confidence: (spellsName && effective !== 'LOCAL_PART_MATCHES_NAME') ? 'HIGH' : 'MEDIUM',
      reasons,
    };
  }

  // Phones. A number cannot spell a name, so only layout or an explicit statement links it.
  if (input.isMainLine || !person || !PERSON_LEVEL.has(basis) || basis === 'LOCAL_PART_MATCHES_NAME') {
    return { role: 'MAIN_BUSINESS_LINE', basis: 'NONE', confidence: 'MEDIUM',
      attributedTo: null,
      reasons: [input.isMainLine
        ? 'the source presents this as the company line'
        : 'nothing published links this number to a named person'] };
  }
  return { role: 'DIRECT_PERSON_PHONE', basis, attributedTo: person, confidence: 'MEDIUM',
    reasons: [describeBasis(basis, person)] };
}

function describeBasis(basis: AttributionBasis, person: string): string {
  switch (basis) {
    case 'MAILTO_ON_PERSON':
      return `the page links this address from ${person}'s own name`;
    case 'SAME_CONTACT_CARD':
      return `it sits inside ${person}'s contact card`;
    case 'STRUCTURED_PERSON_RECORD':
      return `the site's structured data records it inside ${person}'s own entry`;
    case 'EXPLICIT_TEXT_STATEMENT':
      return `the page says in words that it reaches ${person}`;
    case 'PROVIDER_STATED':
      return `the provider returned it attached to ${person}`;
    case 'LOCAL_PART_MATCHES_NAME':
      return `the local part spells ${person}`;
    default:
      return 'nothing links them';
  }
}

/**
 * Finds the endpoints a page attributes to a person, by reading the markup around them.
 *
 * Kept narrow on purpose. It looks for the two shapes that are genuinely a statement --
 * a mailto whose own link text or immediate parent carries the name, and a name and an
 * endpoint inside one small block -- and it does not go looking for reasons beyond that.
 */
export function attributionsInHtml(html: string, personName: string): {
  value: string; kind: 'EMAIL' | 'PHONE'; basis: AttributionBasis;
}[] {
  const found: { value: string; kind: 'EMAIL' | 'PHONE'; basis: AttributionBasis }[] = [];
  if (!personName.trim()) return found;
  const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameAnywhere = new RegExp(escaped, 'i');

  // A mailto whose link text is the person's name.
  const mailtoLink = /<a[^>]+href=["']mailto:([^"'?]+)[^>]*>([\s\S]{0,200}?)<\/a>/gi;
  for (const match of html.matchAll(mailtoLink)) {
    const [, address, text] = match;
    if (address && text && nameAnywhere.test(text.replace(/<[^>]+>/g, ' '))) {
      found.push({ value: address.trim(), kind: 'EMAIL', basis: 'MAILTO_ON_PERSON' });
    }
  }

  /**
   * A card: one small block carrying both the name and the endpoint.
   *
   * Bounded at 600 characters because that is about the size of a team card, and an
   * unbounded window is how "somewhere on the same page" gets called attribution.
   */
  for (const match of html.matchAll(nameAnywhere.global ? nameAnywhere : new RegExp(escaped, 'gi'))) {
    const start = Math.max(0, (match.index ?? 0) - 300);
    const block = html.slice(start, (match.index ?? 0) + 300);
    for (const email of block.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      const value = email[0];
      if (!found.some((f) => f.value.toLowerCase() === value.toLowerCase())) {
        found.push({ value, kind: 'EMAIL', basis: 'SAME_CONTACT_CARD' });
      }
    }
    for (const phone of block.matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)) {
      const value = normalizePhone(phone[0]) ?? phone[0];
      if (!found.some((f) => f.value === value)) {
        found.push({ value, kind: 'PHONE', basis: 'SAME_CONTACT_CARD' });
      }
    }
  }
  return found;
}
