import { query } from '../db/pool.js';
import { registerHandler, type JobRecord, type JobResult } from './runner.js';
import { availableDiscoveryAdapters } from './marketMiner.js';
import { classifySourceRole, nameMatchesDomain, addressesMatch } from '../discovery/sourceRole.js';
import { registrableDomain } from '../discovery/sourceClass.js';
import { judgeDomain } from '../domain/domainValidity.js';
import { normalizePhone } from '../domain/normalize.js';

/**
 * Finding a company's website when the record does not have one.
 *
 * NO_WEBSITE is not a transient failure, so retrying an empty URL hourly would be a loop
 * that learns nothing; 49 production Accounts are in that state and a further set have a
 * domain that answers 404 on every host. The useful work is a grounded search for the
 * company itself, which is a different question with a different cost.
 *
 * What it will not do is write a domain onto an Account because a search returned one.
 * A candidate needs corroboration -- the name and the domain agreeing, plus a phone or an
 * address we already knew independently -- and anything short of that is recorded as a
 * candidate for a person. The rule is the same one that governs every other identity
 * claim here: unknown is better than wrong.
 */

export interface DomainCandidate {
  domain: string;
  url: string | null;
  name: string | null;
  reasons: string[];
  /** Corroborated well enough to become the Account's website without a person. */
  confident: boolean;
}

/**
 * Judges the rows a grounded company search returned.
 *
 * Exported and pure, because this is the part worth testing: the provider call is
 * plumbing and this is the decision.
 */
export function chooseDomain(input: {
  companyName: string;
  knownPhone?: string | null;
  knownAddress?: string | null;
  observations: readonly {
    observedName: string | null; observedDomain: string | null;
    observedPhone: string | null; observedBusinessAddress: string | null;
    landingUrl: string | null;
  }[];
}): DomainCandidate | null {
  const byDomain = new Map<string, DomainCandidate>();
  const wantedPhone = input.knownPhone ? normalizePhone(input.knownPhone) : null;

  for (const row of input.observations) {
    const domain = registrableDomain(row.observedDomain ?? row.landingUrl);
    if (!domain) continue;
    // A name that cannot resolve publicly is never the answer to "where is this
    // company's website". proofroof.invalid is the production instance.
    if (!judgeDomain(domain).usableAsWebsite) continue;

    // A directory, a publisher or a licensing portal can carry a company's name and
    // phone and still not be its website. The role model decides that, not the fact
    // that the row matched our search.
    const role = classifySourceRole({
      url: row.landingUrl ?? `https://${domain}`,
      title: row.observedName,
      companyName: input.companyName,
      companyPhone: input.knownPhone ?? null,
      companyAddress: input.knownAddress ?? null,
      publishedPhones: row.observedPhone ? [row.observedPhone] : [],
      publishedAddresses: row.observedBusinessAddress ? [row.observedBusinessAddress] : [],
    });
    if (role.role !== 'COMPANY_OWNED_SITE' && role.role !== 'COMPANY_LOCATION_PAGE') continue;

    const reasons = [...role.reasons];
    const nameAgrees = nameMatchesDomain(input.companyName, domain);
    const phoneAgrees = Boolean(wantedPhone && row.observedPhone
      && normalizePhone(row.observedPhone) === wantedPhone);
    const addressAgrees = Boolean(input.knownAddress && row.observedBusinessAddress
      && addressesMatch(input.knownAddress, row.observedBusinessAddress));

    // Two independent things have to agree: what the company is called, and how to
    // reach it. A name that matches a domain is the commonest coincidence in this data
    // -- every lead-gen site in the trade is named after the trade -- and a phone on a
    // directory listing proves the directory has the phone.
    const confident = nameAgrees && (phoneAgrees || addressAgrees);
    if (phoneAgrees) reasons.push('the phone we already held is published here');
    if (addressAgrees) reasons.push('the address we already held is published here');

    const existing = byDomain.get(domain);
    if (!existing || (confident && !existing.confident)) {
      byDomain.set(domain, {
        domain, url: row.landingUrl ?? `https://${domain}`,
        name: row.observedName, reasons, confident,
      });
    }
  }

  const candidates = [...byDomain.values()];
  if (candidates.length === 0) return null;

  // Two different confident domains is not a better answer than one; it is a question.
  const confident = candidates.filter((c) => c.confident);
  if (confident.length === 1) return confident[0]!;
  if (confident.length > 1) {
    return { ...confident[0]!, confident: false,
      reasons: [...confident[0]!.reasons,
        `${confident.length} different domains corroborate equally, so a person decides`] };
  }
  return { ...candidates[0]!, confident: false };
}

