import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';

/**
 * Every section of a vertical profile is either read or reviewed.
 *
 * The campaign's recurring defect was configuration written down deliberately and
 * never read by the runtime, and asking the question section by section found the
 * worst of them: two readers looked up `opportunity_hypotheses`, a section no profile
 * has, so no vertical's prohibitions reached the rep's screen or the agent's prompt,
 * and `safety_boundaries` was read by nothing at all.
 *
 * Sixteen of twenty sections had no reader. Some of those are documents for people
 * and always were. The difference between "nobody reads this because it is prose for
 * a human" and "nobody reads this and somebody assumed otherwise" is a sentence
 * somebody has to write, which is what this file is: a decision per section, and a
 * failure when a new section appears without one.
 */

type Verdict = 'RUNTIME' | 'NOT_RUNTIME' | 'UNRESOLVED';

const SECTIONS: Record<string, { verdict: Verdict; reason: string }> = {
  // --- read by the runtime, and asserted to still be ----------------------------
  public_signal_rules: { verdict: 'RUNTIME',
    reason: 'Signal ids to evidence claim keys, for scoring and for hypothesis triggers.' },
  search_taxonomy: { verdict: 'RUNTIME',
    reason: 'Query planning, service aliases and negative terms.' },
  business_model: { verdict: 'RUNTIME',
    reason: 'Four Module 4C rules are read from the business model rather than signals.' },
  leak_hypotheses: { verdict: 'RUNTIME',
    reason: 'The hypotheses themselves, their questions, and their must_not_claim lists.' },
  safety_boundaries: { verdict: 'RUNTIME',
    reason: 'Prohibited agent claims and the escalation sentence, in the profile’s words.' },
  hook_priorities: { verdict: 'RUNTIME',
    reason: 'The order a rep sees hypotheses in, including boost and avoid signals.' },
  no_sale_conditions: { verdict: 'RUNTIME',
    reason: 'What counts as no sale in this trade, carried on the call pack.' },
  industry_aliases: { verdict: 'RUNTIME',
    reason: 'The vertical’s own names for itself, used to classify an industry label.' },
  classification_rules: { verdict: 'RUNTIME',
    reason: 'Negative business categories: a supply house is not a contractor.' },

  // --- prose for people, and always was -----------------------------------------
  industry_name: { verdict: 'RUNTIME',
    reason: 'The display name every page and filter shows, read when a profile syncs.' },
  profile_id: { verdict: 'RUNTIME',
    reason: 'The registry id, and the short id derived from it that everything keys on.' },
  inherent_causes: { verdict: 'RUNTIME',
    reason: 'A trade whose work is always cause-driven -- hail for PDR -- so its cause '
      + 'terms are not held back the way an optional event is.' },
  version: { verdict: 'NOT_RUNTIME',
    reason: 'Every profile still reads 1.0.0, which is why the release manifest '
      + 'fingerprints content instead. Recorded, not trusted.' },
  status: { verdict: 'NOT_RUNTIME', reason: 'Editorial state of the document.' },
  priority: { verdict: 'NOT_RUNTIME',
    reason: 'Which verticals to build first: a planning number for people.' },
  source_manual_commit: { verdict: 'NOT_RUNTIME', reason: 'Provenance of the document.' },
  source_manual_paths: { verdict: 'NOT_RUNTIME', reason: 'Provenance of the document.' },
  customer_journey: { verdict: 'NOT_RUNTIME',
    reason: 'Narrative context for whoever writes copy or trains a rep.' },
  research_requirements: { verdict: 'NOT_RUNTIME',
    reason: 'A floor, and the implementation is stricter than it. The profile asks for '
      + 'identity, geography, an attempted website read and an attempted ad check; '
      + 'repReady requires those plus suppression, DNC screening, a contact route and '
      + 'a score. Verified rather than assumed, and the ad-freshness rule is honoured '
      + 'by the present-tense prohibition.' },
  roi_tools: { verdict: 'NOT_RUNTIME',
    reason: 'ROI tooling is not built. Nothing claims a number from these today, which '
      + 'is the correct behaviour while they are unimplemented.' },
  system_families: { verdict: 'NOT_RUNTIME',
    reason: 'Which software families a trade tends to run: context for a human reading '
      + 'the profile. The product records what a prospect actually says instead.' },
  discovery_question_banks: { verdict: 'NOT_RUNTIME',
    reason: 'Questions for a human rep to draw on. The agent asks the hypothesis’s own '
      + 'questions_to_verify, which are the ones tied to observed evidence.' },
  country_scope: { verdict: 'NOT_RUNTIME',
    reason: 'Every profile is US-only and the product has no other scope to enforce.' },

  scoring_overrides: { verdict: 'NOT_RUNTIME',
    reason: 'Every profile sets `enabled: false` with the rule "use canonical Module 4C '
      + 'only... do not add hidden points". Nothing reading it is the declared '
      + 'behaviour, and the test below fails if a profile ever enables one, because '
      + 'nothing would honour it.' },
  derived_signals: { verdict: 'NOT_RUNTIME',
    reason: 'Website terms and CRM examples a human can use when writing a recogniser. '
      + 'The recognisers live in code with their own phrase lists and TTLs, and the '
      + 'signal-coverage guard is what keeps those honest.' },
  practice_area_taxonomy: { verdict: 'NOT_RUNTIME',
    reason: 'Which practice areas the law-firm profile covers first: a scoping list for '
      + 'people. Query planning reads search_taxonomy.' },

  // --- a decision is owed -------------------------------------------------------
  decision_maker_roles: { verdict: 'UNRESOLVED',
    reason: 'The profiles declare 24 role categories with vertical-specific titles '
      + '(managing partner, managing broker, canvassing manager, estimator). '
      + '`contacts.role_category` accepts 15 atomic values. Several profile categories '
      + 'are composites (owner_founder, owner_general_manager) with no atomic '
      + 'equivalent, so mapping them means choosing what somebody meant. Consequence '
      + 'today: those titles classify as unknown. Needs a vocabulary decision.' },
  objection_guidance: { verdict: 'UNRESOLVED',
    reason: 'Per-vertical objections with match phrases and response guidance. The '
      + 'prompt carries a hard-coded generic set instead. Wiring these is '
      + 'straightforward; whether the vertical’s guidance replaces or supplements the '
      + 'generic responses is a product decision about what an agent says.' },
  offer_mapping: { verdict: 'UNRESOLVED',
    reason: 'Which offer family a hypothesis points at. The hypotheses already carry '
      + 'offer_families, and `offer_hypotheses` is written only by a release drill, so '
      + 'there are two declarations and no producer. Needs a decision on which is '
      + 'authoritative before either is wired.' },
  call_pack_defaults: { verdict: 'UNRESOLVED',
    reason: '`preferred_primary_hook_order` is a second ordering declaration alongside '
      + '`hook_priorities`, which the generator uses. Resolving the conflict silently '
      + 'would change which reason to call a rep sees first. `default_first_question` '
      + 'is a safe fallback and waits on the same decision.' },
};

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

