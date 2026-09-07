import { query } from '../db/pool.js';
import { buildIdentity } from './identity.js';
import { schemaState } from '../db/migrate.js';
import { profileContentHash } from '../domain/verticals.js';
import { SCORE_VERSION, scoringRulesFingerprint } from '../scoring/model.js';
import { AUTOMATED_DISCOVERY_PREFIXES } from '../domain/discoverySources.js';

/**
 * What this build is, as distinct from what state it is in.
 *
 * The doctor answers "what is happening now". This answers "what is running", which
 * is the other half of the only question that matters after something goes wrong:
 * what changed between the run that worked and the run that did not.
 *
 * The part nobody was tracking is the vertical profiles. Each one decides which terms
 * are searched, which signals score and which results are excluded, and
 * `profile_version` is a hand-maintained string that still says 1.0.0 on every
 * profile in the repository -- including the ones edited in this campaign to add
 * causes and mark inherent events. So a content hash: it changes whenever the
 * definition does, which is the fact a later reader needs.
 *
 * Carries no secrets. Whether a credential is present is a fact about the build;
 * its value is not.
 */

export interface ReleaseManifest {
  generatedAt: string;
  build: { sha: string; migrationsShipped: number; migrationsApplied: number };
  /** Migrations this build has that the database has not run, and the reverse. */
  schemaDrift: { pending: string[]; unknownToBuild: string[]; changedAfterApply: string[] };
  scoring: { policyVersion: string; rulesFingerprint: string };
  verticals: { id: string; declaredVersion: string; contentHash: string;
    searchTerms: number; signalRules: number; negativeTerms: number }[];
  discoverySources: string[];
  /** Present or absent, never the value. */
  credentials: { name: string; present: boolean }[];
  safety: {
    outboundDialEnabled: boolean;
    outboundEmailEnabled: boolean;
    contactEnrichmentMode: string;
    dailyDiscoveryBudgetUsd: number;
    retentionPolicySupplied: boolean;
  };
}

const CREDENTIAL_VARS = [
  'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'ANTHROPIC_API_KEY', 'TWILIO_AUTH_TOKEN',
  'SMARTLEAD_API_KEY', 'CALCOM_API_KEY', 'DNC_SUBSCRIPTION_CREDENTIAL',
  'APOLLO_API_KEY', 'SESSION_SECRET',
];

