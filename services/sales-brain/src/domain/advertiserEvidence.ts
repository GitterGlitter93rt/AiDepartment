import { query } from '../db/pool.js';

/**
 * Whether a company is spending money, and how sure we are.
 *
 * The product prioritises businesses already buying customers, so this signal
 * decides which prospects a rep sees first. That makes the difference between
 * "we looked and there was no ad" and "we have never looked" a commercial
 * difference, not a philosophical one -- and the projection collapsed both into a
 * null that `coalesce(google_paid, false)` then rendered as "not an advertiser".
 *
 * Four states, kept apart all the way to the screen:
 *
 *   CONFIRMED     current evidence says they are advertising on this channel
 *   NOT_OBSERVED  we looked and the ad was not there
 *   STALE         we saw one, it has aged past its window, nobody has re-checked
 *   UNKNOWN       nothing has ever looked
 *
 * One search that did not show an ad is NOT_OBSERVED for that query, on that day,
 * in that place. It is never "this company does not advertise".
 */

export type AdvertiserState = 'CONFIRMED' | 'NOT_OBSERVED' | 'STALE' | 'UNKNOWN';

export type AdChannel = 'google_search' | 'google_lsa' | 'meta';

const CLAIM_KEY: Record<AdChannel, string> = {
  google_search: 'active_google_search_ad',
  google_lsa: 'active_local_service_ad',
  meta: 'active_meta_ad',
};

const CHANNEL_LABEL: Record<AdChannel, string> = {
  google_search: 'Google paid search',
  google_lsa: 'Google Local Services',
  meta: 'Meta',
};

export interface ChannelEvidence {
  channel: AdChannel;
  label: string;
  state: AdvertiserState;
  /** When the most recent usable or expired observation was made. */
  observedAt: Date | null;
  expiresAt: Date | null;
  provider: string | null;
  /** Every sighting is kept; this is how many we hold. */
  observationCount: number;
  /** A sentence for a rep. Never a claim the evidence does not support. */
  summary: string;
}

export interface AdvertiserEvidence {
  channels: ChannelEvidence[];
  /** Channels with current confirmed evidence. */
  confirmedChannels: number;
  /** True when nothing has ever looked at any channel. */
  neverChecked: boolean;
}

interface EvidenceRow {
  claim_key: string;
  normalized_value: string | null;
  source_provider: string | null;
  observed_at: Date;
  expires_at: Date | null;
  expired: boolean;
  contradicted: boolean;
}

function summarise(channel: AdChannel, state: AdvertiserState, observedAt: Date | null): string {
  const label = CHANNEL_LABEL[channel];
  switch (state) {
    case 'CONFIRMED':
      return `${label}: currently advertising, confirmed by observation.`;
    case 'NOT_OBSERVED':
      // Deliberately about the observation, not about the company.
      return `${label}: checked and no ad was showing for the queries we ran. That is `
        + 'about those searches, not proof the company does not advertise.';
    case 'STALE':
      return `${label}: an ad was confirmed${observedAt ? ` on ${observedAt.toISOString().slice(0, 10)}` : ''}, `
        + 'but that observation has aged out and nobody has re-checked.';
    default:
      return `${label}: never checked.`;
  }
}

/**
 * The advertiser picture for one Account, per channel.
 *
 * Reads every observation rather than a boolean, because the boolean is what threw
 * the distinction away.
 */
export async function advertiserEvidenceFor(accountId: string): Promise<AdvertiserEvidence> {
  const { rows } = await query<EvidenceRow>(
    `select claim_key, normalized_value, source_provider, observed_at, expires_at,
            (expires_at is not null and expires_at <= now()) as expired,
            (contradicted_by_evidence_id is not null) as contradicted
       from evidence_records
      where account_id = $1 and claim_key = any($2::text[])
      order by observed_at desc`,
    [accountId, Object.values(CLAIM_KEY)],
  );

  const channels: ChannelEvidence[] = (Object.keys(CLAIM_KEY) as AdChannel[]).map((channel) => {
    const forChannel = rows.filter((row) => row.claim_key === CLAIM_KEY[channel]);
    const usable = forChannel.filter((row) => !row.expired && !row.contradicted);

    const confirmed = usable.find((row) => row.normalized_value === 'yes');
    if (confirmed) {
      return {
        channel, label: CHANNEL_LABEL[channel], state: 'CONFIRMED' as const,
        observedAt: confirmed.observed_at, expiresAt: confirmed.expires_at,
        provider: confirmed.source_provider, observationCount: forChannel.length,
        summary: summarise(channel, 'CONFIRMED', confirmed.observed_at),
      };
    }

    // Somebody looked and recorded that the ad was not there. That is a real
    // observation and it is not the same as never having looked.
    const negative = usable.find((row) => row.normalized_value === 'no');
    if (negative) {
      return {
        channel, label: CHANNEL_LABEL[channel], state: 'NOT_OBSERVED' as const,
        observedAt: negative.observed_at, expiresAt: negative.expires_at,
        provider: negative.source_provider, observationCount: forChannel.length,
        summary: summarise(channel, 'NOT_OBSERVED', negative.observed_at),
      };
    }

    const aged = forChannel.find((row) => row.expired && row.normalized_value === 'yes');
    if (aged) {
      return {
        channel, label: CHANNEL_LABEL[channel], state: 'STALE' as const,
        observedAt: aged.observed_at, expiresAt: aged.expires_at,
        provider: aged.source_provider, observationCount: forChannel.length,
        summary: summarise(channel, 'STALE', aged.observed_at),
      };
    }

    return {
      channel, label: CHANNEL_LABEL[channel], state: 'UNKNOWN' as const,
      observedAt: null, expiresAt: null, provider: null,
      observationCount: forChannel.length,
      summary: summarise(channel, 'UNKNOWN', null),
    };
  });

  return {
    channels,
    confirmedChannels: channels.filter((channel) => channel.state === 'CONFIRMED').length,
    neverChecked: channels.every((channel) => channel.state === 'UNKNOWN'),
  };
}

/**
 * How many Accounts in a market an advertising filter is hiding because nobody has
 * checked them, as opposed to having checked and found nothing.
 *
 * Same defect as the tier filter: `coalesce(google_paid, false)` drops the unknowns
 * silently, so a rep filtering for advertisers sees an empty market and cannot tell
 * whether that market has no advertisers or has never been looked at.
 */
export async function unknownAdvertiserCount(scope: {
  verticalProfileId?: string | null;
  geography?: { type?: string; value?: string } | null;
}): Promise<number> {
  const conditions = [
    'not is_suppressed',
    // Never checked on any channel: no evidence at all, current or expired.
    `not exists (
       select 1 from evidence_records ev
        where ev.account_id = prospect_inventory.account_id
          and ev.claim_key in ('active_google_search_ad','active_local_service_ad','active_meta_ad'))`,
  ];
  const values: unknown[] = [];

  if (scope.verticalProfileId) {
    values.push(scope.verticalProfileId);
    conditions.push(`primary_vertical_profile_id = $${values.length}`);
  }
  const geography = scope.geography;
  if (geography?.type === 'zip_zcta' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`postal_code = $${values.length}`);
  } else if (geography?.type === 'city' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`lower(city) = lower($${values.length})`);
  } else if (geography?.type === 'state' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`state_region = upper($${values.length})`);
  }

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from prospect_inventory where ${conditions.join(' and ')}`,
    values,
  );
  return rows[0]?.n ?? 0;
}
