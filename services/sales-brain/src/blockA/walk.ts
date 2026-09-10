import { query, withTransaction } from '../db/pool.js';
import { getVerticalProfile } from '../domain/verticals.js';
import { signalFor } from '../domain/signalRegistry.js';
import { upsertAccount, recordEvidence } from '../domain/accounts.js';
import { deriveHypotheses, storeHypotheses } from '../domain/hypotheses.js';
import { scoreAccount } from '../scoring/score.js';
import { explainScore, type ScoreLineage } from '../scoring/explain.js';
import { advertiserEvidenceFor, type AdvertiserEvidence } from '../domain/advertiserEvidence.js';
import { researchPictureFor, type ResearchPicture } from '../domain/researchFacts.js';
import { readinessFor, type Readiness } from '../domain/repReady.js';
import { buildCallPack, type CallPack } from '../callbrain/callPack.js';
import { resolveObjections } from '../callbrain/objections.js';
import { offersForHypothesis } from '../domain/offerCatalog.js';

/**
 * One company taken the whole way, for every case an operator has to tell apart.
 * Authority: Issue #3 Block A.
 *
 * `tests/downstreamWalk.test.ts` already walks five verticals and asserts the chain
 * holds, and this is not a second copy of it. It exists because the question Block A
 * actually asks is whether a company can go from "found" to "here is exactly why to
 * call and exactly what may truthfully be said" *without a silent gap* -- and
 * answering that needs the artifact a person reads, across the cases where the
 * honest answer is "we do not know", not only assertions that objects are non-empty.
 *
 * It calls the real engines throughout and invents no scoring, no hooks and no copy.
 *
 * One difference from the existing walk worth naming: that file walks `law-firms` as
 * its fifth vertical, so **plumbing has never been walked end to end** even though it
 * is one of the two profiles the architecture treats as proven. This walks the five
 * the assignment names.
 */

export const BLOCK_A_VERTICALS = [
  'roofing', 'hvac', 'plumbing', 'collision-repair', 'real-estate-brokerages',
] as const;

export type BlockACase =
  | 'A_STRONG_ADVERTISER'
  | 'B_NEVER_RESEARCHED'
  | 'C_STALE_RESEARCH'
  | 'D_SOURCE_UNAVAILABLE'
  | 'E_CHECKED_NOT_OBSERVED'
  | 'F_SUPPRESSED'
  | 'G_WRONG_NUMBER'
  | 'H_WEAK_MERGE';

export const BLOCK_A_CASES: readonly BlockACase[] = [
  'A_STRONG_ADVERTISER', 'B_NEVER_RESEARCHED', 'C_STALE_RESEARCH',
  'D_SOURCE_UNAVAILABLE', 'E_CHECKED_NOT_OBSERVED', 'F_SUPPRESSED',
  'G_WRONG_NUMBER', 'H_WEAK_MERGE',
];

export const CASE_INTENT: Record<BlockACase, string> = {
  A_STRONG_ADVERTISER: 'strong paid advertiser, fresh research',
  B_NEVER_RESEARCHED: 'discovered, never researched — must be RESEARCH_NEEDED, not NOT_WORKABLE',
  C_STALE_RESEARCH: 'research ran, evidence expired — must not speak as current',
  D_SOURCE_UNAVAILABLE: 'Meta / storm feed absent — must stay UNKNOWN, never "does not advertise"',
  E_CHECKED_NOT_OBSERVED: 'looked and did not see it — different from never looking',
  F_SUPPRESSED: 'suppressed — evidence may accrue, the rep stays blocked',
  G_WRONG_NUMBER: 'a number the prospect already told us is wrong',
  H_WEAK_MERGE: 'two similar businesses that must not be merged for convenience',
};

export interface WalkResult {
  vertical: string;
  caseId: BlockACase;
  accountId: string;
  companyName: string;
  discoverySource: string;
  researchState: string;
  advertiser: AdvertiserEvidence;
  picture: ResearchPicture;
  lineage: ScoreLineage | null;
  readiness: Readiness | null;
  hypotheses: Awaited<ReturnType<typeof deriveHypotheses>>;
  pack: CallPack | null;
  objections: { intent: string; origin: string }[];
  offers: { offerId: string; priority: number }[];
  siblingAccountId?: string;
  siblingName?: string;
}

let sequence = 0;

/**
 * Only signals a profile declares *and* this system can actually collect.
 *
 * The capability filter is the point. An earlier version of this walk took "the next
 * signal the profile declares" and for several verticals that was `active_meta_ads` --
 * so the walk fabricated Meta evidence, scored +3 for it, and rendered
 * "confirmed current Meta advertising" to a rep from a source that does not exist.
 * `recordEvidence` now refuses that outright; this filter means the walk never asks.
 */
async function declaredClaimKeys(vertical: string): Promise<Map<string, string>> {
  const profile = await getVerticalProfile(vertical);
  const map = new Map<string, string>();
  for (const rule of (profile?.public_signal_rules ?? []) as any[]) {
    if (!rule?.signal_id || !rule?.evidence_claim_key) continue;
    const claimKey = String(rule.evidence_claim_key);
    const signal = signalFor(claimKey);
    if (signal && signal.requiredCapability !== null) continue;
    map.set(String(rule.signal_id), claimKey);
  }
  return map;
}

/**
 * Read from the profiles rather than hard-coded per vertical.
 *
 * If a profile stops declaring the advertising signal, the walk fails loudly instead
 * of quietly scoring one company on a different basis from the rest.
 */
const AD_SIGNAL = 'active_google_search_ads';

