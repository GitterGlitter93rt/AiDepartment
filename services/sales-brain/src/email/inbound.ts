import { query, withTransaction } from '../db/pool.js';

/**
 * Inbound email events from the execution provider.
 * Authority: outbound-sales-brain-smartlead-sync-spec.md §5-§11, §17, §20.
 *
 * Every event lands on the canonical Account, so email is part of the same memory
 * as phone and field rather than a second sales organization keeping its own books.
 */

export type ReplyClass =
  | 'POSITIVE_INTEREST' | 'QUESTION' | 'SEND_INFO' | 'CORRECT_PERSON_REFERRAL'
  | 'TIMING_LATER' | 'ALREADY_SOLVED' | 'NOT_INTERESTED' | 'UNSUBSCRIBE_OPT_OUT'
  | 'WRONG_PERSON' | 'WRONG_COMPANY' | 'OUT_OF_OFFICE' | 'BOUNCE' | 'OTHER_REVIEW';

export interface InboundEvent {
  provider: string;
  providerEventId: string | null;
  eventType: 'CAMPAIGN_ASSIGNED' | 'SENT' | 'DELIVERED' | 'OPENED' | 'BOUNCED' | 'REPLIED'
    | 'UNSUBSCRIBED' | 'COMPLAINT' | 'SEQUENCE_STOPPED' | 'CAMPAIGN_COMPLETE';
  /** Correlation id we supplied on export. Preferred over the address. */
  enrollmentId?: string | null;
  providerLeadId?: string | null;
  email?: string | null;
  replyText?: string | null;
  bounceType?: 'hard' | 'soft' | null;
  occurredAt?: Date;
}

export interface IngestResult {
  ok: boolean;
  duplicate: boolean;
  enrollmentId: string | null;
  accountId: string | null;
  replyClass: ReplyClass | null;
  actions: string[];
  reason?: string;
}

/**
 * Reply classification. Deliberately conservative: anything that is not clearly one
 * of the decisive classes becomes OTHER_REVIEW for a human, rather than being
 * guessed at. Nothing here books a meeting or sends a reply on its own (spec §7).
 */