registerHandler('domain_resolution', async (job: JobRecord): Promise<JobResult> => {
  const accountId = String(job.payload['account_id'] ?? '');
  if (!accountId) return { outcome: 'NOTHING_TO_DO', outcomeReason: 'no account named' };

  const { rows } = await query<{
    canonical_name: string; canonical_domain: string | null;
    phone: string | null; address: string | null; city: string | null; region: string | null;
  }>(
    `select a.canonical_name, a.canonical_domain,
            (select ce.normalized_value from contact_endpoints ce
              where ce.account_id = a.account_id and ce.endpoint_type = 'PHONE'
                and ce.is_active order by ce.observed_at desc limit 1) as phone,
            l.address_line_1 as address, l.city, l.state_region as region
       from accounts a
       left join locations l on l.account_id = a.account_id
            and l.location_type = 'physical' and l.is_active
      where a.account_id = $1
      limit 1`, [accountId]);

  const account = rows[0];
  if (!account) return { outcome: 'NOTHING_TO_DO', outcomeReason: 'the Account is gone' };

  const adapter = availableDiscoveryAdapters()[0];
  if (!adapter) {
    return { outcome: 'PROVIDER_UNAVAILABLE',
      outcomeReason: 'No discovery provider is configured, so the company could not be '
        + 'searched for. Nothing was bought and nothing was concluded.' };
  }

  // Grounded by everything we actually hold. A bare company name in a trade full of
  // generic names returns whoever bought the keyword.
  const place = [account.city, account.region].filter(Boolean).join(', ');
  const keyword = [`"${account.canonical_name}"`, place].filter(Boolean).join(' ');

  const result = await adapter.discover({
    verticalProfileId: null, geographyType: place ? 'CITY' : null,
    geographyValue: place || null, miningMode: 'STANDARD', queryBudget: 1,
    jobId: job.job_id,
    search: {
      keyword, locationName: place || 'United States', term: account.canonical_name,
      fingerprint: `domain_resolution:${accountId}`, index: 0,
      // It may confirm and enrich a company we already have. It may not decide who is
      // in a market, and this Account is already in one.
      purpose: 'COMMERCIAL_INTELLIGENCE', coverageRole: 'SECONDARY',
    },
  });

  if (result.status === 'PENDING') {
    return { outcome: 'PROVIDER_PENDING',
      outcomeReason: 'The provider accepted the search; its result is not back yet.' };
  }

  const candidate = chooseDomain({
    companyName: account.canonical_name,
    knownPhone: account.phone, knownAddress: account.address,
    observations: result.observations ?? [],
  });

  if (!candidate) {
    return { outcome: 'ZERO_RESULTS',
      outcomeReason: `Nothing in the results looked like ${account.canonical_name}'s own `
        + 'website. The Account keeps everything it had.' };
  }

  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_provider, source_type, source_reference, observed_at, notes)
     values ($1, 'IDENTITY', 'candidate_website', $2, $3, $4, $5, $6, 'PROVIDER_SEARCH',
             $7, now(), $8)`,
    [accountId,
     `A grounded search for ${account.canonical_name} found ${candidate.domain}.`,
     candidate.domain, candidate.confident ? 'HIGH' : 'LOW', candidate.confident,
     adapter.name, candidate.url, candidate.reasons.join('; ').slice(0, 600)],
  );

  if (!candidate.confident) {
    return { outcome: 'PARTIAL',
      outcomeReason: `${candidate.domain} is a candidate website for `
        + `${account.canonical_name}, recorded for review. It was not written to the `
        + 'Account: a name matching a domain is the commonest coincidence in this data.' };
  }

  // Corroborated. Recorded onto the Account only where it had nothing, so this can
  // never quietly replace a website somebody already established.
  const written = await query(
    `update accounts set canonical_domain = $2, updated_at = now()
      where account_id = $1 and canonical_domain is null
      returning account_id`, [accountId, candidate.domain]);

  return { outcome: 'COMPLETED',
    outcomeReason: written.rows.length > 0
      ? `Website resolved to ${candidate.domain} (${candidate.reasons.join('; ')}).`
      : `${candidate.domain} is corroborated, but the Account already has a website, so `
        + 'it was recorded as evidence and not written.' };
});
