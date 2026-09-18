import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { apolloConfig, createApolloAdapter } from '../providers/apollo/client.js';
import { selectDecisionMaker, DECISION_MAKER_TITLES } from '../providers/apollo/candidates.js';
import { isRoleMailbox, attributeEndpoint } from '../resolver/attribution.js';
import { judgeDomain } from '../domain/domainValidity.js';
import { judgePersonIdentity } from '../resolver/personIdentity.js';

/**
 * The controlled Apollo pilot.
 *
 *   npm run apollo:pilot -- --snapshot <dir> --limit 20 [--enrich]
 *
 * Reads the authorized private snapshot, picks a fixed mix of Accounts, and measures what
 * Apollo actually adds. Writes one artifact and touches no production row: the point is to
 * learn the yield before deciding whether the yield is worth having.
 *
 * The order is the waterfall's. Free people search first, always; paid enrichment only for
 * an Account that is missing something Apollo could supply, and only for a candidate whose
 * employer agrees and whose name is a person's. An Account whose chosen person has no
 * email on file costs nothing, because Apollo says so for free.
 *
 * `--enrich` is required before anything can charge. Without it the pilot runs the whole
 * free half and reports what it *would* have bought.
 */

interface SnapshotAccount {
  account_id: string; company_name: string; vertical: string; domain: string;
  city: string; state: string; main_phone: string; general_company_email: string;
  source_state: string; named_decision_maker: string; named_decision_maker_title: string;
  verification_state: string; canonical_name_warning: string; provider_business_name: string;
}

function readCsv<T>(path: string): T[] {
  const text = readFileSync(path, 'utf8');
  const rows: string[][] = [];
  let field = ''; let row: string[] = []; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header!.length)
    .map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])) as T);
}

