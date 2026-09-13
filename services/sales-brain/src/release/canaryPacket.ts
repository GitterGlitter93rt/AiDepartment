import { execFileSync } from 'node:child_process';
import { query } from '../db/pool.js';
import { buildIdentity } from './identity.js';
import { schemaState } from '../db/migrate.js';
import { dailyBudgetUsd, assumedRunCostUsd } from '../miner/spend.js';
import { planCanary, MAX_CANARY_SEARCHES, type CanaryPlan } from '../miner/canary.js';
import { availableDiscoveryAdapters } from '../workers/marketMiner.js';
import { MAX_TASK_COLLECTIONS } from '../miner/providerTasks.js';

/**
 * What a first paid search would need, what it would do, and what would prove it
 * worked -- written before anyone spends anything.
 *
 * Generated rather than hand-written, because a readiness document that drifts from
 * the system is worse than none: it is the thing somebody trusts at the moment they
 * are about to spend money. Every number here is read from this build, this schema
 * and this configuration at the moment it runs. The proposed canary is produced by
 * the real planner in dry mode, so the queries in the packet are the queries that
 * would go out.
 *
 * It executes nothing. No provider is contacted, no credential is required, and the
 * only writes are none.
 *
 * Environment variables appear by NAME only. A readiness packet is something you
 * paste into a message, and a secret in it is a secret published.
 */

export interface CanaryPacket {
  generatedAt: string;
  build: {
    branch: string;
    sha: string;
    migrationsShipped: number | null;
    migrationsApplied: number;
    pendingMigrations: string[];
    editedAfterApply: string[];
    unknownToBuild: string[];
  };
  runtime: {
    /** Worker builds heartbeating now, so API/worker skew is visible before a run. */
    workerBuilds: string[];
    workersOnline: number;
    queueWaiting: number;
    /** A provider task left open by an earlier run would be collected first. */
    openProviderTasks: number;
  };
  configuration: {
    /** Names only. Never values. */
    requiredEnvNames: { name: string; purpose: string; present: boolean }[];
    governanceReviewed: boolean;
    discoveryAdapters: string[];
    dailyBudgetUsd: number;
    assumedPerSearchUsd: number;
    maxCanarySearches: number;
    maxTaskCollections: number;
  };
  proposal: {
    vertical: string;
    location: string;
    count: number;
    maxCostCents: number;
    plan: CanaryPlan | null;
    planError: string | null;
  };
  expectations: {
    providerTaskTransitions: string[];
    databaseRows: string[];
    downstreamEvidence: string[];
    uiEvidence: string[];
  };
  gates: {
    success: string[];
    abort: string[];
    stop: string[];
  };
  procedure: {
    beforehand: string[];
    commands: string[];
    rollback: string[];
  };
}

/** The names a paid discovery run reads. Names, and what each is for. */
const ENV_NAMES: { name: string; purpose: string }[] = [
  { name: 'DATAFORSEO_LOGIN', purpose: 'Provider account. Half a credential, and an address.' },
  { name: 'DATAFORSEO_PASSWORD', purpose: 'Provider credential.' },
  { name: 'DATAFORSEO_ENABLED', purpose: 'Whether the adapter may run at all.' },
  { name: 'DATAFORSEO_GOVERNANCE_REVIEWED',
    purpose: 'Records that SB-B3 source governance was signed off. Gates discovery '
      + 'independently of the credential.' },
  { name: 'DISCOVERY_DAILY_BUDGET_USD',
    purpose: 'The per-day ceiling. A malformed value now stops the process rather '
      + 'than reading as no ceiling.' },
  { name: 'DISCOVERY_ASSUMED_RUN_COST_USD',
    purpose: 'The worst-case per-search assumption the ceiling arithmetic uses.' },
  { name: 'DATAFORSEO_RESULT_DEPTH', purpose: 'Results requested per search.' },
  { name: 'DATAFORSEO_MAX_QUERIES_PER_RUN', purpose: 'Provider-side ceiling per run.' },
];

function branchName(): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000 }).trim();
  } catch { return 'unknown'; }
}

