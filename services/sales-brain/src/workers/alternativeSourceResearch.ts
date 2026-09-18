import { query } from '../db/pool.js';
import { registerHandler, type JobRecord, type JobResult } from './runner.js';
import { availableDiscoveryAdapters } from './marketMiner.js';
import { classifySourceRole, isFirstParty, provenanceForRole } from '../discovery/sourceRole.js';
import { registrableDomain } from '../discovery/sourceClass.js';

/**
 * Researching a company from sources that are not its own server.
 *
 * The measurement that made this necessary: of 42 Accounts whose websites Sales Brain
 * could not read, a hand audit found exactly one that an ordinary client could read. The
 * other 41 refuse everybody -- 37 behind a captcha challenge, one parked, one deactivated
 * by its website provider, one silent. No crawler change recovers them, and eleven more
 * are disallowed by robots.txt, where trying harder would be the wrong thing rather than
 * an ineffective one.
 *
 * So the company's own inaccessible server stops being the only place we look. What this
 * gathers is third-party by construction and is recorded as such: a directory saying
 * something about a company is not the company saying it, and `can_state_as_fact` stays
 * false for everything here.
 */

registerHandler('alternative_source_research', async (job: JobRecord): Promise<JobResult> => {
  const accountId = String(job.payload['account_id'] ?? '');
  const why = String(job.payload['reason'] ?? 'first-party research was not possible');
  if (!accountId) return { outcome: 'NOTHING_TO_DO', outcomeReason: 'no account named' };

  const { rows } = await query<{
    canonical_name: string; canonical_domain: string | null;
    phone: string | null; city: string | null; region: string | null;
  }>(
    `select a.canonical_name, a.canonical_domain,
            (select ce.normalized_value from contact_endpoints ce
              where ce.account_id = a.account_id and ce.endpoint_type = 'PHONE'
                and ce.is_active order by ce.observed_at desc limit 1) as phone,
            l.city, l.state_region as region
       from accounts a
       left join locations l on l.account_id = a.account_id
            and l.location_type = 'physical' and l.is_active
      where a.account_id = $1 limit 1`, [accountId]);

  const account = rows[0];
  if (!account) return { outcome: 'NOTHING_TO_DO', outcomeReason: 'the Account is gone' };

  const adapter = availableDiscoveryAdapters()[0];
  if (!adapter) {
    return { outcome: 'PROVIDER_UNAVAILABLE',
      outcomeReason: 'No provider is configured, so no alternative source could be asked. '
        + 'Nothing was bought and nothing was concluded about the company.' };
  }

  const place = [account.city, account.region].filter(Boolean).join(', ');
  const result = await adapter.discover({
    verticalProfileId: null, geographyType: place ? 'CITY' : null,
    geographyValue: place || null, miningMode: 'STANDARD', queryBudget: 1,
    jobId: job.job_id,
    search: {
      keyword: [`"${account.canonical_name}"`, place].filter(Boolean).join(' '),
      locationName: place || 'United States', term: account.canonical_name,
      fingerprint: `alternative_source:${accountId}`, index: 0,
      // It enriches a company we already hold. It may never decide market membership.
      purpose: 'COMMERCIAL_INTELLIGENCE', coverageRole: 'SECONDARY',
    },
  });

  if (result.status === 'PENDING') {
    return { outcome: 'PROVIDER_PENDING',
      outcomeReason: 'The provider accepted the search; its result is not back yet.' };
  }

  let recorded = 0;
  const roles = new Map<string, number>();
  for (const observation of result.observations ?? []) {
    const url = observation.landingUrl
      ?? (observation.observedDomain ? `https://${observation.observedDomain}` : null);
    if (!url) continue;

    const verdict = classifySourceRole({
      url, title: observation.observedName,
      companyName: account.canonical_name,
      companyPhone: account.phone,
      publishedPhones: observation.observedPhone ? [observation.observedPhone] : [],
      publishedAddresses: observation.observedBusinessAddress
        ? [observation.observedBusinessAddress] : [],
    });
    roles.set(verdict.role, (roles.get(verdict.role) ?? 0) + 1);

    /**
     * The company's own site is not an alternative source.
     *
     * If it turns up here it is the same server that refused us, reached through a
     * provider's index. Recording it as first-party would launder a refusal into a
     * reading, so it is skipped rather than borrowed.
     */
    if (isFirstParty(verdict.role)
        && registrableDomain(url) === registrableDomain(account.canonical_domain ?? '')) {
      continue;
    }

    await query(
      `insert into evidence_records
         (account_id, category, claim_key, claim_text, normalized_value, confidence,
          can_state_as_fact, source_provider, source_type, source_reference, observed_at,
          notes, fact_provenance)
       values ($1, 'identity', 'alternative_source_observation', $2, $3, 'LOW', false,
               $4, 'PROVIDER_SEARCH', $5, now(), $6, $7)`,
      [accountId,
       `${adapter.name} returned ${observation.observedName ?? url} for `
         + `${account.canonical_name}.`,
       observation.observedName ?? url, adapter.name, url,
       `source_role=${verdict.role}; ${verdict.reasons.join('; ')}`.slice(0, 600),
       provenanceForRole(verdict.role, false)],
    );
    recorded += 1;
  }

  const summary = [...roles].sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${role}×${n}`).join(', ');
  return {
    outcome: recorded > 0 ? 'COMPLETED' : 'ZERO_RESULTS',
    outcomeReason: recorded > 0
      ? `${recorded} third-party observation(s) recorded for an Account whose own site `
        + `could not be read (${why}). Sources: ${summary}. None of this is the company `
        + 'speaking for itself, and none of it is stated as fact.'
      : `Nothing usable was returned for ${account.canonical_name}. The Account keeps `
        + 'everything it had.',
  };
});