export async function releaseManifest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReleaseManifest> {
  const identity = buildIdentity();
  const schema = await schemaState();

  const { rows: profiles } = await query<{
    vertical_profile_id: string; profile_version: string; definition: any;
  }>(
    `select vertical_profile_id, profile_version, definition from vertical_profiles
      where is_active order by vertical_profile_id`);

  const verticals = profiles.map((row) => {
    const profile = row.definition?.profile ?? {};
    const taxonomy = profile.search_taxonomy ?? {};
    const terms = [
      ...(Array.isArray(taxonomy.high_intent_queries) ? taxonomy.high_intent_queries : []),
      ...(Array.isArray(taxonomy.core_queries) ? taxonomy.core_queries : []),
    ].length;
    return {
      id: row.vertical_profile_id,
      declaredVersion: row.profile_version,
      contentHash: profileContentHash(row.definition),
      searchTerms: terms,
      signalRules: Array.isArray(profile.public_signal_rules)
        ? profile.public_signal_rules.length : 0,
      negativeTerms: Array.isArray(taxonomy.negative_terms)
        ? taxonomy.negative_terms.length : 0,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    build: {
      sha: identity.sha,
      migrationsShipped: identity.migrationsExpected,
      migrationsApplied: schema.applied,
    },
    schemaDrift: {
      pending: schema.pending,
      unknownToBuild: schema.unknown,
      changedAfterApply: schema.changed,
    },
    scoring: {
      policyVersion: SCORE_VERSION,
      rulesFingerprint: scoringRulesFingerprint(),
    },
    verticals,
    discoverySources: [...AUTOMATED_DISCOVERY_PREFIXES],
    credentials: CREDENTIAL_VARS.map((name) => ({
      name, present: Boolean((env[name] ?? '').trim()),
    })),
    safety: {
      outboundDialEnabled: env['OUTBOUND_DIAL_ENABLED'] === 'true',
      outboundEmailEnabled: env['OUTBOUND_EMAIL_ENABLED'] === 'true',
      contactEnrichmentMode: env['CONTACT_ENRICHMENT_MODE'] ?? 'PUBLIC_ONLY',
      dailyDiscoveryBudgetUsd: Number(env['DISCOVERY_DAILY_BUDGET_USD'] ?? '0'),
      retentionPolicySupplied: Boolean((env['RETENTION_POLICY_PATH'] ?? '').trim()),
    },
  };
}

/**
 * What changed between two builds.
 *
 * The whole point of keeping a manifest: after a run goes wrong, the question is
 * always "what is different", and a person comparing two JSON files by eye misses
 * the one line that matters.
 */
export function compareManifests(before: ReleaseManifest, after: ReleaseManifest): string[] {
  const changes: string[] = [];

  if (before.build.sha !== after.build.sha) {
    changes.push(`build ${before.build.sha} -> ${after.build.sha}`);
  }
  if (before.build.migrationsApplied !== after.build.migrationsApplied) {
    changes.push(`migrations applied ${before.build.migrationsApplied} -> `
      + `${after.build.migrationsApplied}`);
  }
  if (before.scoring.policyVersion !== after.scoring.policyVersion) {
    changes.push(`scoring policy ${before.scoring.policyVersion} -> `
      + `${after.scoring.policyVersion}: scores from either side are not comparable`);
  }
  if (before.scoring.rulesFingerprint !== after.scoring.rulesFingerprint) {
    changes.push('scoring rules changed without the policy version changing, which '
      + 'means two scores can differ for a reason nothing records');
  }

  const beforeVerticals = new Map(before.verticals.map((entry) => [entry.id, entry]));
  for (const entry of after.verticals) {
    const previous = beforeVerticals.get(entry.id);
    if (!previous) { changes.push(`vertical ${entry.id} added`); continue; }
    if (previous.contentHash !== entry.contentHash) {
      // The change that used to be invisible.
      const parts: string[] = [];
      if (previous.searchTerms !== entry.searchTerms) {
        parts.push(`search terms ${previous.searchTerms} -> ${entry.searchTerms}`);
      }
      if (previous.signalRules !== entry.signalRules) {
        parts.push(`signal rules ${previous.signalRules} -> ${entry.signalRules}`);
      }
      if (previous.negativeTerms !== entry.negativeTerms) {
        parts.push(`exclusions ${previous.negativeTerms} -> ${entry.negativeTerms}`);
      }
      changes.push(`vertical ${entry.id} edited (${previous.contentHash} -> `
        + `${entry.contentHash})${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`
        + `${previous.declaredVersion === entry.declaredVersion
          ? ` — still declared ${entry.declaredVersion}` : ''}`);
    }
  }
  for (const entry of before.verticals) {
    if (!after.verticals.some((later) => later.id === entry.id)) {
      changes.push(`vertical ${entry.id} removed`);
    }
  }

  const beforeCreds = new Map(before.credentials.map((entry) => [entry.name, entry.present]));
  for (const entry of after.credentials) {
    const was = beforeCreds.get(entry.name);
    if (was !== undefined && was !== entry.present) {
      changes.push(`${entry.name} ${entry.present ? 'configured' : 'removed'}`);
    }
  }

  for (const [key, label] of [
    ['outboundDialEnabled', 'outbound dialling'],
    ['outboundEmailEnabled', 'outbound email'],
    ['contactEnrichmentMode', 'contact enrichment mode'],
    ['dailyDiscoveryBudgetUsd', 'daily discovery budget'],
    ['retentionPolicySupplied', 'retention policy'],
  ] as const) {
    if (before.safety[key] !== after.safety[key]) {
      changes.push(`${label} ${String(before.safety[key])} -> ${String(after.safety[key])}`);
    }
  }

  return changes;
}

export function renderManifest(manifest: ReleaseManifest): string {
  const lines = ['', 'RELEASE MANIFEST', `  ${manifest.generatedAt}`, ''];
  lines.push(`  build            ${manifest.build.sha}`);
  lines.push(`  migrations       ${manifest.build.migrationsApplied} applied of `
    + `${manifest.build.migrationsShipped} shipped`);
  if (manifest.schemaDrift.pending.length > 0) {
    lines.push(`  PENDING          ${manifest.schemaDrift.pending.join(', ')}`);
  }
  if (manifest.schemaDrift.changedAfterApply.length > 0) {
    lines.push(`  EDITED AFTER APPLY ${manifest.schemaDrift.changedAfterApply.join(', ')}`);
  }
  lines.push(`  scoring policy   ${manifest.scoring.policyVersion}`);
  lines.push('');

  lines.push('  verticals (content hash, because every declared version says 1.0.0)');
  for (const entry of manifest.verticals) {
    lines.push(`     ${entry.id.padEnd(32)} ${entry.contentHash}  `
      + `${entry.searchTerms} terms, ${entry.signalRules} signals, `
      + `${entry.negativeTerms} exclusions`);
  }
  lines.push('');

  lines.push('  credentials (present or absent, never the value)');
  for (const entry of manifest.credentials) {
    lines.push(`     ${entry.present ? 'set    ' : 'absent '} ${entry.name}`);
  }
  lines.push('');

  lines.push('  safety');
  lines.push(`     outbound dialling      ${manifest.safety.outboundDialEnabled}`);
  lines.push(`     outbound email         ${manifest.safety.outboundEmailEnabled}`);
  lines.push(`     contact enrichment     ${manifest.safety.contactEnrichmentMode}`);
  lines.push(`     daily discovery budget $${manifest.safety.dailyDiscoveryBudgetUsd.toFixed(2)}`);
  lines.push(`     retention policy       ${manifest.safety.retentionPolicySupplied
    ? 'supplied' : 'none — nothing prunes anything'}`);
  lines.push('');
  return lines.join('\n');
}
