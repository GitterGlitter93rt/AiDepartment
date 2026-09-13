import { renderScoreLineage } from '../scoring/explain.js';
import { CASE_INTENT, type WalkResult } from './walk.js';

/**
 * The Block A acceptance artifact, for operator validation rather than assertions.
 *
 * Issue #3 asks for this explicitly and says not to bury it in tests, for a reason
 * the project has already lived through: validators went green while the account page
 * showed an empty "why reach out" for every real prospect. An assertion that a field
 * is non-empty does not tell you whether the sentence in it is one a salesperson
 * could say out loud.
 */

function pad(label: string, value: string | number | null | undefined): string {
  return `  ${String(label).padEnd(26)} ${value ?? '—'}`;
}

function firstLine(value: string | null | undefined, max = 150): string {
  if (!value) return '—';
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function renderWalk(walk: WalkResult): string {
  const out: string[] = [];
  const pack = walk.pack;
  const readiness = walk.readiness;

  out.push(`── ${walk.vertical} · ${walk.caseId}`);
  out.push(`   intent: ${CASE_INTENT[walk.caseId]}`);
  out.push(pad('company', walk.companyName));
  out.push(pad('discovery source', walk.discoverySource));
  out.push(pad('research state', walk.researchState));
  out.push(pad('advertiser state', walk.advertiser.channels
    .map((channel) => `${channel.channel}=${channel.state}`).join('  ')
    + (walk.advertiser.neverChecked ? '  (nothing has ever looked)' : '')));
  out.push(pad('facts known / unchecked', `${walk.picture.facts.length} known, `
    + `${walk.picture.notChecked} never checked, ${walk.picture.conflicts} conflicting`));

  if (walk.lineage) {
    out.push(pad('score / tier', `${walk.lineage.totalPoints} → tier ${walk.lineage.tier}`
      + `  (policy ${walk.lineage.policyVersion}${walk.lineage.policyCurrent ? '' : ', SUPERSEDED'})`));
    const earned = walk.lineage.components.filter((c) => c.pointsAwarded > 0);
    for (const component of earned) {
      out.push(`      +${component.pointsAwarded}  ${component.ruleId}`);
    }
    const sum = earned.reduce((total, c) => total + c.pointsAwarded, 0);
    out.push(pad('explanation sums to', `${sum} (stored ${walk.lineage.totalPoints})`
      + `${sum === walk.lineage.totalPoints ? ' ✓' : ' ✗ MISMATCH'}`));
  } else {
    out.push(pad('score / tier', 'no canonical score'));
  }

  out.push(pad('readiness', readiness
    ? `${readiness.state}${readiness.requirements.filter((r) => !r.met).length > 0
      ? ` — unmet: ${readiness.requirements.filter((r) => !r.met).map((r) => r.key).join(', ')}`
      : ''}`
    : 'no readiness record'));

  out.push(pad('primary hypothesis', walk.hypotheses[0]
    ? `${walk.hypotheses[0].hypothesisId} (${walk.hypotheses[0].storedCategory})`
    : 'none'));
  out.push(pad('primary hook order', pack?.primaryHookOrder?.slice(0, 3).join(' > ') ?? '—'));
  out.push(pad('hook order source', pack?.primaryHookSource ?? '—'));
  out.push(pad('decision maker', pack
    ? `${pack.contactName ?? 'no named person'} / ${pack.contactTitle ?? 'no title'}`
      + `${pack.contactIsRoleOnly ? ' (role only)' : ''}  confidence=${pack.contactConfidence}`
    : '—'));
  out.push(pad('objections', walk.objections.length > 0
    ? walk.objections.map((o) => `${o.intent}[${o.origin}]`).join(', ') : 'none'));
  out.push(pad('offers', walk.offers.length > 0
    ? walk.offers.sort((a, b) => a.priority - b.priority).map((o) => o.offerId).join(', ')
    : 'none'));
  out.push(pad('must not claim', pack?.prohibitedClaims?.length
    ? `${pack.prohibitedClaims.length} prohibitions` : 'none'));

  out.push('   what the rep actually reads:');
  out.push(`      first question : ${firstLine(pack?.firstQuestion)}`);
  out.push(`      confirmed facts: ${pack?.confirmedFacts?.length ?? 0}`);
  for (const fact of (pack?.confirmedFacts ?? []).slice(0, 3)) {
    out.push(`        · ${firstLine(fact.claim, 110)}`);
  }
  out.push(`      important unknowns: ${(pack?.importantUnknowns ?? []).length}`);
  for (const unknown of (pack?.importantUnknowns ?? []).slice(0, 3)) {
    out.push(`        · ${firstLine(unknown, 110)}`);
  }

  out.push(pad('rep-ready?', readiness
    ? (readiness.state === 'REP_READY' ? 'YES' : `NO — ${readiness.state}`)
    : 'unknown'));

  if (walk.siblingAccountId) {
    out.push(pad('merge check', `sibling "${walk.siblingName}" is a separate Account `
      + `(${walk.siblingAccountId.slice(0, 8)}) — not merged`));
  }
  return out.join('\n');
}

export function renderScoreDetail(walk: WalkResult): string {
  return walk.lineage ? renderScoreLineage(walk.lineage) : '(no canonical score)';
}