export async function walkCase(vertical: string, caseId: BlockACase): Promise<WalkResult> {
  sequence += 1;
  const name = `Block A ${vertical} ${caseId} ${sequence}`;
  const claims = await declaredClaimKeys(vertical);

  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: `https://blocka-${sequence}.invalid`,
    phone: `904-555-${String(4000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: vertical,
    contactTitle: 'Owner', contactName: 'Dana Fielder',
  }, { discoverySource: 'market_miner:dataforseo' }));

  let siblingAccountId: string | undefined;
  let siblingName: string | undefined;

  const fresh = new Date(Date.now() + 30 * 86_400_000);
  const expired = new Date(Date.now() - 86_400_000);

  const addEvidence = async (
    signalId: string, expiresAt: Date, observed: 'yes' | 'no' = 'yes',
  ): Promise<void> => {
    const claimKey = claims.get(signalId);
    if (!claimKey) throw new Error(`${vertical} does not declare ${signalId}`);
    await withTransaction((client) => recordEvidence(client, {
      accountId, category: 'block_a', claimKey,
      claimText: observed === 'yes'
        ? 'Observed on their own site for the Block A walk.'
        : 'The searches we ran for the Block A walk did not surface a paid result.',
      normalizedValue: observed, confidence: 'confirmed', canStateAsFact: true,
      sourceType: 'first_party', expiresAt,
    }));
  };

  const markResearched = async (freshUntil: Date | null): Promise<void> => {
    await query(
      `update accounts set last_researched_at = now(), research_fresh_until = $2
        where account_id = $1`, [accountId, freshUntil]);
  };

  switch (caseId) {
    case 'A_STRONG_ADVERTISER': {
      await addEvidence(AD_SIGNAL, fresh);
      const second = [...claims.keys()].find((id) => id !== AD_SIGNAL);
      if (second) await addEvidence(second, fresh);
      await markResearched(fresh);
      break;
    }
    case 'B_NEVER_RESEARCHED':
      break;
    case 'C_STALE_RESEARCH':
      await addEvidence(AD_SIGNAL, expired);
      await markResearched(expired);
      break;
    case 'D_SOURCE_UNAVAILABLE':
      await addEvidence(AD_SIGNAL, fresh);
      await markResearched(fresh);
      break;
    case 'E_CHECKED_NOT_OBSERVED':
      // The distinction this case exists for: an evidence row saying the search ran
      // and returned nothing. Marking the Account researched is not enough --
      // website research and a paid-search check are different looks, so with no ad
      // evidence at all the honest state is UNKNOWN, not NOT_OBSERVED. An earlier
      // version of this fixture got that wrong and quietly claimed the case was
      // covered while never exercising NOT_OBSERVED at all.
      await addEvidence(AD_SIGNAL, fresh, 'no');
      await markResearched(fresh);
      break;
    case 'F_SUPPRESSED':
      await addEvidence(AD_SIGNAL, fresh);
      await markResearched(fresh);
      await query(
        `insert into suppressions (scope, account_id, suppression_type, source, reason)
         values ('ACCOUNT',$1,'DNC','PROSPECT_REQUEST','Asked not to be contacted.')`,
        [accountId]);
      await query(
        `update accounts set is_suppressed = true,
                suppression_summary = 'Asked not to be contacted.'
          where account_id = $1`, [accountId]);
      break;
    case 'G_WRONG_NUMBER':
      await addEvidence(AD_SIGNAL, fresh);
      await markResearched(fresh);
      await query(
        `update contact_endpoints set quality_state = 'WRONG_NUMBER'
          where account_id = $1 and endpoint_type = 'PHONE'`, [accountId]);
      break;
    case 'H_WEAK_MERGE': {
      await addEvidence(AD_SIGNAL, fresh);
      await markResearched(fresh);
      // Same trade, same town, a similar name, and nothing they actually share:
      // different street, different number, different domain.
      sequence += 1;
      siblingName = `Block A ${vertical} ${caseId} ${sequence}`;
      const sibling = await withTransaction((client) => upsertAccount(client, {
        canonicalName: siblingName!,
        website: `https://blocka-${sequence}.invalid`,
        phone: `904-555-${String(4000 + sequence).slice(-4)}`,
        city: 'St. Augustine', state: 'FL', postalCode: '32095',
        verticalProfileId: vertical,
        contactTitle: 'Owner', contactName: 'Dana Fielder',
      }, { discoverySource: 'market_miner:dataforseo' }));
      siblingAccountId = sibling.accountId;
      break;
    }
  }

  const hypotheses = await deriveHypotheses(accountId);
  await storeHypotheses(accountId, hypotheses);
  await scoreAccount(accountId);

  const pack = await buildCallPack(accountId);
  const objections = (await resolveObjections({
    verticalProfileId: vertical, genericKeys: ['busy'],
    said: 'we are busy right now',
  })).map((o) => ({ intent: o.intent, origin: String(o.origin) }));

  const primary = hypotheses[0];
  const offers = primary
    ? (await offersForHypothesis({
        verticalProfileId: vertical, hypothesisId: primary.hypothesisId,
      })).map((offer) => ({ offerId: offer.offerId, priority: offer.priority }))
    : [];

  const { rows: research } = await query<{ state: string }>(
    `select case
              when last_researched_at is null then 'NEVER_RESEARCHED'
              when research_fresh_until is null then 'RESEARCHED_NO_TTL'
              when research_fresh_until < now() then 'STALE'
              else 'FRESH' end as state
       from accounts where account_id = $1`, [accountId]);

  return {
    vertical, caseId, accountId, companyName: name,
    discoverySource: 'market_miner:dataforseo',
    researchState: research[0]?.state ?? 'UNKNOWN',
    advertiser: await advertiserEvidenceFor(accountId),
    picture: await researchPictureFor(accountId),
    lineage: await explainScore(accountId),
    readiness: await readinessFor(accountId),
    hypotheses, pack, objections, offers,
    siblingAccountId, siblingName,
  };
}
