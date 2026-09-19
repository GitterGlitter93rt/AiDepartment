import { closePool } from '../db/pool.js';
import { applyFitRefresh, previewFitRefresh, SCORE_VERSION } from '../scoring/maintenance.js';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const json = argv.includes('--json');
const allActive = argv.includes('--all-active');
const accountAt = argv.indexOf('--account-id');
const verticalAt = argv.indexOf('--vertical');
const accountId = accountAt >= 0 ? argv[accountAt + 1] ?? null : null;
const vertical = verticalAt >= 0 ? argv[verticalAt + 1] ?? null : null;

try {
  const rows = await previewFitRefresh({ allActive, accountId, vertical });
  const summary = {
    scoreVersion: SCORE_VERSION,
    activeAccounts: rows.length,
    unchanged: rows.filter(r => !r.changed).length,
    changed: rows.filter(r => r.changed).length,
    upgraded: rows.filter(r => r.upgraded).length,
    downgraded: rows.filter(r => r.downgraded).length,
    oldDistribution: rows.reduce<Record<string, number>>((m, r) => {
      const key = r.currentLetter ?? 'UNSCORED'; m[key] = (m[key] ?? 0) + 1; return m;
    }, {}),
    newDistribution: rows.reduce<Record<string, number>>((m, r) => {
      m[r.recalculatedLetter] = (m[r.recalculatedLetter] ?? 0) + 1; return m;
    }, {}),
    numericDistribution: rows.reduce<Record<string, number>>((m, r) => {
      const key = String(r.recalculatedNumeric); m[key] = (m[key] ?? 0) + 1; return m;
    }, {}),
  };
  if (apply) {
    const n = await applyFitRefresh(rows);
    if (n !== rows.length) throw new Error(`applied ${n} of ${rows.length} score rows`);
  }
  if (json) console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', summary, rows }, null, 2));
  else {
    console.log(`FIT REFRESH ${apply ? 'APPLY' : 'DRY RUN'} — score version ${SCORE_VERSION}`);
    console.log(`active ${summary.activeAccounts}; unchanged ${summary.unchanged}; changed ${summary.changed}; upgraded ${summary.upgraded}; downgraded ${summary.downgraded}`);
    console.log(`old ${JSON.stringify(summary.oldDistribution)}`);
    console.log(`new ${JSON.stringify(summary.newDistribution)}`);
    console.log(`numeric ${JSON.stringify(summary.numericDistribution)}`);
    if (apply) console.log(`applied ${rows.length} score projections`);
  }
} finally {
  await closePool();
}
