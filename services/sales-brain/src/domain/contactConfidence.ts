import { query } from '../db/pool.js';

/**
 * How sure we are that a named person is still the person to ask for.
 *
 * The resolver derives a role confidence honestly -- confirmed employer plus fresh
 * observation is `CONFIRMED_CURRENT_ROLE`, a gatekeeper saying somebody left is
 * `HISTORICAL_ROLE` -- and then sets `refresh_due_at = now() + 30 days` on every
 * contact, and nothing has ever read that column.
 *
 * So confidence never decayed. A person resolved eighteen months ago still reads
 * `LIKELY_CURRENT_ROLE / FRESH`, the call pack hands a rep the name with no
 * qualifier, and the rep asks the receptionist for somebody who left a year ago. It
 * is the one mistake on a cold call that cannot be recovered from in the same call:
 * the gatekeeper now knows the list is old.
 *
 * The distinction this adds is between two kinds of not-current, which had been one:
 *
 *   AGED        nobody has checked since the refresh date. Might still be right.
 *   HISTORICAL  somebody told us they are gone. Do not ask for them.
 *
 * "Nobody has looked in eight months" is not "they left", and a rep does different
 * things with each: the first is asked as a question, the second is not asked at all.
 */

export type ContactConfidence =
  | 'CONFIRMED_CURRENT' | 'LIKELY_CURRENT' | 'AGED' | 'HISTORICAL' | 'ROLE_ONLY'
  | 'UNKNOWN';

export interface ContactStanding {
  confidence: ContactConfidence;
  /** True when a rep may ask for this person by name without hedging. */
  safeToAskByName: boolean;
  /** What to say, or what to do instead. Written for someone about to dial. */
  guidance: string;
  /** How long since anybody checked, in days. Null when never verified. */
  ageDays: number | null;
  overdue: boolean;
}

export interface ContactStandingInput {
  fullName: string | null;
  isRolePlaceholder: boolean;
  roleConfidence: string | null;
  currentness: string | null;
  status: string | null;
  lastVerifiedAt: Date | null;
  refreshDueAt: Date | null;
}

/**
 * Grace beyond the refresh date before a name is treated as aged.
 *
 * The resolver's thirty days is when a re-check becomes due, not when the
 * information becomes wrong. Treating day thirty-one as aged would hedge every name
 * in the system permanently, which teaches a rep to ignore the hedge -- the failure
 * mode of every warning that fires too easily.
 */
const GRACE_DAYS = 60;

export function contactStanding(
  input: ContactStandingInput, now: Date = new Date(),
): ContactStanding {
  const ageDays = input.lastVerifiedAt
    ? Math.floor((now.getTime() - input.lastVerifiedAt.getTime()) / 86_400_000)
    : null;
  const overdue = input.refreshDueAt !== null
    && input.refreshDueAt.getTime() + GRACE_DAYS * 86_400_000 < now.getTime();

  if (input.status === 'LEFT_COMPANY' || input.roleConfidence === 'HISTORICAL_ROLE') {
    return {
      confidence: 'HISTORICAL', safeToAskByName: false, ageDays, overdue,
      guidance: 'Somebody told us this person has left. Do not ask for them by name — '
        + 'ask who handles it now.',
    };
  }

  if (input.isRolePlaceholder || !input.fullName) {
    return {
      confidence: 'ROLE_ONLY', safeToAskByName: false, ageDays, overdue,
      guidance: 'No name was found, only the role. Ask for whoever handles it rather '
        + 'than inventing a person.',
    };
  }

  if (overdue) {
    return {
      confidence: 'AGED', safeToAskByName: false, ageDays, overdue,
      // Not "they left". Nobody has looked.
      guidance: ageDays === null
        ? 'Nobody has confirmed this person is still there. Ask for them, and check '
          + 'they still hold the role rather than assuming it.'
        : `Nobody has checked in ${ageDays} days. Ask for them by name, and confirm `
          + 'they still hold the role — an old name is worth using and worth checking.',
    };
  }

  if (input.roleConfidence === 'CONFIRMED_CURRENT_ROLE' && input.currentness === 'FRESH') {
    return {
      confidence: 'CONFIRMED_CURRENT', safeToAskByName: true, ageDays, overdue,
      guidance: 'Confirmed in their role recently. Safe to ask for by name.',
    };
  }

  if (input.roleConfidence === 'LIKELY_CURRENT_ROLE') {
    return {
      confidence: 'LIKELY_CURRENT', safeToAskByName: true, ageDays, overdue,
      guidance: 'Named on a public source and likely still in the role. Safe to ask '
        + 'for by name.',
    };
  }

  return {
    confidence: 'UNKNOWN', safeToAskByName: false, ageDays, overdue,
    guidance: 'We have a name and nothing that confirms the role. Ask for them and '
      + 'let the gatekeeper correct you.',
  };
}

/** The standing of the person a rep would be told to ask for. */
export async function primaryContactStanding(accountId: string): Promise<{
  contactId: string; fullName: string | null; title: string | null;
  standing: ContactStanding;
} | null> {
  const { rows } = await query<{
    contact_id: string; full_name: string | null; raw_title: string | null;
    is_role_placeholder: boolean; role_confidence: string | null;
    currentness: string | null; status: string | null;
    last_verified_at: Date | null; refresh_due_at: Date | null;
  }>(
    `select contact_id, full_name, raw_title, is_role_placeholder, role_confidence,
            currentness, status, last_verified_at, refresh_due_at
       from contacts
      where account_id = $1 and status = 'ACTIVE'
      order by decision_maker_priority asc nulls last, created_at asc
      limit 1`, [accountId]);
  const row = rows[0];
  if (!row) return null;

  return {
    contactId: row.contact_id,
    fullName: row.full_name,
    title: row.raw_title,
    standing: contactStanding({
      fullName: row.full_name,
      isRolePlaceholder: row.is_role_placeholder,
      roleConfidence: row.role_confidence,
      currentness: row.currentness,
      status: row.status,
      lastVerifiedAt: row.last_verified_at,
      refreshDueAt: row.refresh_due_at,
    }),
  };
}

/**
 * How many named contacts nobody has re-checked.
 *
 * Reported so the column that has always existed finally drives something an
 * operator can see. A growing number here means reps are being handed names from a
 * list that is quietly ageing.
 */
export async function overdueContactCount(): Promise<{ overdue: number; named: number }> {
  const { rows } = await query<{ overdue: number; named: number }>(
    `select count(*) filter (
              where refresh_due_at is not null
                and refresh_due_at + ($1 || ' days')::interval < now())::int as overdue,
            count(*)::int as named
       from contacts
      where status = 'ACTIVE' and not is_role_placeholder and full_name is not null`,
    [String(GRACE_DAYS)]);
  return { overdue: rows[0]!.overdue, named: rows[0]!.named };
}

export { GRACE_DAYS };
