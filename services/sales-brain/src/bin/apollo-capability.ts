import { readFileSync } from 'node:fs';
import { apolloConfig, createApolloAdapter } from '../providers/apollo/client.js';

/**
 * The smallest real check of what this Apollo account can actually do.
 *
 *   npm run apollo:capability
 *
 * Deliberately minimal and mostly free. `usage_stats` costs nothing and lists the
 * endpoints the key is rate-limited for, which is a capability probe by itself. People
 * search costs nothing. Only the two enrichment probes can charge, and they charge only
 * if they match -- Apollo does not bill a `match_confidence` of none.
 *
 * Phone reveal and the waterfalls are NOT probed. Asking for a mobile costs eight credits
 * and there is no way to ask whether it would work without asking, so they are reported
 * as untested rather than guessed at. That is the honest answer and the cheap one.
 *
 * Nothing here writes to any database. It reads the environment for a credential and
 * prints what came back.
 */

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

async function main(): Promise<void> {
  const settings = apolloConfig();
  if (!settings.apiKey) {
    console.error('No APOLLO_API_KEY is configured. Nothing was asked.');
    process.exitCode = 2;
    return;
  }
  // Probing requires the adapter to answer; the global switch governs the workers.
  const adapter = createApolloAdapter({ config: { ...settings, enabled: true } });

  console.log('APOLLO CAPABILITY CHECK');
  console.log('  the credential is read from the environment and never printed\n');

  /* 1. Free: what is this key allowed to call, and what are its limits? */
  const usage = await adapter.usageStats();
  line('usage_stats', usage.ok ? `AVAILABLE (HTTP ${usage.httpStatus})`
    : `NOT AVAILABLE (HTTP ${usage.httpStatus}, ${usage.errorClassification})`);
  if (usage.ok && usage.data) {
    const interesting = usage.data.perEndpoint.filter((e) =>
      /people|organization|match|search|usage/i.test(e.endpoint));
    for (const entry of interesting.slice(0, 12)) {
      line(`  ${entry.endpoint}`,
        `day ${entry.day.consumed ?? '?'}/${entry.day.limit ?? '?'}  `
        + `hour ${entry.hour.consumed ?? '?'}/${entry.hour.limit ?? '?'}  `
        + `minute ${entry.minute.consumed ?? '?'}/${entry.minute.limit ?? '?'}`);
    }
    if (interesting.length === 0) line('  (no per-endpoint limits returned)', '');
  }

  /* 2. Free: people search against a company that certainly exists. */
  const search = await adapter.searchPeople({
    organizationDomains: ['apollo.io'], personTitles: ['Owner', 'Founder', 'President'],
    perPage: 1,
  });
  line('people search', search.ok
    ? `AVAILABLE (HTTP ${search.httpStatus}, ${search.data?.totalEntries ?? 0} total, `
      + `${search.data?.people.length ?? 0} returned, ${search.cost.creditsEstimated} credits)`
    : `NOT AVAILABLE (HTTP ${search.httpStatus}, ${search.errorClassification})`);

  const probePerson = search.data?.people[0] ?? null;
  if (probePerson) {
    line('  sample candidate', `${probePerson.title ?? 'no title'} · `
      + `has_email=${probePerson.hasEmail} · has_direct_phone=${probePerson.hasDirectPhone}`);
  }

  /* 3. Paid, but only if it matches: one person. */
  const enrich = probePerson
    ? await adapter.enrichPerson({ apolloPersonId: probePerson.apolloPersonId,
        revealPhoneNumber: false, revealPersonalEmails: false })
    : null;
  line('people enrichment', enrich
    ? (enrich.ok
      ? `AVAILABLE (HTTP ${enrich.httpStatus}, confidence ${enrich.data?.matchConfidence ?? 'none'}, `
        + `email ${enrich.data?.email ? 'returned' : 'not returned'}, `
        + `~${enrich.cost.creditsEstimated} credit(s))`
      : `NOT AVAILABLE (HTTP ${enrich.httpStatus}, ${enrich.errorClassification})`)
    : 'NOT TESTED (people search returned nobody to enrich)');

  /* 4. Paid, same rule: the bulk form with a single member. */
  const bulk = probePerson
    ? await adapter.enrichPeopleBulk([{ apolloPersonId: probePerson.apolloPersonId,
        revealPhoneNumber: false }])
    : null;
  line('bulk people enrichment', bulk
    ? (bulk.ok
      ? `AVAILABLE (HTTP ${bulk.httpStatus}, ${bulk.data?.length ?? 0} returned, `
        + `~${bulk.cost.creditsEstimated} credit(s))`
      : `NOT AVAILABLE (HTTP ${bulk.httpStatus}, ${bulk.errorClassification})`)
    : 'NOT TESTED');

  /* 5. Paid, one credit. */
  const org = await adapter.enrichOrganization('apollo.io');
  line('organization enrichment', org.ok
    ? `AVAILABLE (HTTP ${org.httpStatus}, ${org.data?.name ?? 'no name'}, `
      + `~${org.cost.creditsEstimated} credit(s))`
    : `NOT AVAILABLE (HTTP ${org.httpStatus}, ${org.errorClassification})`);

  /* 6 and 7: deliberately not probed. */
  line('phone enrichment', 'NOT TESTED — a reveal costs 8 credits and there is no way to '
    + 'ask whether it would work without asking');
  line('waterfall (email/phone)', 'NOT TESTED — activating it is the only way to probe it');

  console.log('\n  credit balance: Apollo exposes no balance endpoint. usage_stats reports');
  console.log('  rate limits, not credits, so a balance is UNKNOWN rather than estimated.');
}

main().catch((error) => {
  // Never print the error object: a failed request can carry request headers.
  console.error('capability check failed:', (error as Error).message);
  process.exitCode = 1;
});