export async function canaryPacket(options: {
  vertical?: string; location?: string; count?: number; maxCostCents?: number;
} = {}): Promise<CanaryPacket> {
  const identity = buildIdentity();
  const schema = await schemaState();

  const { rows: workerRows } = await query<{
    builds: string | null; online: number;
  }>(
    `select string_agg(distinct build_sha, ',') as builds,
            count(*) filter (where stopped_at is null
              and last_heartbeat_at > now() - interval '90 seconds')::int as online
       from worker_instances`);

  const { rows: queueRows } = await query<{ waiting: number }>(
    `select count(*)::int as waiting from jobs where status in ('QUEUED','RUNNING')`);

  const { rows: taskRows } = await query<{ open: number }>(
    `select count(*)::int as open from provider_tasks
      where status in ('SUBMITTED','PENDING','READY')`);

  const vertical = options.vertical ?? 'roofing';
  const location = options.location ?? '32095';
  const count = options.count ?? 5;
  const maxCostCents = options.maxCostCents ?? 30;

  let plan: CanaryPlan | null = null;
  let planError: string | null = null;
  try {
    // Dry by construction: `planCanary` contacts nothing and spends nothing.
    plan = await planCanary({ vertical, location, count, maxCostCents });
  } catch (error) {
    planError = error instanceof Error ? error.message : String(error);
  }

  let budget = 0;
  let assumed = 0;
  const budgetProblems: string[] = [];
  try { budget = dailyBudgetUsd(); }
  catch (error) {
    budgetProblems.push(error instanceof Error ? error.message : String(error));
  }
  try { assumed = assumedRunCostUsd(); }
  catch (error) {
    budgetProblems.push(error instanceof Error ? error.message : String(error));
  }

  return {
    generatedAt: new Date().toISOString(),
    build: {
      branch: branchName(),
      sha: identity.sha,
      migrationsShipped: identity.migrationsExpected,
      migrationsApplied: schema.applied,
      pendingMigrations: schema.pending,
      editedAfterApply: schema.changed,
      unknownToBuild: schema.unknown,
    },
    runtime: {
      workerBuilds: (workerRows[0]?.builds ?? '').split(',').filter(Boolean),
      workersOnline: workerRows[0]?.online ?? 0,
      queueWaiting: queueRows[0]?.waiting ?? 0,
      openProviderTasks: taskRows[0]?.open ?? 0,
    },
    configuration: {
      requiredEnvNames: ENV_NAMES.map((entry) => ({
        ...entry,
        // Presence only. The value is never read into this document.
        present: (process.env[entry.name] ?? '').trim().length > 0,
      })),
      governanceReviewed: (process.env['DATAFORSEO_GOVERNANCE_REVIEWED'] ?? '') === 'true',
      discoveryAdapters: availableDiscoveryAdapters().map((adapter) => adapter.name),
      dailyBudgetUsd: budget,
      assumedPerSearchUsd: assumed,
      maxCanarySearches: MAX_CANARY_SEARCHES,
      maxTaskCollections: MAX_TASK_COLLECTIONS,
    },
    proposal: { vertical, location, count, maxCostCents, plan, planError },
    expectations: {
      providerTaskTransitions: [
        'A row appears in provider_tasks per submitted search, with the provider\'s '
          + 'own task id and an idempotency key derived from the search fingerprint.',
        'SUBMITTED -> PENDING while the provider works, with each poll recorded as a '
          + 'collection attempt rather than a silent retry.',
        'PENDING -> READY -> COLLECTED once results are fetched, or -> ABANDONED '
          + `after ${MAX_TASK_COLLECTIONS} collection attempts.`,
        'A restart mid-flight must resume from the stored task, not re-buy it: the '
          + 'partial unique index on the idempotency key is what prevents a second '
          + 'purchase of the same question.',
      ],
      databaseRows: [
        'provider_usage: one row per provider call with its own cost, so the day\'s '
          + 'spend is reconcilable against an invoice.',
        'search_observations: one row per business per search, carrying the query, '
          + 'the position, the ad headline and the provider\'s observed_at.',
        'accounts: a canonical Account per business, matched to an existing one where '
          + 'identity says so rather than created twice.',
        'evidence_records: advertiser evidence for each observed paid placement, '
          + 'expiring 48 hours after the provider\'s observation.',
        'jobs: the market_mine job with its outcome, and one account_research job per '
          + 'newly created Account.',
        'opportunity_hypotheses: derived once research and scoring complete.',
      ],
      downstreamEvidence: [
        'Each new Account is queued for research, and research stamps '
          + 'last_researched_at rather than leaving it null.',
        'Scoring produces a canonical_scores row and a projection, so a tier exists '
          + 'with its working.',
        'An advertiser found in a paid result reads as advertising on the Account '
          + 'page, and the Module 4C rule the profile declares actually fires.',
        'Readiness moves off RESEARCH_NEEDED for at least one Account, or says '
          + 'precisely which requirement is unmet.',
        'A hypothesis with a first question appears, derived from the vertical\'s own '
          + 'leak_hypotheses.',
      ],
      uiEvidence: [
        'Mining: the run appears with providerRows, discoveredNew, matchedExisting '
          + 'and adEvidenceWritten, and "Discovered by a search provider" is no '
          + 'longer zero.',
        'Research Health: discovery provider reads ok rather than blocked; spend '
          + 'shows the day\'s cost against the ceiling; no dimension reads UNKNOWN '
          + 'that this run should have answered.',
        'Find Prospects: the market shows a real count with a saturation state, and '
          + 'the "no search provider" banner is gone.',
        'An Account page for one discovered company shows why it fits, who to ask '
          + 'for, and what to say first.',
      ],
    },
    gates: {
      success: [
        `Exactly ${count} independent provider searches were submitted -- not one, `
          + `and not ${count} terms concatenated into a single query.`,
        'Recorded spend is at or below the stated ceiling, and provider_usage '
          + 'reconciles with what the provider reports.',
        'Every submitted task reached COLLECTED or ABANDONED. None left open.',
        'At least one Account traced end to end: observation, evidence, score, '
          + 'hypothesis, and a rep-facing page that reads as sentences.',
        'No suppressed or DNC-screened company was unsuppressed by the run.',
      ],
      abort: [
        'Spend reaches the stated ceiling: the run refuses further searches rather '
          + 'than continuing and reporting afterwards.',
        'The provider returns an authentication or authorisation failure: stop, do '
          + 'not retry with variations.',
        'A task cannot be collected within its attempt budget: it is abandoned and '
          + 'reported, never silently retried.',
        'Ingestion rejects more rows than it accepts: stop and read why before '
          + 'spending again.',
      ],
      stop: [
        'OUTBOUND_DIAL_ENABLED or OUTBOUND_EMAIL_ENABLED is anything but false. A '
          + 'discovery canary must not coincide with an armed dialler.',
        'Any migration is pending, edited after apply, or unknown to this build.',
        'A worker is heartbeating a different build from the API.',
        'DATAFORSEO_GOVERNANCE_REVIEWED is not true: SB-B3 is the sign-off, and the '
          + 'credential alone is not it.',
        'DISCOVERY_DAILY_BUDGET_USD is unset or unreadable. No ceiling is not a '
          + 'small ceiling.',
        'An open provider task exists from an earlier run: collect it before buying '
          + 'anything new.',
      ],
    },
    procedure: {
      beforehand: [
        'npm run migrate            # nothing pending, nothing edited after apply',
        'npm run doctor             # no BUILD_SKEW, no open provider task',
        'npm run preflight          # dialling still disarmed',
        'npm run profiles:validate  # the configuration says nothing the runtime cannot act on',
        'npm run manifest           # record the SHA and the scoring policy this run belongs to',
      ],
      commands: [
        `npm run miner:canary -- --vertical ${vertical} --location ${location} `
          + `--count ${count} --max-cost-cents ${maxCostCents}`,
        '# read the plan: the queries, the fingerprints, the provider, the ceiling',
        `npm run miner:canary -- --vertical ${vertical} --location ${location} `
          + `--count ${count} --max-cost-cents ${maxCostCents} --live `
          + `--confirm-spend-cents ${maxCostCents}`,
        '# the ceiling is stated twice on purpose: a copied dry command cannot go live',
        'npm run doctor             # every task collected, nothing left open',
        'npm run support            # one file to keep with the run',
      ],
      rollback: [
        'Nothing needs undoing to stop: refusing the next search is the whole '
          + 'mechanism, and no outreach is possible with dialling and email disarmed.',
        'Discovered Accounts are ordinary inventory. To remove them, they are the '
          + 'rows whose discovery activity names the provider -- and the retention '
          + 'engine has no delete path, so removal is deliberate and manual.',
        'provider_usage and search_observations are the audit trail of what was '
          + 'bought. Keep them even if the Accounts are removed.',
        'A suppressed company re-found by the run stays suppressed. Mining enriches '
          + 'suppressed Accounts and never unsuppresses one.',
      ],
    },
  };
}

