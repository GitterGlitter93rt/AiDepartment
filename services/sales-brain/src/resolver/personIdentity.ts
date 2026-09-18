/**
 * Whether a name found in a person-shaped place is actually a person.
 *
 * Measured against production in the 2026-09-17 research audit: 27 of 135 named-person
 * records are not people. They are CMS usernames (`wpadmin`, `degreeadm`, `actuate`),
 * the web design agency that built the site (`Stryker Digital`, `MosierData`), the
 * company's own name recorded as its own owner (`Benjamin Franklin Plumbing`), schema.org
 * type literals (`Organization`, `admin`), and bare single tokens (`Mauricio`).
 *
 * The extractors are not wrong to find these strings -- they genuinely sit in author
 * fields, bylines and team cards. What was wrong is that finding text in a person-like
 * location was treated as having found a person, and a person is what gets decision-maker
 * authority and, eventually, a phone call.
 *
 * Conservative in both directions. A rep who rings up and asks for wpadmin is the cost of
 * being too permissive; deleting a real owner who goes by one name is the cost of being
 * too strict, and this is a trade where that happens. So a single token is not rejected
 * outright: it is insufficient on its own and can be carried by other signals.
 */

export type PersonIdentityValidity =
  /** A full name, corroborated, with nothing arguing against it. */
  | 'VALID_PERSON'
  /** Probably a person: fewer signals, or one weak signal against. */
  | 'LIKELY_PERSON'
  /** A firm: the web agency, a partner company, a certifying body. */
  | 'BUSINESS_OR_AGENCY'
  /** A login, an author slug, a role account. */
  | 'CMS_OR_USERNAME'
  /** A schema.org type or field name that a parser read as a value. */
  | 'SCHEMA_LITERAL'
  /** This company's own name, recorded as a person at this company. */
  | 'COMPANY_NAME'
  /** Might be a person; there is not enough here to say so. */
  | 'INSUFFICIENT_PERSON_IDENTITY';

export interface PersonIdentityVerdict {
  validity: PersonIdentityValidity;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  /** Only a person may be a decision maker. Everything else is evidence, not authority. */
  mayHoldDecisionMakerAuthority: boolean;
}

export interface PersonIdentityInput {
  name: string;
  /** The Account this name was found for. */
  companyName?: string | null;
  /** What the site declares itself to be, where that has been read. */
  siteDeclaredOrganization?: string | null;
  /** The title the source gave, which is itself a signal about what kind of thing this is. */
  rawTitle?: string | null;
  /** Where it was read. An author archive is a different claim from a team card. */
  sourceReference?: string | null;
  /** The surrounding text, where the extractor kept it. */
  context?: string | null;
}

/** Schema.org types and field names that arrive as values when a parser loses its footing. */
const SCHEMA_LITERALS = new Set([
  'organization', 'localbusiness', 'person', 'corporation', 'thing', 'author', 'creator',
  'publisher', 'brand', 'website', 'webpage', 'contactpoint', 'postaladdress', 'name',
]);

/** Login names and role accounts, which are how a CMS labels whoever typed the post. */
const CMS_HANDLES = new Set([
  'admin', 'administrator', 'wpadmin', 'wp-admin', 'webmaster', 'editor', 'user', 'root',
  'info', 'office', 'support', 'sales', 'marketing', 'webadmin', 'siteadmin', 'owner',
  'manager', 'staff', 'team', 'test', 'demo', 'guest', 'noreply', 'no-reply',
]);

/** Words that make a string a firm rather than a person. */
const FIRM_WORDS =
  /\b(inc|inc\.|llc|l\.l\.c|ltd|co|corp|corporation|company|group|holdings|partners|associates|enterprises|industries|solutions|systems|services|digital|media|marketing|agency|studio|studios|design|designs|creative|web|seo|data|technologies|technology|consulting|certified|contractors?|heating|cooling|hvac|plumbing|roofing|electric|electrical|mechanical|refrigeration|air)\b/i;

/** A URL that says this name came from a CMS author listing rather than a team page. */
const AUTHOR_ARCHIVE = /\/(author|users?|profile|contributor)s?\//i;
/** A URL that says the opposite. */
const PEOPLE_PAGE = /\/(about|about-us|team|our-team|staff|leadership|management|who-we-are|meet)/i;

/** Titles that only a person holds. */
const PERSON_TITLE =
  /\b(owner|founder|co-founder|president|vice president|principal|ceo|cfo|coo|chief \w+|general manager|operations manager|office manager|service manager|manager|partner|director|technician|estimator|comfort (advisor|specialist))\b/i;

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokens(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

/**
 * A name that reads like a person's: capitalised words, no digits, no punctuation salad.
 *
 * Deliberately permissive about the shapes real names take -- particles, apostrophes,
 * hyphens, accents -- because a rule tight enough to exclude every handle also excludes
 * O'Brien, de la Cruz and Nguyễn.
 */
function looksNameShaped(name: string): boolean {
  return /^[\p{Lu}][\p{L}'’.\-]*(\s+(?:[a-z]{1,3}\s+)?[\p{Lu}][\p{L}'’.\-]*){1,3}$/u.test(name.trim());
}

