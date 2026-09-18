import { closePool, query } from '../db/pool.js';

/**
 * What the money bought.
 *
 * Michael authorized spend without a cap and with a condition: every paid request is
 * measured for yield, and a query family stops when its marginal yield of new companies
 * collapses rather than when a dollar figure is reached. This is the report that makes
 * that decidable, and the two numbers at the bottom are the ones that say whether the
 * sprint worked -- cost per net-new verified company, and cost per named decision maker.
 *
 *   npm run yield:report
 *   npm run yield:report -- --since 2026-09-17
 */

interface Row { label: string; searches: number; costUsd: number; companies: number;
                duplicates: number; rejected: number; }

function parseSince(argv: string[]): string {
  const index = argv.indexOf('--since');
  return index >= 0 && argv[index + 1] ? argv[index + 1]! : '2026-09-17';
}

function table(title: string, rows: Row[]): void {
  console.log(`\n${title}`);
  console.log('  ' + 'label'.padEnd(34) + 'searches'.padStart(9) + 'spend'.padStart(9)
    + 'new'.padStart(7) + 'dupes'.padStart(7) + 'rejected'.padStart(9) + '$/new'.padStart(9));
  for (const row of rows) {
    const perNew = row.companies > 0 ? `$${(row.costUsd / row.companies).toFixed(4)}` : '—';
    console.log('  ' + row.label.slice(0, 33).padEnd(34)
      + String(row.searches).padStart(9)
      + `$${row.costUsd.toFixed(4)}`.padStart(9)
      + String(row.companies).padStart(7)
      + String(row.duplicates).padStart(7)
      + String(row.rejected).padStart(9)
      + perNew.padStart(9));
  }
}

async function main(): Promise<void> {
  const since = parseSince(process.argv.slice(2));

  const totals = await query<{
    spend: string; calls: string; posts: string; accounts: string; verified: string;
    hvac: string; named: string; emails: string; direct: string;
  }>(
    `select
       (select coalesce(sum(actual_cost_usd), 0)::text from provider_usage
         where requested_at >= $1)                                              as spend,
       (select count(*)::text from provider_usage where requested_at >= $1)     as calls,
       (select count(*)::text from provider_usage
         where requested_at >= $1 and operation like '%task_post%')             as posts,
       (select count(*)::text from accounts where created_at >= $1)             as accounts,
       (select count(*)::text from accounts
         where created_at >= $1 and entity_status = 'verified'
           and not is_suppressed)                                               as verified,
       (select count(*)::text from accounts
         where created_at >= $1 and primary_vertical_profile_id = 'hvac'
           and entity_status = 'verified' and not is_suppressed)                as hvac,
       (select count(distinct account_id)::text from contacts
         where created_at >= $1 and full_name is not null
           and not coalesce(is_role_placeholder, false))                        as named,
       (select count(distinct account_id)::text from contact_endpoints
         where created_at >= $1 and endpoint_type = 'EMAIL' and is_active)      as emails,
       (select count(*)::text from contact_endpoints
         where created_at >= $1 and endpoint_role in
               ('DIRECT_PERSON_EMAIL','DIRECT_PERSON_PHONE'))                   as direct`,
    [since]);

  const t = totals.rows[0]!;
  const spend = Number(t.spend);
  const hvac = Number(t.hvac);
  const named = Number(t.named);
  const emails = Number(t.emails);

  console.log(`PROVIDER YIELD SINCE ${since}`);
  console.log(`  provider calls                   ${t.calls}  (${t.posts} paid searches)`);
  console.log(`  spend                            $${spend.toFixed(4)}`);
  console.log(`  Accounts created                 ${t.accounts}`);
  console.log(`  ...verified and workable         ${t.verified}`);
  console.log(`  ...verified HVAC                 ${hvac}`);
  console.log(`  Accounts with a named person     ${named}`);
  console.log(`  Accounts with an email route     ${emails}`);
  console.log(`  person-level endpoints           ${t.direct}`);

  // By market. A market whose searches return companies we already have is a market to
  // stop, and it says so here before the next batch is bought.
  const byMarket = await query<Row & { searches: string; costUsd: string;
                                       companies: string; duplicates: string; rejected: string }>(
    `select coalesce(m.name, 'unattributed') as label,
            count(distinct j.job_id)::text                                     as "searches",
            coalesce(sum(u.actual_cost_usd), 0)::text                          as "costUsd",
            count(distinct case when c.entity_status = 'VERIFIED' and c.account_id is not null
                                then c.account_id end)::text                   as companies,
            count(distinct case when c.entity_status = 'VERIFIED' and c.account_id is null
                                then c.identity end)::text                     as duplicates,
            count(distinct case when c.entity_status = 'REJECTED' then c.identity end)::text
                                                                               as rejected
       from jobs j
       left join saved_markets m on m.market_id = j.market_id
       left join provider_usage u on u.job_id = j.job_id
       left join discovery_candidates c on c.job_id = j.job_id
      where j.job_type = 'market_mine' and j.created_at >= $1
      group by 1 order by 2 desc limit 40`, [since]);

  table('BY MARKET', byMarket.rows.map((r) => ({
    label: r.label, searches: Number(r.searches), costUsd: Number(r.costUsd),
    companies: Number(r.companies), duplicates: Number(r.duplicates),
    rejected: Number(r.rejected) })));

  // By what a source turned out to be. This is the directory tax: money spent on rows
  // that were never companies.
  const byRole = await query<{ role: string; n: string; promoted: string }>(
    `select coalesce(source_role, '(not classified)') as role, count(*)::text as n,
            count(account_id)::text as promoted
       from discovery_candidates
      where created_at >= $1 group by 1 order by 2 desc`, [since]);
  console.log('\nWHAT THE RESULTS ACTUALLY WERE');
  for (const row of byRole.rows) {
    console.log(`  ${row.role.padEnd(26)} ${String(row.n).padStart(6)} rows, `
      + `${row.promoted} became Accounts`);
  }

  console.log('\nTHE TWO NUMBERS THAT MATTER');
  console.log(`  cost per net-new verified HVAC   ${hvac > 0 ? `$${(spend / hvac).toFixed(4)}` : '—'}`);
  console.log(`  cost per named decision maker    ${named > 0 ? `$${(spend / named).toFixed(4)}` : '—'}`);
  console.log(`  cost per attributable email      ${emails > 0 ? `$${(spend / emails).toFixed(4)}` : '—'}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());
