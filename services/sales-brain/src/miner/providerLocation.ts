import { query } from '../db/pool.js';
import type { NormalizedGeography } from './geography.js';

/**
 * Turning a market into something the provider can target.
 *
 * DataForSEO takes a `location_name` like "Jacksonville,Florida,United States". It
 * does not take a ZIP code: a bare "32095" is not a place it resolves, so the search
 * either fails or silently widens to somewhere else entirely. The miner was sending
 * exactly that.
 *
 * A ZIP is resolved from our own inventory -- we know 32095 is St. Augustine, Florida
 * because we hold accounts there -- and the ZIP is kept in the query text as well,
 * because a city is wider than a ZIP and the query is what narrows it back.
 *
 * A ZIP we have never seen is not guessed at. The query carries it and the targeting
 * falls back to the country, which is honest about what we can and cannot narrow.
 */

export interface ProviderTarget {
  /** What goes in the provider's location field. */
  locationName: string;
  /** Appended to the search term when the location cannot express the market. */
  keywordSuffix: string;
  /** How the geography was resolved, for the operator and for tests. */
  precision: 'CITY' | 'STATE' | 'ZIP_RESOLVED' | 'ZIP_UNRESOLVED';
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/**
 * Which town a ZIP is in, according to the inventory we already hold.
 *
 * The most-held city wins when a ZIP straddles more than one, and a tie is broken by
 * name so the answer is the same on every run: an unstable target is an unstable
 * fingerprint, and an unstable fingerprint is a second paid search.
 */
export async function cityForPostalCode(
  postalCode: string,
): Promise<{ city: string; state: string } | null> {
  const { rows } = await query<{ city: string; state_region: string }>(
    `select l.city, l.state_region
       from locations l
      where l.postal_code = $1 and l.city is not null and l.state_region is not null
      group by l.city, l.state_region
      order by count(*) desc, l.city asc
      limit 1`,
    [postalCode],
  );
  const row = rows[0];
  return row ? { city: row.city, state: row.state_region } : null;
}

export async function providerTargetFor(
  geography: NormalizedGeography,
): Promise<ProviderTarget> {
  if (geography.type === 'city') {
    const stateName = geography.state ? STATE_NAMES[geography.state] : null;
    return {
      locationName: stateName
        ? `${geography.value},${stateName},United States`
        : `${geography.value},United States`,
      keywordSuffix: '',
      precision: 'CITY',
    };
  }

  if (geography.type === 'state') {
    return {
      locationName: `${STATE_NAMES[geography.value] ?? geography.value},United States`,
      keywordSuffix: '',
      precision: 'STATE',
    };
  }

  const known = await cityForPostalCode(geography.value);
  if (known) {
    return {
      locationName: `${known.city},${STATE_NAMES[known.state] ?? known.state},United States`,
      // The city is wider than the ZIP, so the ZIP goes in the query to narrow it.
      keywordSuffix: geography.value,
      precision: 'ZIP_RESOLVED',
    };
  }

  return {
    // A ZIP we have never seen is not guessed into a town. The query carries it and
    // the targeting says only what we actually know.
    locationName: 'United States',
    keywordSuffix: geography.value,
    precision: 'ZIP_UNRESOLVED',
  };
}