export function judgePersonIdentity(input: PersonIdentityInput): PersonIdentityVerdict {
  const name = (input.name ?? '').trim();
  const reasons: string[] = [];
  const decide = (validity: PersonIdentityValidity, confidence: 'HIGH' | 'MEDIUM' | 'LOW',
                  why: string): PersonIdentityVerdict => ({
    validity, confidence, reasons: [...reasons, why],
    mayHoldDecisionMakerAuthority: validity === 'VALID_PERSON' || validity === 'LIKELY_PERSON',
  });

  if (!name) {
    return decide('INSUFFICIENT_PERSON_IDENTITY', 'HIGH', 'there is no name');
  }

  const lower = name.toLowerCase();
  const words = tokens(name);

  // A schema.org type read as a value. "Organization" is not somebody called Organization.
  if (SCHEMA_LITERALS.has(lower)) {
    return decide('SCHEMA_LITERAL', 'HIGH',
      `"${name}" is a schema.org type or field name, not a value`);
  }

  const fromAuthorArchive = AUTHOR_ARCHIVE.test(input.sourceReference ?? '');

  /**
   * The company recorded as its own decision maker.
   *
   * Asked before the firm-word test below, because a contractor's name contains trade
   * words by definition: "Benjamin Franklin Plumbing" as its own owner is the company,
   * not some other firm, and the distinction is the one an operator needs to act on.
   */
  const company = squash(input.companyName ?? '');
  const declared = squash(input.siteDeclaredOrganization ?? '');
  const squashed = squash(name);
  if (squashed.length >= 5) {
    if (company && (company.includes(squashed) || squashed.includes(company.slice(0, 12)))) {
      return decide('COMPANY_NAME', 'HIGH',
        `"${name}" is this Account's own name, so it is the company rather than somebody at it`);
    }
    if (declared && (declared.includes(squashed) || squashed.includes(declared.slice(0, 12)))) {
      return decide('COMPANY_NAME', 'HIGH',
        `"${name}" is the organisation the site declares itself to be`);
    }
  }

  // A firm: the web designer's credit in the footer is the commonest instance.
  if (FIRM_WORDS.test(name)) {
    return decide('BUSINESS_OR_AGENCY', 'HIGH',
      `"${name}" contains a company or agency word, so it names a firm rather than a person`);
  }

  if (words.length === 1) {
    const bare = lower.replace(/[^a-z0-9]/g, '');
    if (CMS_HANDLES.has(bare) || /^(wp|site|web|cms)[-_]?\w*$/.test(bare)
        || /\d/.test(name) || /[._-]/.test(name)) {
      return decide('CMS_OR_USERNAME', 'HIGH',
        `"${name}" is shaped like a login or role account rather than a name`);
    }
    /**
     * One lowercase word is a login, because a name is capitalised.
     *
     * degreeadm, actuate, whitley and john all arrived this way, from CMS author fields.
     * A person who writes their own name never writes it in lower case, and a system
     * that stores a login always does.
     */
    if (name === lower) {
      return decide('CMS_OR_USERNAME', 'HIGH',
        `"${name}" is a single lower-case token, which is how a system stores a login and `
        + 'not how a person writes their name');
    }
    /**
     * One word with a capital inside it is a brand.
     *
     * MosierData, and the next one like it. Personal names do not have internal capitals;
     * product and agency names frequently do.
     */
    if (/[a-z][A-Z]/.test(name)) {
      return decide('BUSINESS_OR_AGENCY', 'HIGH',
        `"${name}" is one word with a capital inside it, which is a brand rather than a name`);
    }
    if (fromAuthorArchive) {
      return decide('CMS_OR_USERNAME', 'MEDIUM',
        `"${name}" is a single token taken from a CMS author listing`);
    }
    /**
     * A capitalised single name, and possibly a real one.
     *
     * Michael's instruction: do not delete a real single-name person merely because the
     * shape is uncommon. So it is insufficient on its own, and is carried by context --
     * a person's title, on a page about the people who work here.
     */
    const titled = PERSON_TITLE.test(input.rawTitle ?? '');
    const onPeoplePage = PEOPLE_PAGE.test(input.sourceReference ?? '');
    if (titled && onPeoplePage) {
      return decide('LIKELY_PERSON', 'LOW',
        `"${name}" is one name, but it carries a person's title on a page about the people here`);
    }
    return decide('INSUFFICIENT_PERSON_IDENTITY', 'MEDIUM',
      `"${name}" is a single token with nothing else identifying a person`);
  }

  if (!looksNameShaped(name)) {
    return decide('INSUFFICIENT_PERSON_IDENTITY', 'MEDIUM',
      `"${name}" is not shaped like a personal name`);
  }

  // Two or more capitalised words, no firm words, not the company, not a literal.
  if (fromAuthorArchive) {
    reasons.push('read from a CMS author listing, which names whoever typed the post');
    return decide('LIKELY_PERSON', 'MEDIUM',
      'a full name, though its source only proves somebody published a page');
  }
  const corroborated = PERSON_TITLE.test(input.rawTitle ?? '')
    || PEOPLE_PAGE.test(input.sourceReference ?? '');
  return corroborated
    ? decide('VALID_PERSON', 'HIGH',
        'a full name carrying a person\'s title or found where a company introduces its people')
    : decide('LIKELY_PERSON', 'MEDIUM',
        'a full name with nothing arguing against it, and nothing corroborating it either');
}

/** Convenience for the callers that only need the gate. */
export function mayBeDecisionMaker(input: PersonIdentityInput): boolean {
  return judgePersonIdentity(input).mayHoldDecisionMakerAuthority;
}