export function classifyReply(text: string): ReplyClass {
  const body = text.toLowerCase();

  if (/\b(?:unsubscribe|opt.?out|remove me|take me off)\b/.test(body)) return 'UNSUBSCRIBE_OPT_OUT';
  if (/\bout of (?:the )?office\b|\bon (?:annual |holiday |vacation )?leave\b|\bautomatic reply\b|\bauto[- ]?reply\b/.test(body)) {
    return 'OUT_OF_OFFICE';
  }
  // "no longer works at the company" and "no longer with us" are the two commonest
  // phrasings; the verb between them is optional.
  if (/\b(?:no longer|not)\s+(?:works?|working|employed)?\s*(?:with|at|for|here)\b/.test(body)
      || /\bhas left\b|\bwrong person\b|\bleft the (?:company|business|firm)\b/.test(body)) {
    return 'WRONG_PERSON';
  }
  if (/\bwrong company\b|\bnot (?:a|an) \w+ (?:company|business)\b/.test(body)) return 'WRONG_COMPANY';
  if (/\b(?:you (?:should|need to|want to) (?:talk|speak|reach out) to|please contact|forward(?:ing|ed) (?:this )?to)\b/.test(body)) {
    return 'CORRECT_PERSON_REFERRAL';
  }
  if (/\b(?:not interested|no thanks|no thank you|we'?re all set|not for us|please stop)\b/.test(body)) {
    return 'NOT_INTERESTED';
  }
  if (/\b(?:already (?:have|use|using|sorted|handled)|we (?:have|use) (?:a|an|our own))\b/.test(body)) {
    return 'ALREADY_SOLVED';
  }
  if (/\b(?:next (?:quarter|year|month)|circle back|reach out (?:again )?in|not (?:right )?now|later in the year|revisit)\b/.test(body)) {
    return 'TIMING_LATER';
  }
  if (/\b(?:send|share|forward)\s+(?:me\s+)?(?:some\s+)?(?:more\s+)?(?:info|information|details|a deck|pricing)\b/.test(body)) {
    return 'SEND_INFO';
  }
  if (/\b(?:interested|sounds good|let'?s (?:talk|chat|set)|happy to|would like to|book|schedule|calendar|what times?)\b/.test(body)) {
    return 'POSITIVE_INTEREST';
  }
  if (/\?/.test(text)) return 'QUESTION';
  return 'OTHER_REVIEW';
}

/** Reply classes that must stop generic cold outreach immediately. */
const STOPS_SEQUENCE: ReadonlySet<ReplyClass> = new Set<ReplyClass>([
  'POSITIVE_INTEREST', 'QUESTION', 'SEND_INFO', 'CORRECT_PERSON_REFERRAL',
  'NOT_INTERESTED', 'UNSUBSCRIBE_OPT_OUT', 'WRONG_PERSON', 'WRONG_COMPANY', 'ALREADY_SOLVED',
]);

/** Classes that hand the Account to a human straight away (spec §16). */
const NEEDS_HUMAN: ReadonlySet<ReplyClass> = new Set<ReplyClass>([
  'POSITIVE_INTEREST', 'QUESTION', 'SEND_INFO', 'CORRECT_PERSON_REFERRAL', 'OTHER_REVIEW',
]);

export async function ingestEvent(event: InboundEvent): Promise<IngestResult> {
  const actions: string[] = [];

  // Idempotent ingestion: a replayed webhook changes state once (spec §17).
  if (event.providerEventId) {
    const { rows } = await query<{ email_event_id: string; enrollment_id: string | null }>(
      'select email_event_id, enrollment_id from email_events where provider = $1 and provider_event_id = $2',
      [event.provider, event.providerEventId],
    );
    if (rows[0]) {
      return {
        ok: true, duplicate: true, enrollmentId: rows[0].enrollment_id, accountId: null,
        replyClass: null, actions: [], reason: 'event already ingested',
      };
    }
  }

  // Resolve by correlation id first; the address is a fallback, never the identity.
  const { rows: enrollmentRows } = await query<{
    enrollment_id: string; account_id: string; contact_id: string | null; endpoint_id: string | null;
    email_campaign_id: string;
  }>(
    `select enrollment_id, account_id, contact_id, endpoint_id, email_campaign_id
       from email_enrollments
      where ($1::uuid is not null and enrollment_id = $1::uuid)
         or ($2::text is not null and provider_lead_id = $2::text)
         or ($3::text is not null and normalized_email = lower($3::text))
      order by created_at desc limit 1`,
    [event.enrollmentId ?? null, event.providerLeadId ?? null, event.email ?? null],
  );
  const enrollment = enrollmentRows[0];
  if (!enrollment) {
    return {
      ok: false, duplicate: false, enrollmentId: null, accountId: null, replyClass: null,
      actions: [], reason: 'no enrollment matched this event',
    };
  }

  const replyClass = event.eventType === 'REPLIED' && event.replyText
    ? classifyReply(event.replyText)
    : event.eventType === 'UNSUBSCRIBED' ? 'UNSUBSCRIBE_OPT_OUT'
    : event.eventType === 'BOUNCED' ? 'BOUNCE'
    : null;

  await withTransaction(async (client) => {
    await client.query(
      `insert into email_events (enrollment_id, account_id, provider, provider_event_id,
                                 event_type, reply_class, reply_excerpt, payload, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9, now()))`,
      [
        enrollment.enrollment_id, enrollment.account_id, event.provider, event.providerEventId,
        event.eventType, replyClass, event.replyText?.slice(0, 2000) ?? null,
        JSON.stringify({ bounceType: event.bounceType ?? null }), event.occurredAt ?? null,
      ],
    );

    if (event.eventType === 'BOUNCED' && event.bounceType === 'hard' && enrollment.endpoint_id) {
      // The address dies, the Account does not (spec §9).
      await client.query(
        `update contact_endpoints set quality_state = 'HARD_BOUNCE', is_active = false,
                last_failure_at = now(), failure_reason = 'hard bounce'
          where endpoint_id = $1`,
        [enrollment.endpoint_id],
      );
      await client.query(
        `update email_enrollments set status = 'BOUNCED', last_event_at = now(),
                stop_reason = 'hard bounce' where enrollment_id = $1`,
        [enrollment.enrollment_id],
      );
      actions.push('endpoint_marked_hard_bounce', 'enrollment_stopped');
    }

    if (event.eventType === 'UNSUBSCRIBED' || replyClass === 'UNSUBSCRIBE_OPT_OUT') {
      // Scope comes from policy, not from a model's reading of the reply. Email-scoped
      // by default; widening it to the whole account is an explicit policy decision.
      await client.query(
        `insert into suppressions (scope, account_id, contact_id, endpoint_id, normalized_value,
                                   suppression_type, source, reason)
         values ('EMAIL', $1, $2, $3, $4, 'EMAIL_UNSUBSCRIBE', $5, 'Unsubscribed via email campaign')`,
        [
          enrollment.account_id, enrollment.contact_id, enrollment.endpoint_id,
          event.email?.toLowerCase() ?? null, event.provider,
        ],
      );
      await client.query(
        `update email_enrollments set status = 'UNSUBSCRIBED', last_event_at = now(),
                stop_reason = 'unsubscribed' where enrollment_id = $1`,
        [enrollment.enrollment_id],
      );
      // The opt-out has to reach the provider too. Suppressing on our side while
      // Smartlead still holds an active lead is how an unsubscribed prospect keeps
      // getting email from us (§8).
      await client.query(
        `insert into email_outbox (enrollment_id, operation, payload)
         values ($1, 'STOP', $2)`,
        [enrollment.enrollment_id, JSON.stringify({ reason: 'unsubscribed' })],
      );
      actions.push('email_suppression_created', 'enrollment_stopped', 'provider_optout_queued');
    }

    if (replyClass && STOPS_SEQUENCE.has(replyClass) && replyClass !== 'UNSUBSCRIBE_OPT_OUT') {
      // A real reply must stop contradictory generic outreach.
      await client.query(
        `update email_enrollments set status = 'STOPPED', last_event_at = now(),
                stop_reason = $2 where enrollment_id = $1 and status not in ('UNSUBSCRIBED','BOUNCED')`,
        [enrollment.enrollment_id, `reply: ${replyClass}`],
      );
      // PAUSE, not STOP. A person replying is a conversation to be taken over by a
      // human, and it may resume later; an opt-out is the permanent one. Sending both
      // as the same provider operation loses a distinction we cannot get back.
      await client.query(
        `insert into email_outbox (enrollment_id, operation, payload)
         values ($1, 'PAUSE', $2)`,
        [enrollment.enrollment_id, JSON.stringify({ reason: replyClass })],
      );
      actions.push('sequence_pause_queued');
    }

    if (event.eventType === 'REPLIED') {
      await client.query(
        `insert into activities (account_id, contact_id, activity_type, channel, occurred_at,
                                 notes, source_system, payload)
         values ($1,$2,'EMAIL_REPLY','email', coalesce($3, now()), $4, $5, $6)`,
        [
          enrollment.account_id, enrollment.contact_id, event.occurredAt ?? null,
          event.replyText?.slice(0, 1000) ?? null, event.provider,
          JSON.stringify({ reply_class: replyClass }),
        ],
      );
      actions.push('timeline_updated');
    }

    // Relationship state, so the portal and the phone channel see the same truth.
    if (replyClass === 'POSITIVE_INTEREST' || replyClass === 'QUESTION' || replyClass === 'SEND_INFO') {
      await client.query(
        `update accounts set relationship_state = 'POSITIVE_REPLY'
          where account_id = $1 and relationship_state not in ('CLIENT','PROPOSAL','ACTIVE_OPPORTUNITY')`,
        [enrollment.account_id],
      );
      actions.push('relationship_state_positive_reply');
    }
    if (replyClass === 'NOT_INTERESTED' || replyClass === 'ALREADY_SOLVED') {
      await client.query(
        `update accounts set relationship_state = 'DISQUALIFIED'
          where account_id = $1 and relationship_state not in ('CLIENT','PROPOSAL','ACTIVE_OPPORTUNITY')`,
        [enrollment.account_id],
      );
    }

    // A human owns anything that needs judgement. Nothing is auto-answered (spec §16).
    if (replyClass && NEEDS_HUMAN.has(replyClass)) {
      const { rows: ownerRows } = await client.query<{ owner: string | null }>(
        `select coalesce(a.current_owner_user_id,
                (select user_id from users where role in ('SALES_MANAGER','ADMIN') and is_active
                  order by created_at limit 1)) as owner
           from accounts a where a.account_id = $1`,
        [enrollment.account_id],
      );
      const owner = ownerRows[0]?.owner;
      if (owner) {
        await client.query(
          `insert into follow_ups (account_id, contact_id, owner_user_id, followup_type, due_at,
                                   prospect_requested, context)
           values ($1,$2,$3,'EMAIL', now(), true, $4)`,
          [
            enrollment.account_id, enrollment.contact_id, owner,
            `Email reply classified ${replyClass}. Read it and respond personally: `
            + `"${(event.replyText ?? '').slice(0, 200)}"`,
          ],
        );
        actions.push('human_follow_up_created');
      }
    }

    // A referral creates a candidate; it never invents that person's address (spec §11).
    if (replyClass === 'CORRECT_PERSON_REFERRAL') {
      actions.push('referral_captured_no_email_invented');
    }
  });

  return {
    ok: true, duplicate: false,
    enrollmentId: enrollment.enrollment_id,
    accountId: enrollment.account_id,
    replyClass,
    actions,
  };
}
