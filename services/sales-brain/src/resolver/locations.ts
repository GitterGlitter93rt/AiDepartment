import type { Queryable } from '../db/pool.js';
import { recordEvidence } from '../domain/accounts.js';
import { addressKey, type AddressObservation, type ServiceAreaObservation } from './address.js';

/**
 * Writing down where a company is, with how we know it.
 *
 * Only ever from a company's own published claim. Nothing in this file may be reached
 * with a searched ZIP, a searched city or a market name, and the shape of the write
 * makes that visible rather than trusting the caller: every row carries the URL it was
 * read from, and a row with no source reference cannot be produced here at all.
 *
 * Service areas are written as evidence and not as locations. The distinction is the
 * point of the work: a service area is a claim about where a company will travel, and
 * the 66 rows production still holds are the searched ZIP typed as one. Giving the
 * claim its own vocabulary keeps it from ever being read as a place of business again.
 */

export interface LocationWriteResult {
  physical: number;
  mailing: number;
  serviceAreas: number;
}

const MAX_LOCATIONS = 25;
const MAX_SERVICE_AREAS = 40;

/** How long a published address is treated as current before it is re-read. */
const ADDRESS_TTL_DAYS = 180;

export async function persistPublishedLocations(
  client: Queryable,
  input: {
    accountId: string;
    researchRunId?: string | null;
    addresses: AddressObservation[];
    serviceAreas: ServiceAreaObservation[];
  },
): Promise<LocationWriteResult> {
  const result: LocationWriteResult = { physical: 0, mailing: 0, serviceAreas: 0 };

  for (const address of input.addresses.slice(0, MAX_LOCATIONS)) {
    // Defence in depth rather than politeness: an address with nothing to say where it
    // came from is the exact row this work exists to stop, whoever assembled it.
    if (!address.sourceReference || !address.streetAddress) continue;

    const locationType = address.kind === 'MAILING' ? 'mailing' : 'physical';
    const { rows: existing } = await client.query<{ location_id: string }>(
      `select location_id from locations
        where account_id = $1
          and lower(regexp_replace(coalesce(address_line_1,''), '[^a-zA-Z0-9]+', ' ', 'g'))
              = lower(regexp_replace($2, '[^a-zA-Z0-9]+', ' ', 'g'))
          and coalesce(postal_code,'') = coalesce($3,'')
        limit 1`,
      [input.accountId, address.streetAddress, address.postalCode],
    );

    let locationId: string;
    if (existing[0]) {
      locationId = existing[0].location_id;
      await client.query(
        `update locations set
           city = coalesce(city, $2),
           state_region = coalesce(state_region, $3),
           postal_code = coalesce(postal_code, $4),
           location_type = $5,
           basis = $6,
           source_reference = $7,
           first_observed_at = coalesce(first_observed_at, $8),
           last_verified_at = $8
         where location_id = $1`,
        [locationId, address.locality, address.region, address.postalCode,
         locationType, address.basis, address.sourceReference, address.observedAt],
      );
    } else {
      const { rows } = await client.query<{ location_id: string }>(
        `insert into locations (account_id, address_line_1, city, state_region, postal_code,
                                country_code, location_type, basis, source_reference,
                                first_observed_at, last_verified_at, is_headquarters)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,
                 -- The first physical address a company publishes is treated as its
                 -- head office only when it has no other; a second one is a branch
                 -- until somebody says otherwise.
                 $7 = 'physical' and not exists (
                   select 1 from locations
                    where account_id = $1 and location_type = 'physical'))
         returning location_id`,
        [input.accountId, address.streetAddress, address.locality, address.region,
         address.postalCode, address.countryCode, locationType, address.basis,
         address.sourceReference, address.observedAt],
      );
      locationId = rows[0]!.location_id;
    }

    await recordEvidence(client, {
      accountId: input.accountId,
      locationId,
      researchRunId: input.researchRunId ?? null,
      category: 'location',
      claimKey: address.kind === 'MAILING' ? 'mailing_address' : 'physical_address',
      // The company's own words, not our parse of them, so a reviewer checks the claim.
      claimText: address.rawText,
      normalizedValue: addressKey(address),
      // The company published it. That is as confirmed as an observation gets, and it
      // is still an observation: it says what the site claims, not that a van is there.
      confidence: 'confirmed',
      canStateAsFact: true,
      sourceType: 'first_party',
      sourceReference: address.sourceReference,
      expiresAt: new Date(address.observedAt.getTime() + ADDRESS_TTL_DAYS * 86_400_000),
      precedenceRank: 2,
      notes: `basis=${address.basis}`,
    });

    if (address.kind === 'MAILING') result.mailing += 1; else result.physical += 1;
  }

  for (const area of input.serviceAreas.slice(0, MAX_SERVICE_AREAS)) {
    if (!area.sourceReference || !area.areaText.trim()) continue;
    await recordEvidence(client, {
      accountId: input.accountId,
      researchRunId: input.researchRunId ?? null,
      category: 'location',
      claimKey: 'service_area',
      claimText: `Says it serves ${area.areaText}`,
      normalizedValue: area.areaText.toLowerCase(),
      confidence: 'confirmed',
      canStateAsFact: true,
      sourceType: 'first_party',
      sourceReference: area.sourceReference,
      expiresAt: new Date(area.observedAt.getTime() + ADDRESS_TTL_DAYS * 86_400_000),
      precedenceRank: 2,
      notes: `basis=${area.basis}`,
    });
    result.serviceAreas += 1;
  }

  return result;
}