export function renderCanaryPacket(packet: CanaryPacket): string {
  const lines: string[] = ['', 'LIVE CANARY READINESS PACKET', `  ${packet.generatedAt}`, ''];
  const section = (title: string): void => { lines.push('', `── ${title}`, ''); };
  const bullets = (items: string[]): void => {
    for (const item of items) lines.push(`  - ${item}`);
  };

  section('what would run it');
  lines.push(`  branch            ${packet.build.branch}`);
  lines.push(`  commit            ${packet.build.sha}`);
  lines.push(`  migrations        ${packet.build.migrationsApplied} applied of `
    + `${packet.build.migrationsShipped ?? 'a number this build could not count'}`);
  if (packet.build.pendingMigrations.length > 0) {
    lines.push(`  PENDING           ${packet.build.pendingMigrations.join(', ')}`);
  }
  if (packet.build.editedAfterApply.length > 0) {
    lines.push(`  EDITED AFTER APPLY ${packet.build.editedAfterApply.join(', ')}`);
  }
  lines.push(`  workers online    ${packet.runtime.workersOnline}`
    + `${packet.runtime.workerBuilds.length > 0
      ? ` (builds ${packet.runtime.workerBuilds.join(', ')})` : ''}`);
  lines.push(`  queue waiting     ${packet.runtime.queueWaiting}`);
  lines.push(`  open provider tasks ${packet.runtime.openProviderTasks}`);

  section('configuration it needs (names only — never paste values into this file)');
  for (const entry of packet.configuration.requiredEnvNames) {
    lines.push(`  [${entry.present ? 'set' : '   '}] ${entry.name}`);
    lines.push(`        ${entry.purpose}`);
  }
  lines.push('');
  lines.push(`  governance reviewed   ${packet.configuration.governanceReviewed}`);
  lines.push(`  discovery adapters    ${
    packet.configuration.discoveryAdapters.join(', ') || 'none configured'}`);
  lines.push(`  daily ceiling         $${packet.configuration.dailyBudgetUsd.toFixed(2)}`);
  lines.push(`  assumed per search    $${packet.configuration.assumedPerSearchUsd.toFixed(3)}`);
  lines.push(`  canary search ceiling ${packet.configuration.maxCanarySearches}`);
  lines.push(`  collection attempts   ${packet.configuration.maxTaskCollections}`);

  section('the smallest run worth authorising');
  const proposal = packet.proposal;
  lines.push(`  ${proposal.count} independent searches, ${proposal.vertical} in `
    + `${proposal.location}, ceiling ${proposal.maxCostCents}c`);
  if (proposal.planError) {
    lines.push(`  the planner could not produce a plan: ${proposal.planError}`);
  } else if (proposal.plan) {
    lines.push(`  geography         ${proposal.plan.geography?.display ?? 'unresolved'}`);
    lines.push(`  strategy          ${proposal.plan.strategy}`);
    lines.push(`  terms available   ${proposal.plan.availableTerms}`);
    lines.push('');
    lines.push('  the queries that would go out:');
    for (const search of proposal.plan.searches) {
      lines.push(`     "${search.keyword}" in ${search.locationName}`);
    }
    if (proposal.plan.causesHeldBack.length > 0) {
      lines.push(`  held back         ${proposal.plan.causesHeldBack.join(', ')} `
        + '(nobody asked for that event)');
    }
    lines.push('');
    lines.push(`  estimated         $${proposal.plan.cost.estimatedTotalUsd.toFixed(3)}`);
    lines.push(`  hard maximum      $${proposal.plan.cost.maxAllowedUsd.toFixed(2)}`);
    lines.push(`  spent today       ${proposal.plan.cost.spentTodayUsd < 0
      ? 'could not be read' : `$${proposal.plan.cost.spentTodayUsd.toFixed(2)}`}`);
    if (proposal.plan.refusals.length > 0) {
      lines.push('');
      lines.push('  it would refuse today:');
      for (const refusal of proposal.plan.refusals) {
        lines.push(`     ${refusal.code}: ${refusal.message}`);
      }
    }
  }

  section('what the provider task should do');
  bullets(packet.expectations.providerTaskTransitions);
  section('what should appear in the database');
  bullets(packet.expectations.databaseRows);
  section('what should appear downstream');
  bullets(packet.expectations.downstreamEvidence);
  section('what should appear on a screen');
  bullets(packet.expectations.uiEvidence);

  section('before running anything');
  for (const command of packet.procedure.beforehand) lines.push(`  ${command}`);
  section('the commands themselves');
  for (const command of packet.procedure.commands) lines.push(`  ${command}`);

  section('success is all of these');
  bullets(packet.gates.success);
  section('abort the run if');
  bullets(packet.gates.abort);
  section('do not start at all if');
  bullets(packet.gates.stop);
  section('afterwards');
  bullets(packet.procedure.rollback);

  lines.push('');
  lines.push('  This packet executes nothing. It contacts no provider, needs no');
  lines.push('  credential, and writes nothing. Every number above was read from this');
  lines.push('  build, this schema and this configuration when it ran.');
  lines.push('');
  return lines.join('\n');
}
