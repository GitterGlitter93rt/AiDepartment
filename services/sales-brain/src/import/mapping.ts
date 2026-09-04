/**
 * Column mapping.
 * Authority: market-miner-lead-import-export-spec.md §5.
 *
 * Unknown columns are kept in the raw payload only. We never create database
 * columns from arbitrary spreadsheet headers.
 */

export type CanonicalField =
  | 'company' | 'domain' | 'phone' | 'email' | 'contact_name' | 'contact_first_name'
  | 'contact_last_name' | 'contact_title' | 'direct_phone' | 'address' | 'city' | 'state'
  | 'postal_code' | 'industry' | 'provider_id' | 'notes';

/**
 * Header synonyms, lowercased and stripped of punctuation. Ordered by specificity:
 * `direct_phone` is checked before `phone` so a column called "Direct Phone" is not
 * swallowed by the generic phone matcher.
 */
const FIELD_SYNONYMS: [CanonicalField, string[]][] = [
  ['provider_id', ['apolloid', 'apollo id', 'recordid', 'record id', 'externalid', 'id']],
  ['contact_first_name', ['firstname', 'first name', 'givenname']],
  ['contact_last_name', ['lastname', 'last name', 'surname', 'familyname']],
  ['contact_name', ['contactname', 'contact name', 'fullname', 'full name', 'name', 'person', 'owner name', 'ownername']],
  ['contact_title', ['title', 'jobtitle', 'job title', 'position', 'role']],
  ['direct_phone', ['directphone', 'direct phone', 'directdial', 'direct dial', 'mobile', 'mobilephone', 'cell', 'cellphone', 'personalphone']],
  ['company', ['company', 'companyname', 'company name', 'business', 'businessname', 'business name', 'account', 'accountname', 'organization', 'organisation', 'dba']],
  ['domain', ['domain', 'website', 'websiteurl', 'website url', 'url', 'companywebsite', 'web', 'site']],
  ['phone', ['phone', 'phonenumber', 'phone number', 'companyphone', 'businessphone', 'business phone', 'mainphone', 'main phone', 'telephone', 'office phone', 'officephone']],
  ['email', ['email', 'emailaddress', 'email address', 'workemail', 'work email', 'contactemail']],
  ['address', ['address', 'address1', 'addressline1', 'street', 'streetaddress', 'companyaddress']],
  ['city', ['city', 'town', 'companycity', 'locality']],
  ['state', ['state', 'province', 'region', 'companystate', 'stateprovince']],
  ['postal_code', ['zip', 'zipcode', 'zip code', 'postal', 'postalcode', 'postal code', 'companyzip']],
  ['industry', ['industry', 'vertical', 'category', 'sector', 'businesstype', 'primaryindustry']],
  ['notes', ['notes', 'note', 'comments', 'description']],
];

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type ColumnMap = Partial<Record<CanonicalField, string>>;

/**
 * Builds a header -> canonical field map. Each canonical field binds to at most one
 * column, and each column to at most one field, so a sheet with both "Phone" and
 * "Business Phone" does not double-map.
 */
export function inferColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const claimed = new Set<string>();

  for (const [field, synonyms] of FIELD_SYNONYMS) {
    for (const header of headers) {
      if (claimed.has(header)) continue;
      const normalized = normalizeHeader(header);
      const compact = normalized.replace(/\s/g, '');
      if (synonyms.includes(normalized) || synonyms.includes(compact)) {
        map[field] = header;
        claimed.add(header);
        break;
      }
    }
  }
  return map;
}

export interface MappedRow {
  company: string | null;
  domain: string | null;
  phone: string | null;
  directPhone: string | null;
  email: string | null;
  contactName: string | null;
  contactTitle: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  industry: string | null;
  providerId: string | null;
  notes: string | null;
}

export function applyColumnMap(row: Record<string, string>, map: ColumnMap): MappedRow {
  const get = (field: CanonicalField): string | null => {
    const column = map[field];
    if (!column) return null;
    const value = row[column]?.trim();
    return value ? value : null;
  };

  const first = get('contact_first_name');
  const last = get('contact_last_name');
  const combined = [first, last].filter(Boolean).join(' ').trim();

  return {
    company: get('company'),
    domain: get('domain'),
    phone: get('phone'),
    directPhone: get('direct_phone'),
    email: get('email'),
    contactName: get('contact_name') ?? (combined || null),
    contactTitle: get('contact_title'),
    address: get('address'),
    city: get('city'),
    state: get('state'),
    postalCode: get('postal_code'),
    industry: get('industry'),
    providerId: get('provider_id'),
    notes: get('notes'),
  };
}

/**
 * Maps a source industry label to a YAD vertical profile id.
 * Source taxonomies are coarse hints, never authority: a miss returns null and
 * research decides later, rather than rejecting an otherwise good prospect
 * (import spec §10).
 */
const INDUSTRY_HINTS: [string, RegExp][] = [
  ['hvac', /hvac|heating|air condition|\bac\b|cooling|furnace|heat pump/i],
  ['plumbing', /plumb|drain|septic|water heater/i],
  ['roofing', /roof/i],
  ['electrical', /electric(al|ian)/i],
  ['collision-repair', /collision|auto body|autobody|body shop/i],
  ['pdr-hail', /dent repair|paintless|hail/i],
  ['law-firms', /law|legal|attorney|solicitor/i],
  ['dental', /dental|dentist|orthodont/i],
  ['med-spas', /med ?spa|medspa|aesthetic|cosmetic clinic/i],
  ['restoration', /restoration|water damage|fire damage|mold remediation/i],
  ['garage-door', /garage door|overhead door/i],
  ['real-estate-brokerages', /real estate|brokerage|realty|realtor/i],
  ['general-contractors-remodeling', /general contract|remodel|renovation|home improvement|construction/i],
];

export function verticalHintFor(industry: string | null): string | null {
  if (!industry) return null;
  for (const [vertical, pattern] of INDUSTRY_HINTS) {
    if (pattern.test(industry)) return vertical;
  }
  return null;
}
