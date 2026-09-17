import { closePool, query, withTransaction } from '../db/pool.js';
import { recordEvidence } from '../domain/accounts.js';
import { normalizeCompanyName } from '../domain/normalize.js';
import { readSiteIdentity } from '../resolver/siteIdentity.js';

/**
 * Ask every Account's own site what it calls itself.
 *
 *   npm run identity:estate -- --dry-run      read, report, write nothing
 *   npm run identity:estate                   read and record the evidence
 *   npm run identity:estate -- --limit 20     a measured first wave
 *
 * One polite request per Account homepage, through the same fetcher the research worker
 * uses: robots respected, one request at a time per host, fifteen-second ceiling. No
 * provider is called and nothing is bought.
 *
 * Why this exists, in one example. Production holds an Account named "10 Best Roofers in
 * St. Augustine, FL" whose domain is todayshomeowner.com. Nothing in the database can
 * tell that apart from a real contractor with a badly-written page title, because both
 * are a name and a domain. Asking the site settles it: this one calls itself "Today's
 * Homeowner", which is not the name on the record, so the record is a page on somebody
 * else's site rather than a company.
 *
 * The evidence is recorded as an observation about the site and nothing is concluded
 * from it here. What reads it decides what it means.
 */

interface Options { dryRun: boolean; limit: number | null }

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--limit') options.limit = Number(argv[i += 1]);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { rows: accounts } = await query<{
    account_id: string; canonical_name: string; canonical_domain: string | null;
  }>(
    `select account_id, canonical_name, canonical_domain
       from accounts
      where merged_into_account_id is null and canonical_domain is not null
      order by created_at
      ${options.limit ? `limit ${Math.max(1, Math.floor(options.limit))}` : ''}`);

  console.log(`asking ${accounts.length} site(s) what they call themselves`);
  let named = 0;
  let unreadable = 0;
  let mismatched = 0;

  for (const account of accounts) {
    const { identity, reason } = await readSiteIdentity(
      `https://${account.canonical_domain}`, account.canonical_domain);

    if (!identity) {
      unreadable += 1;
      console.log(`  ${account.canonical_domain}: ${reason}`);
      continue;
    }

    named += 1;
    const storedName = normalizeCompanyName(account.canonical_name);
    const siteName = normalizeCompanyName(identity.name);
    const agrees = siteName.length > 0
      && (storedName === siteName || storedName.includes(siteName) || siteName.includes(storedName));
    if (!agrees) mismatched += 1;

    console.log(`  ${account.canonical_domain}: "${identity.name}" (${identity.basis})`
      + (agrees ? '' : `  <- the record is called "${account.canonical_name}"`));

    if (options.dryRun) continue;

    await withTransaction((client) => recordEvidence(client, {
      accountId: account.account_id,
      category: 'identity',
      claimKey: 'first_party_site_name',
      claimText: `The site calls itself "${identity.name}"`,
      normalizedValue: siteName,
      // The site said it about itself. That is as confirmed as a self-description gets,
      // and it is still a self-description: it says what the site claims to be.
      confidence: 'confirmed',
      canStateAsFact: true,
      sourceType: 'first_party',
      sourceReference: identity.sourceReference,
      expiresAt: new Date(Date.now() + 180 * 86_400_000),
      precedenceRank: 2,
      notes: `basis=${identity.basis}`,
    }));
  }

  console.log('');
  console.log(`sites that named themselves      ${named}`);
  console.log(`  of which the name disagrees    ${mismatched}`);
  console.log(`sites that could not be read     ${unreadable}`);
  if (options.dryRun) console.log('dry run: no evidence was written');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());
