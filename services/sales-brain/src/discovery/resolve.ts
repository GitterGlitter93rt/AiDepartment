import {
  classifyObservation, mayPromote, registrableDomain,
  type ClassifiableObservation, type SourceClass,
} from './sourceClass.js';

/**
 * Turning a page of search results into candidate businesses.
 *
 * The old code called this step "dedupe" and it was: group by domain, keep the best
 * row, ship it as a company. What was missing is the question in between -- is this a
 * company at all, and if so which one -- and that question needs the whole result set,
 * not one row. A domain carrying three different business names is a directory even
 * if nobody has ever heard of it, and that is the only rule that can see a directory
 * invented tomorrow.
 */

/**
 * Placements somebody paid for. Declared here rather than imported from the adapter:
 * the resolver is domain logic and must not learn a provider's shapes.
 */
const PAID_PLACEMENT: ReadonlySet<string> = new Set([
  'PAID_SEARCH_TEXT', 'PAID_LOCAL', 'LOCAL_SERVICES_AD',
]);

export type EntityStatus =
  /** Resolved well enough to be an Account. */
  | 'VERIFIED'
  /** Might be a business; we cannot say which one. Kept, not promoted. */
  | 'NEEDS_REVIEW'
  /** Not a business. Provenance kept, nothing promoted. */
  | 'REJECTED';

export interface CandidateObservation extends ClassifiableObservation {
  position: number | null;
}

export interface EntityCandidate {
  /** Registrable domain, or the phone when there is no domain. Stable within a run. */
  identity: string;
  status: EntityStatus;
  sourceClass: SourceClass;
  /** Only set when we can defend it. Never a raw page title we do not trust. */
  resolvedName: string | null;
  /** How the name was arrived at, so the UI never implies more than we know. */
  nameBasis: 'provider_listing' | 'own_site_title' | 'domain' | 'unresolved';
  domain: string | null;
  /** Only carried when the source is entitled to state it. */
  phone: string | null;
  /** Only from a listing that actually observed an address. */
  observedLocation: string | null;
  observationCount: number;
  reasons: string[];
}

/** A title that could be a company's name, rather than a page's name. */
const NOT_A_NAME = [
  { test: /\|/, why: 'a page title with a separator rather than a company name' },
  { test: /\.\.\.$/, why: 'a truncated page title' },
  { test: /^\s*\d+\s*$/, why: 'a number, not a name' },
  { test: /^(the\s+)?(top|best)\b|\btop\s*\d+\b|\b\d+\s+best\b/i, why: 'a ranked list' },
  { test: /\?\s*$/, why: 'a question' },
  { test: /\bnear me\b/i, why: 'a search phrase' },
  { test: /^(roofers?|plumbers?|electricians?|contractors?|dentists?)\s+in\b/i,
    why: 'a category page heading' },
  { test: /^\s*(home|about|contact|services|welcome)\b.{0,4}$/i, why: 'a navigation label' },
];

export function looksLikeCompanyName(title: string | null): { ok: boolean; why: string | null } {
  const name = (title ?? '').trim();
  if (name.length < 3) return { ok: false, why: 'too short to be a company name' };
  if (name.length > 90) return { ok: false, why: 'too long to be a company name' };
  for (const rule of NOT_A_NAME) if (rule.test.test(name)) return { ok: false, why: rule.why };
  return { ok: true, why: null };
}

/**
 * How many distinct businesses one domain is carrying in a single result set.
 *
 * The structural directory test. `freeroofquote.com` appearing once with one
 * contractor's name on it looks exactly like that contractor's site; appearing three
 * times with three contractors' names on it is a directory, and no list of known
 * directories was needed to work that out.
 */
/**
 * The part of a page title that could be a business name.
 *
 * Everything after the first separator is page, not company: "Golden HVAC 0 — Service
 * Area", "Big Foot Roofing | Roof Repair" and "Cooper Roofing, Inc.: Home" are three
 * companies with a page name stuck on the end. Counting the full strings would make
 * one company look like several.
 */