let sourceText: string | null = null;
function allSource(): string {
  if (sourceText === null) {
    sourceText = sourceFiles('src')
      // The sync script names every section by definition; it copies the document
      // wholesale, so its mentions prove nothing about the runtime reading one.
      .filter((path) => !path.includes('bin/sync-verticals'))
      .map((path) => readFileSync(path, 'utf8')).join('\n');
  }
  return sourceText;
}

async function declaredSections(): Promise<Set<string>> {
  const { rows } = await query<{ definition: any }>(
    'select definition from vertical_profiles where is_active');
  const sections = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.definition?.profile ?? row.definition ?? {})) {
      sections.add(key);
    }
  }
  return sections;
}

test('every section a profile declares has a verdict', async () => {
  const sections = await declaredSections();
  assert.ok(sections.size >= 20, `only ${sections.size} sections found`);

  const undecided = [...sections].filter((section) => !(section in SECTIONS));
  assert.deepEqual(undecided, [],
    'these profile sections have no verdict. A new section is a decision: read it, '
    + 'or write down why the runtime does not: ' + undecided.join(', '));
});

test('a verdict does not outlive its section', async () => {
  const sections = await declaredSections();
  const orphans = Object.keys(SECTIONS).filter((section) => !sections.has(section));
  assert.deepEqual(orphans, [],
    `these sections no longer exist and their verdicts should go: ${orphans.join(', ')}`);
});

test('every section called RUNTIME is named somewhere in the runtime', async () => {
  // Mechanical rather than trusting the label. This is how the original defect was
  // found: `safety_boundaries` appeared in thirteen profiles and in no source file.
  const source = allSource();
  for (const [section, entry] of Object.entries(SECTIONS)) {
    if (entry.verdict !== 'RUNTIME') continue;
    assert.ok(source.includes(section),
      `${section} is called RUNTIME and no source file mentions it. Either something `
      + 'stopped reading it, or the verdict was wishful.');
  }
});