/** A record that is a real business we could sell to, on the evidence in the snapshot. */
function isLegitimateTarget(a: SnapshotAccount): boolean {
  if (a.verification_state !== 'verified') return false;
  // Never a reserved or unusable domain, and never a record with no identity at all.
  if (a.domain && !judgeDomain(a.domain).usableAsWebsite) return false;
  if (!a.domain && !a.main_phone) return false;
  // The known non-companies from the audit, by shape rather than by name.
  if (/\b(directory|directories|listings?|reviews|guide|magazine|media|news|jobs)\b/i
    .test(a.company_name)) return false;
  if (/^\s*(the\s+)?(top|best)\b|\btop\s*\d+\b|\bnear me\b/i.test(a.company_name)) return false;
  if (/^tool\s*#/i.test(a.company_name)) return false;
  if (/myfloridalicense|uhaul|harveytool|homeyou|birdeye|buildzoom|yahoo/i
    .test(`${a.domain} ${a.company_name}`)) return false;
  return true;
}

/** Whether the named person in the snapshot is actually a person. */
function hasValidDecisionMaker(a: SnapshotAccount): boolean {
  if (!a.named_decision_maker.trim()) return false;
  return judgePersonIdentity({
    name: a.named_decision_maker, companyName: a.company_name,
    rawTitle: a.named_decision_maker_title }).mayHoldDecisionMakerAuthority;
}

interface PilotRow {
  account_id: string; company: string; vertical: string; domain: string;
  cohort: string;
  existing_decision_maker: string; existing_route: string;
  organization_matched: string; search_candidates: number;
  selected_person: string; selected_title: string; selection_reason: string;
  enriched: string; match_confidence: string; apollo_email: string;
  attribution_role: string; attribution_basis: string;
  apollo_person_id: string; apollo_organization_id: string; provider_request_id: string;
  new_information: string; credits_estimated: number; outcome: string; note: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string, fallback = ''): string => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };
  const snapshot = arg('--snapshot',
    '/home/roothecks/SalesBrain-Audit-Data/production-snapshots/2026-09-17');
  const limit = Number(arg('--limit', '20'));
  const mayCharge = argv.includes('--enrich');
  const out = arg('--out',
    '/home/roothecks/SalesBrain-Audit-Data/research-audits/claude-2026-09-17/APOLLO_PILOT.csv');

  const settings = apolloConfig();
  if (!settings.apiKey) { console.error('No APOLLO_API_KEY configured.'); process.exitCode = 2; return; }
  const adapter = createApolloAdapter({ config: { ...settings, enabled: true,
    peopleSearchEnabled: true, peopleEnrichmentEnabled: mayCharge,
    // Explicitly held down for the first pilot, whatever the environment says.
    phoneEnrichmentEnabled: false, waterfallEmailEnabled: false, waterfallPhoneEnabled: false } });

  const accounts = readCsv<SnapshotAccount>(`${snapshot}/ACTIVE_ACCOUNTS.csv`)
    .filter(isLegitimateTarget);

  /*
   * The three cohorts, in the mix Michael specified. Each answers a different question:
   * can Apollo route a person we already know, can it find a person at all, and can it
   * help where the company's own site is unreadable.
   */
  const unreadable = new Set(['REFUSED', 'DISALLOWED', 'UNREACHABLE', 'NO_WEBSITE', 'HTTP_ERROR']);
  const preferHvac = (a: SnapshotAccount, b: SnapshotAccount): number =>
    (b.vertical === 'HVAC' ? 1 : 0) - (a.vertical === 'HVAC' ? 1 : 0);

  const cohortA = accounts.filter((a) => hasValidDecisionMaker(a)
    && (!a.general_company_email || isRoleMailbox(a.general_company_email))
    && !unreadable.has(a.source_state)).sort(preferHvac).slice(0, 8);
  const cohortB = accounts.filter((a) => !hasValidDecisionMaker(a)
    && !unreadable.has(a.source_state) && a.domain).sort(preferHvac).slice(0, 8);
  const cohortC = accounts.filter((a) => unreadable.has(a.source_state)
    && (a.main_phone || a.provider_business_name)
    && !cohortA.includes(a) && !cohortB.includes(a)).sort(preferHvac).slice(0, 4);

  const selected = [
    ...cohortA.map((a) => ({ a, cohort: 'A_NAMED_NO_ROUTE' })),
    ...cohortB.map((a) => ({ a, cohort: 'B_NO_DECISION_MAKER' })),
    ...cohortC.map((a) => ({ a, cohort: 'C_UNREADABLE_CORROBORATED' })),
  ].slice(0, limit);

  console.log(`APOLLO PILOT — ${selected.length} Accounts `
    + `(A:${cohortA.length} B:${cohortB.length} C:${cohortC.length})`);
  console.log(`  paid enrichment: ${mayCharge ? 'ENABLED' : 'DISABLED (dry run)'}`);
  console.log(`  phone reveal: OFF   waterfall: OFF\n`);

  const rows: PilotRow[] = [];
  let creditsEstimated = 0;

  for (const { a, cohort } of selected) {
    const row: PilotRow = {
      account_id: a.account_id, company: a.company_name, vertical: a.vertical,
      domain: a.domain, cohort,
      existing_decision_maker: hasValidDecisionMaker(a) ? a.named_decision_maker : '',
      existing_route: a.general_company_email && !isRoleMailbox(a.general_company_email)
        ? a.general_company_email : '',
      organization_matched: '', search_candidates: 0, selected_person: '', selected_title: '',
      selection_reason: '', enriched: 'no', match_confidence: '', apollo_email: '',
      attribution_role: '', attribution_basis: '', apollo_person_id: '',
      apollo_organization_id: '', provider_request_id: '', new_information: 'no',
      credits_estimated: 0, outcome: '', note: '',
    };

    // Free, always first.
    const search = await adapter.searchPeople({
      organizationDomains: a.domain ? [a.domain] : undefined,
      organizationNames: a.domain ? undefined : [a.company_name],
      personTitles: DECISION_MAKER_TITLES, perPage: 25,
    });
    if (!search.ok) {
      row.outcome = 'PROVIDER_ERROR'; row.note = search.errorClassification ?? 'search failed';
      rows.push(row); console.log(`  ${a.company_name.slice(0, 40).padEnd(42)} ${row.outcome}`);
      continue;
    }
    const people = search.data?.people ?? [];
    row.search_candidates = people.length;
    // The free search does not return organization.id, so a match is recorded by the
    // basis that actually established it: the domain the search was scoped to.
    row.organization_matched = people.length > 0
      ? (a.domain ? 'domain-scoped' : 'name-only') : 'no';
    row.apollo_organization_id = people[0]?.apolloOrganizationId ?? '';

    const selection = selectDecisionMaker(people, {
      searchScopedByDomain: Boolean(a.domain),
      companyName: a.company_name, canonicalDomain: a.domain || null,
      city: a.city, state: a.state,
      firstPartyPersonNames: row.existing_decision_maker ? [row.existing_decision_maker] : [],
    });
    row.selection_reason = selection.reason.slice(0, 200);

    if (selection.ambiguous) { row.outcome = 'AMBIGUOUS'; rows.push(row);
      console.log(`  ${a.company_name.slice(0, 40).padEnd(42)} AMBIGUOUS`); continue; }
    if (!selection.chosen) { row.outcome = 'NO_MATCH'; rows.push(row);
      console.log(`  ${a.company_name.slice(0, 40).padEnd(42)} NO_MATCH (${people.length} seen)`);
      continue; }

    const chosen = selection.chosen.candidate;
    row.selected_person = chosen.fullName ?? '';
    row.selected_title = chosen.title ?? '';
    row.apollo_person_id = chosen.apolloPersonId;

    // Apollo says for free whether there is anything to buy.
    if (!chosen.hasEmail) {
      row.outcome = 'FOUND_PERSON_NO_EMAIL_ON_FILE';
      row.new_information = row.existing_decision_maker ? 'no' : 'yes';
      rows.push(row);
      console.log(`  ${a.company_name.slice(0, 40).padEnd(42)} person, no email on file (free)`);
      continue;
    }
    if (!mayCharge) {
      row.outcome = 'WOULD_ENRICH';
      rows.push(row);
      console.log(`  ${a.company_name.slice(0, 40).padEnd(42)} would enrich ${chosen.fullName}`);
      continue;
    }

    const enriched = await adapter.enrichPerson({
      apolloPersonId: chosen.apolloPersonId,
      domain: a.domain || undefined, organizationName: a.company_name,
      revealPhoneNumber: false, revealPersonalEmails: false,
    });
    row.enriched = 'yes';
    row.provider_request_id = enriched.providerRequestId ?? '';
    row.credits_estimated = enriched.cost.creditsEstimated;
    creditsEstimated += enriched.cost.creditsEstimated;

    if (!enriched.ok || !enriched.data) {
      row.outcome = 'PROVIDER_ERROR'; row.note = enriched.errorClassification ?? '';
      rows.push(row); console.log(`  ${a.company_name.slice(0, 40).padEnd(42)} enrich error`);
      continue;
    }
    const person = enriched.data;
    row.match_confidence = person.matchConfidence;
    row.apollo_email = person.email ?? '';

    if (person.email) {
      const attribution = attributeEndpoint({
        endpointKind: 'EMAIL', value: person.email,
        personName: person.fullName ?? chosen.fullName, observedBasis: 'PROVIDER_STATED' });
      row.attribution_role = attribution.role;
      row.attribution_basis = attribution.basis;
      // New only if it is not the address we already held.
      row.new_information = (row.existing_route
        && row.existing_route.toLowerCase() === person.email.toLowerCase()) ? 'no' : 'yes';
      row.outcome = attribution.role === 'DIRECT_PERSON_EMAIL' ? 'PERSON_EMAIL' : 'ROLE_EMAIL';
    } else {
      row.outcome = person.matchConfidence === 'none' ? 'NO_MATCH' : 'MATCHED_NO_EMAIL';
    }
    rows.push(row);
    console.log(`  ${a.company_name.slice(0, 40).padEnd(42)} ${row.outcome} `
      + `${row.apollo_email} (${person.matchConfidence})`);
  }

  mkdirSync(dirname(out), { recursive: true });
  const header = Object.keys(rows[0] ?? { account_id: '' });
  const csv = [header.join(','), ...rows.map((r) => header
    .map((h) => `"${String((r as never)[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  writeFileSync(out, `${csv}\n`);

  const count = (f: (r: PilotRow) => boolean): number => rows.filter(f).length;
  console.log('\nPILOT RESULT');
  console.log(`  accounts attempted                 ${rows.length}`);
  console.log(`  organization matched               ${count((r) => r.organization_matched !== 'no')}`);
  console.log(`  people-search candidates (total)   ${rows.reduce((s, r) => s + r.search_candidates, 0)}`);
  console.log(`  decision makers identified (free)  ${count((r) => Boolean(r.selected_person))}`);
  console.log(`  ...new to Sales Brain              ${count((r) => Boolean(r.selected_person) && !r.existing_decision_maker)}`);
  console.log(`  professional emails returned       ${count((r) => Boolean(r.apollo_email))}`);
  console.log(`  ...attributable to the person      ${count((r) => r.attribution_role === 'DIRECT_PERSON_EMAIL')}`);
  console.log(`  ...new information                 ${count((r) => r.new_information === 'yes' && Boolean(r.apollo_email))}`);
  console.log(`  no match                           ${count((r) => r.outcome === 'NO_MATCH')}`);
  console.log(`  ambiguous                          ${count((r) => r.outcome === 'AMBIGUOUS')}`);
  console.log(`  person found, no email on file     ${count((r) => r.outcome === 'FOUND_PERSON_NO_EMAIL_ON_FILE')}`);
  console.log(`  provider errors                    ${count((r) => r.outcome === 'PROVIDER_ERROR')}`);
  console.log(`  estimated credits consumed         ${creditsEstimated}`);
  console.log(`\n  artifact: ${out}`);
}

main().catch((error) => {
  console.error('pilot failed:', (error as Error).message);
  process.exitCode = 1;
});