function nameCore(title: string | null): string {
  return (title ?? '')
    .split(/\s+[—–|:]\s+|\s+-\s+/)[0]!
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function directoryDomains(observations: CandidateObservation[]): Map<string, number> {
  const namesByDomain = new Map<string, Set<string>>();
  for (const observation of observations) {
    const domain = registrableDomain(observation.observedDomain);
    // Ad copy is not a name.
    //
    // A paid title is written for a campaign -- "Emergency AC Repair — Book Today" --
    // and changes without the company changing. Counting it made every advertiser that
    // also ranks organically look like a domain carrying two businesses, which is to
    // say it rejected exactly the companies advertiser-first mining exists to find.
    if (observation.resultType === 'PAID_SEARCH_TEXT') continue;
    const name = nameCore(observation.observedName);
    if (!domain || !name) continue;
    const held = namesByDomain.get(domain) ?? new Set<string>();
    held.add(name);
    namesByDomain.set(domain, held);
  }
  const counts = new Map<string, number>();
  for (const [domain, names] of namesByDomain) {
    // One name that is a prefix of another is one company describing itself twice,
    // not two companies: "Cooper Roofing" and "Cooper Roofing Inc" are the same firm.
    const distinct = [...names].filter((name) =>
      ![...names].some((other) => other !== name && other.startsWith(name)));
    counts.set(domain, Math.max(1, distinct.length));
  }
  return counts;
}

export function resolveCandidates(observations: CandidateObservation[]): EntityCandidate[] {
  const distinctNames = directoryDomains(observations);
  const byIdentity = new Map<string, CandidateObservation[]>();

  for (const observation of observations) {
    const domain = registrableDomain(observation.observedDomain);
    const identity = domain ?? (observation.observedPhone?.trim() || null);
    if (!identity) continue;
    const held = byIdentity.get(identity) ?? [];
    held.push(observation);
    byIdentity.set(identity, held);
  }

  const candidates: EntityCandidate[] = [];
  for (const [identity, rows] of byIdentity) {
    // The best row decides the class: a company that appears both in the local pack
    // and as an organic page is resolved from its listing, which is the better fact.
    const ranked = [...rows].sort((left, right) => {
      const weight = (row: CandidateObservation): number =>
        row.resultType === 'MAPS_LOCAL' || row.resultType === 'LOCAL_SERVICES_AD' ? 0 : 1;
      if (weight(left) !== weight(right)) return weight(left) - weight(right);
      return (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER);
    });
    const best = ranked[0]!;
    const classified = classifyObservation(best);
    const reasons = [...classified.reasons];
    let sourceClass = classified.sourceClass;

    // Structural directory test, applied after the per-row class so it can override a
    // row that looked like somebody's own site.
    const carried = distinctNames.get(identity) ?? 0;
    if (carried > 1 && sourceClass === 'OFFICIAL_SITE') {
      sourceClass = 'DIRECTORY';
      reasons.length = 0;
      reasons.push(`carries ${carried} different business names in one result set, so it `
        + 'lists other people’s businesses');
    }

    // A company name and a phone number, with no website at all.
    //
    // Classification works on the domain, so a row without one can only come back
    // UNKNOWN -- and rejecting those would drop the businesses that genuinely have no
    // site, which is a real and common shape in a local market. There is nothing here
    // suggesting a webpage either: a directory, an article and a forum thread all have
    // domains, and a listicle title fails the name test. A name that reads like a
    // company plus a number to ring is an identity.
    if (sourceClass === 'UNKNOWN' && !registrableDomain(best.observedDomain)
        && best.observedPhone && looksLikeCompanyName(best.observedName).ok) {
      candidates.push({
        identity, status: 'VERIFIED', sourceClass: 'BUSINESS_LISTING',
        resolvedName: best.observedName!.trim(), nameBasis: 'provider_listing',
        domain: null, phone: best.observedPhone, observedLocation: best.observedLocation ?? null,
        observationCount: rows.length,
        reasons: ['a company name and a phone number, with no website on record'],
      });
      continue;
    }

    if (!mayPromote(sourceClass)) {
      candidates.push({
        identity, status: 'REJECTED', sourceClass, resolvedName: null,
        nameBasis: 'unresolved', domain: registrableDomain(best.observedDomain),
        phone: null, observedLocation: null, observationCount: rows.length, reasons,
      });
      continue;
    }

    if (sourceClass === 'BUSINESS_LISTING') {
      // The provider resolved this entity; the name, phone and address are its own
      // statements about the business rather than text scraped off a page.
      candidates.push({
        identity, status: 'VERIFIED', sourceClass,
        resolvedName: best.observedName!.trim(), nameBasis: 'provider_listing',
        domain: registrableDomain(best.observedDomain), phone: best.observedPhone ?? null,
        observedLocation: best.observedLocation ?? null,
        observationCount: rows.length, reasons,
      });
      continue;
    }

    // OFFICIAL_SITE: promotable only if we can also name the company.
    //
    // The name is never taken from a paid text ad. Its title is ad copy -- "Same-Day
    // AC Repair -- 24/7 Emergency Service" -- and there is no way to tell that from a
    // company name by looking at the row, so naming an Account after it puts a slogan
    // in a rep's list. The same company's organic row usually carries something closer
    // to a name, and the domain always does.
    const nameable = ranked.find((observation) =>
      observation.resultType !== 'PAID_SEARCH_TEXT'
      && looksLikeCompanyName(observation.observedName).ok);

    if (nameable) {
      candidates.push({
        identity, status: 'VERIFIED', sourceClass,
        resolvedName: nameable.observedName!.trim(), nameBasis: 'own_site_title',
        domain: registrableDomain(best.observedDomain),
        phone: best.observedPhone ?? null, observedLocation: best.observedLocation ?? null,
        observationCount: rows.length,
        reasons: [...reasons, 'the page names a company rather than a topic'],
      });
      continue;
    }

    // No usable title. What happens next depends on how strong the source is, which
    // is the difference between "we cannot name it" and "we cannot tell it exists".
    //
    // Somebody paying Google to send traffic to a domain is economic evidence that an
    // operating business is behind it, whatever its ad copy says -- that is the whole
    // premise of advertiser-first mining, and refusing it would throw away the signal
    // the product is built on. It promotes under its domain, with the basis recorded
    // so no surface implies this is the registered name.
    //
    // A plain organic page with a page-shaped title is not that. It is probably a real
    // company -- most of them are -- but "probably" is what put 65 webpages in a rep's
    // list, so it waits for a verification step that can read the site and resolve the
    // name properly.
    const paidPlacement = ranked.some((observation) =>
      PAID_PLACEMENT.has(observation.resultType));
    if (paidPlacement && registrableDomain(best.observedDomain)) {
      candidates.push({
        identity, status: 'VERIFIED', sourceClass,
        resolvedName: registrableDomain(best.observedDomain), nameBasis: 'domain',
        domain: registrableDomain(best.observedDomain),
        phone: best.observedPhone ?? null, observedLocation: best.observedLocation ?? null,
        observationCount: rows.length,
        reasons: [...reasons,
          'a paid placement for this domain, so a business is running it; no row '
          + 'carried a usable name, so the domain stands in for one'],
      });
      continue;
    }

    const named = looksLikeCompanyName(best.observedName);
    if (!named.ok) {
      candidates.push({
        identity, status: 'NEEDS_REVIEW', sourceClass, resolvedName: null,
        nameBasis: 'unresolved', domain: registrableDomain(best.observedDomain),
        // A phone read off a page we have not established ownership of is not this
        // company's phone.
        phone: null, observedLocation: null, observationCount: rows.length,
        reasons: [...reasons, `the page title is ${named.why}`],
      });
      continue;
    }

  }

  return candidates;
}