test('a section called NOT_RUNTIME is not quietly being read', async () => {
  // The other direction. If code starts reading a section, the reason recorded here
  // is now wrong and somebody should say what it is instead.
  const source = allSource();
  const contradicted = Object.entries(SECTIONS)
    .filter(([section, entry]) => entry.verdict === 'NOT_RUNTIME'
      // `version`, `status` and `priority` are ordinary words that appear everywhere
      // in source; only the distinctive section names can be checked this way.
      && section.includes('_')
      && source.includes(section))
    .map(([section]) => section);
  assert.deepEqual(contradicted, [],
    `these are recorded as not read by the runtime and the runtime mentions them: ${
      contradicted.join(', ')}`);
});

test('an unresolved section states the question, not just the gap', () => {
  for (const [section, entry] of Object.entries(SECTIONS)) {
    if (entry.verdict !== 'UNRESOLVED') continue;
    assert.ok(entry.reason.length > 120,
      `${section} is unresolved with a reason too short to act on`);
    assert.match(entry.reason, /decision|authoritative|needs/i,
      `${section} does not say what decision is owed`);
  }
});

test('the gaps are few enough to be a list somebody reads', () => {
  const unresolved = Object.values(SECTIONS).filter((e) => e.verdict === 'UNRESOLVED');
  assert.ok(unresolved.length <= 6,
    `${unresolved.length} unresolved sections is a backlog, not a list. Resolve some `
    + 'before adding more.');
});

test('no profile enables a scoring override, because nothing implements one', async () => {
  // The section says overrides are off and canonical Module 4C is the only scoring.
  // Nothing reads it, which is correct -- until somebody sets it to true and expects
  // something to happen.
  const { rows } = await query<{ vertical_profile_id: string; definition: any }>(
    'select vertical_profile_id, definition from vertical_profiles where is_active');
  for (const row of rows) {
    const overrides = row.definition?.profile?.scoring_overrides;
    if (!overrides) continue;
    assert.notEqual(overrides.enabled, true,
      `${row.vertical_profile_id} enables scoring_overrides and no code reads them, so `
      + 'the points it expects would silently not be awarded');
  }
});

test('a trigger names a signal its own profile declares', async () => {
  // "Fifty-seven triggers cannot fire" was two problems wearing one number, and
  // separating them changes who can fix it.
  //
  // Only two distinct signals genuinely need data we do not buy: `active_meta_ad`,
  // which no SERP search can observe, and `storm_hail_market_signal`, whose source
  // is the open question. The other twenty-seven are triggers naming a signal their
  // own profile never declares in `public_signal_rules` -- a dangling reference in
  // the document, fixable by editing it, needing no new capability. Two of those are
  // plain misspellings of signals the product already writes:
  // `multi_location_signal` for `multiple_locations`, `online_scheduling` for
  // `online_quote_booking`.
  //
  // Pinned separately so the piles can only shrink, and so a new dangling reference
  // is not mistaken for a missing data source.
  const { recognisedClaimKeys } = await import('../src/resolver/signals.js');
  const { promotedAdClaimKeys } = await import('../src/workers/marketMiner.js');
  const writable = new Set([
    ...recognisedClaimKeys(), ...promotedAdClaimKeys(),
    'decision_maker_identity', 'contact_no_longer_current', 'imported_contact_title',
    'excluded_from_targeting',
  ]);

  const { rows } = await query<{ definition: any }>(
    'select definition from vertical_profiles where is_active');
  const dangling = new Set<string>();
  const needsSource = new Set<string>();
  let reachable = 0;

  for (const row of rows) {
    const profile = row.definition?.profile ?? {};
    const claimFor = new Map<string, string>();
    for (const rule of profile.public_signal_rules ?? []) {
      if (rule?.signal_id && rule?.evidence_claim_key) {
        claimFor.set(rule.signal_id, rule.evidence_claim_key);
      }
    }
    for (const hypothesis of profile.leak_hypotheses ?? []) {
      for (const trigger of hypothesis?.trigger_signals ?? []) {
        const id = String(trigger);
        const claimKey = claimFor.get(id);
        if (claimKey) {
          if (writable.has(claimKey)) reachable += 1;
          else needsSource.add(claimKey);
        } else if (writable.has(id)) reachable += 1;
        else dangling.add(id);
      }
    }
  }

  assert.ok(reachable >= 93,
    `only ${reachable} triggers can fire, down from 93: a signal source was lost`);
  assert.ok(needsSource.size <= 2,
    `${needsSource.size} declared signals have no writer, up from 2: ${
      [...needsSource].join(', ')}`);
  assert.ok(dangling.size <= 27,
    `${dangling.size} triggers name a signal their profile never declares, up from `
    + `27. A new one is a dangling reference in the document, not a missing data `
    + `source: ${[...dangling].sort().join(', ')}`);
});
