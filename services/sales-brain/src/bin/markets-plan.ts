import { closePool, query } from '../db/pool.js';
import { HVAC_MARKET_PLAN, planByState, planInWorkingOrder } from '../miner/plans/hvacGeography.js';

/**
 * Turns the HVAC geography plan into saved markets.
 *
 *   npm run markets:plan                      what it would create, and creates nothing
 *   npm run markets:plan -- --apply           create them, switched off
 *   npm run markets:plan -- --apply --enable 40   create them and switch the first 40 on
 *   npm run markets:plan -- --enable 40       switch on the next 40 already-created ones
 *   npm run markets:plan -- --disable-all     stop everything now
 *
 * Created switched off by default. A saved market is a standing instruction to spend
 * money, and four hundred of them arriving enabled at once is not a plan, it is a bill.
 * Enabling in batches is what lets the marginal-yield question be asked before the next
 * batch is bought.
 */

interface Options { apply: boolean; enable: number; disableAll: boolean; state: string | null }

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, enable: 0, disableAll: false, state: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') options.apply = true;
    else if (argv[i] === '--disable-all') options.disableAll = true;
    else if (argv[i] === '--enable') options.enable = Number(argv[i += 1]);
    else if (argv[i] === '--state') options.state = String(argv[i += 1]).toUpperCase();
  }
  return options;
}

const marketName = (city: string, state: string): string => `HVAC — ${city}, ${state}`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.disableAll) {
    const { rowCount } = await query(
      `update saved_markets set enabled = false, updated_at = now() where enabled`);
    console.log(`switched off ${rowCount ?? 0} market(s)`);
    return;
  }

  const targets = planInWorkingOrder()
    .filter((t) => !options.state || t.state === options.state);

  console.log('HVAC MARKET PLAN');
  console.log(`  targets in plan                  ${HVAC_MARKET_PLAN.length}`);
  console.log(`  targets selected                 ${targets.length}`);
  for (const [state, group] of [...planByState()].sort((a, b) => b[1].length - a[1].length)) {
    const principal = group.filter((t) => t.tier === 'PRINCIPAL').length;
    console.log(`    ${state}  ${String(group.length).padStart(3)}  `
      + `(${principal} principal, ${group.length - principal} suburb)`);
  }

  const existing = await query<{ name: string; market_id: string; enabled: boolean }>(
    `select name, market_id, enabled from saved_markets where vertical_profile_id = 'hvac'`);
  const byName = new Map(existing.rows.map((r) => [r.name, r]));
  const missing = targets.filter((t) => !byName.has(marketName(t.city, t.state)));

  console.log('');
  console.log(`  already saved                    ${existing.rows.length}`);
  console.log(`  enabled right now                ${existing.rows.filter((r) => r.enabled).length}`);
  console.log(`  would create                     ${missing.length}`);

  if (!options.apply && options.enable === 0) {
    console.log('\ndry run: nothing was created and nothing was switched on');
    return;
  }

  let created = 0;
  if (options.apply) {
    for (const target of missing) {
      await query(
        `insert into saved_markets
           (name, vertical_profile_id, geography_type, geography_definition, mining_mode,
            target_inventory_depth, status, enabled, refresh_interval_hours)
         values ($1, 'hvac', 'city', $2::jsonb, 'broad_local', 150, 'ACTIVE', false, 720)
         on conflict do nothing`,
        [marketName(target.city, target.state),
         JSON.stringify({ city: target.city, state: target.state })]);
      created += 1;
    }
    console.log(`  created                          ${created}  (all switched off)`);
  }

  if (options.enable > 0) {
    // Enabled in the plan's own order, so the highest-yield ground is worked first and
    // an interrupted sprint has still done the valuable part.
    const order = targets.map((t) => marketName(t.city, t.state));
    const { rows } = await query<{ name: string }>(
      `update saved_markets set enabled = true, blocker_reason = null, updated_at = now()
        where market_id in (
          select market_id from saved_markets
           where vertical_profile_id = 'hvac' and not enabled and name = any($1::text[])
           order by array_position($1::text[], name)
           limit $2)
        returning name`,
      [order, options.enable]);
    console.log(`  switched on                      ${rows.length}`);
    for (const row of rows.slice(0, 10)) console.log(`      ${row.name}`);
    if (rows.length > 10) console.log(`      ... and ${rows.length - 10} more`);
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());
