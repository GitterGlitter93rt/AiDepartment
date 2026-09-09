import { createHash } from 'node:crypto';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { neutralInquiryFor } from './identity.js';
import { transitionProbe, allocateForProbe } from './ledger.js';
import type { FormDescriptor } from './forms.js';
import type { ProbeStatus } from './states.js';

/**
 * Everything a submission is, right up to the point of sending it.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §21, and the live
 * boundary of 2026-09-09.
 *
 * The submitter resolves the form, builds the exact payload it would send, digests
 * it, allocates transport and advances the state machine. It then stops. There is no
 * HTTP client in this file, nothing imports one, and `PROBE_SUBMISSION_ENABLED`
 * gates a code path that does not exist yet -- so the guarantee is structural rather
 * than a flag somebody could flip by accident.
 *
 * The payload is built even though it is never sent, and that is the point of a dry
 * run: an eligibility analysis that never constructs the thing it approves has not
 * checked whether it could be constructed. Twice this caught its own bug in
 * fixtures -- a form whose only free-text field was a required dispatch note, and an
 * email validator that rejected the alias we planned to use.
 */

export interface SubmissionPayload {
  url: string;
  /** Field name to the value we would send. */
  fields: Record<string, string>;
  /** Deliberately empty in V1: no third-party checkbox is ever ticked. */
  checkboxesChecked: string[];
  /** Which fields we declined to fill, and why. */
  omitted: { name: string; label: string; reason: string }[];
}

export interface DryRunResult {
  probeId: string;
  submitted: false;
  status: ProbeStatus;
  payload: SubmissionPayload | null;
  payloadDigest: string | null;
  poolNumberE164: string | null;
  detail: string;
  /** Why a real submission did not happen. Always populated in dry-run. */
  liveBlockedBy: string[];
}

export interface BuildPayloadInput {
  form: FormDescriptor;
  identityName: string;
  poolNumberE164: string;
  emailAlias: string;
  verticalProfileId: string | null;
  zipOrCity?: string | null;
}

/**
 * The exact body that would be posted.
 *
 * Every field is filled from something we actually control -- a registered identity
 * name, a pool number we own, an alias we issued, a neutral sentence from the
 * vertical. Anything that would need a substantive fact is omitted with a reason,
 * and if such a field was required the form was already ineligible before this ran.
 */
export function buildPayload(input: BuildPayloadInput): SubmissionPayload {
  const fields: Record<string, string> = {};
  const omitted: SubmissionPayload['omitted'] = [];

  for (const field of input.form.fields) {
    switch (field.kind) {
      case 'NAME': fields[field.name] = input.identityName; break;
      case 'PHONE': fields[field.name] = input.poolNumberE164; break;
      case 'EMAIL': fields[field.name] = input.emailAlias; break;
      case 'MESSAGE': fields[field.name] = neutralInquiryFor(input.verticalProfileId); break;
      case 'ZIP_OR_CITY':
        if (input.zipOrCity) fields[field.name] = input.zipOrCity;
        else {
          omitted.push({ name: field.name, label: field.label,
            reason: 'no market value available, and a made-up postcode is a fabricated fact' });
        }
        break;
      default:
        omitted.push({
          name: field.name, label: field.label,
          reason: `kind ${field.kind} would require inventing a substantive fact`,
        });
    }
  }

  return { url: input.form.url, fields, checkboxesChecked: [], omitted };
}

export function digestPayload(payload: SubmissionPayload): string {
  // Stable key order so the same payload digests identically across runs. The digest
  // proves what was prepared without storing something re-submittable.
  const canonical = JSON.stringify({
    url: payload.url,
    fields: Object.keys(payload.fields).sort().map((key) => [key, payload.fields[key]]),
    checkboxesChecked: [...payload.checkboxesChecked].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Simulated transport outcomes.
 *
 * These exist so the failure paths are exercised without a network: a form that
 * 500s, and a process that dies between SUBMITTING and SUBMITTED. The second is the
 * one worth having -- it is the case where a blind retry would produce a second real
 * inquiry, and the resolution has to be reading the ledger instead.
 */
export type SimulatedOutcome =
  | { kind: 'ACCEPTED' }
  | { kind: 'SERVER_ERROR'; statusCode: number }
  | { kind: 'CRASH_BEFORE_CONFIRMATION' };

export interface DryRunInput {
  probeId: string;
  form: FormDescriptor;
  identityName: string;
  emailAlias: string;
  verticalProfileId: string | null;
  zipOrCity?: string | null;
  now: Date;
  simulate?: SimulatedOutcome;
  marketAffinity?: string | null;
}

/**
 * Why a live submission would still not happen, listed rather than summarised.
 *
 * All of them are reported, not just the first, because "turn the switch on" is the
 * obvious next question and the honest answer is that the switch is one of five
 * things.
 */
export function liveBlockers(): string[] {
  const blockers: string[] = [];
  if (config.probe.killSwitch) blockers.push('PROBE_KILL_SWITCH is on');
  if (!config.probe.submissionEnabled) blockers.push('PROBE_SUBMISSION_ENABLED is false');
  if (config.probe.globalNightlyCap <= 0) blockers.push('global nightly cap is 0');
  if (config.probe.perMarketNightlyCap <= 0) blockers.push('per-market nightly cap is 0');
  if (config.probe.perVerticalNightlyCap <= 0) blockers.push('per-vertical nightly cap is 0');
  blockers.push('no live submission transport is implemented in this build');
  return blockers;
}

export async function dryRunSubmit(input: DryRunInput): Promise<DryRunResult> {
  const blockers = liveBlockers();

  const allocation = await allocateForProbe({
    probeId: input.probeId, now: input.now, marketAffinity: input.marketAffinity ?? null,
  });
  if (!allocation.allocated) {
    // Deferred, and still PLANNED. Not an error and not a failure of the company.
    const { rows } = await query<{ status: ProbeStatus }>(
      `select status from lead_response_probes where probe_id = $1`, [input.probeId]);
    return {
      probeId: input.probeId, submitted: false, status: rows[0]!.status,
      payload: null, payloadDigest: null, poolNumberE164: null,
      detail: `${allocation.reason}: ${allocation.detail}`,
      liveBlockedBy: blockers,
    };
  }

  await transitionProbe({
    probeId: input.probeId, to: 'AUTHORIZED',
    reason: 'authorized for dry-run preparation', actor: 'dry-run',
  });

  const payload = buildPayload({
    form: input.form,
    identityName: input.identityName,
    poolNumberE164: allocation.e164,
    emailAlias: input.emailAlias,
    verticalProfileId: input.verticalProfileId,
    zipOrCity: input.zipOrCity ?? null,
  });
  const digest = digestPayload(payload);

  await transitionProbe({
    probeId: input.probeId, to: 'SUBMITTING',
    reason: 'payload prepared', actor: 'dry-run',
    set: {
      submitted_payload_digest: digest,
      submitted_payload_summary: JSON.stringify({
        url: payload.url,
        fieldNames: Object.keys(payload.fields).sort(),
        omitted: payload.omitted,
        checkboxesChecked: payload.checkboxesChecked,
      }),
    },
  });

  const outcome = input.simulate ?? { kind: 'ACCEPTED' as const };

  if (outcome.kind === 'SERVER_ERROR') {
    const status = await transitionProbe({
      probeId: input.probeId, to: 'FAILED',
      reason: `simulated HTTP ${outcome.statusCode} from the form endpoint`,
      actor: 'dry-run',
      set: { ineligible_reason: `SUBMIT_FAILED_HTTP_${outcome.statusCode}` },
    });
    return {
      probeId: input.probeId, submitted: false, status, payload, payloadDigest: digest,
      poolNumberE164: allocation.e164,
      detail: `The form endpoint would have returned ${outcome.statusCode}. A fact `
        + 'about the form, not about the company, and not retried.',
      liveBlockedBy: blockers,
    };
  }

  if (outcome.kind === 'CRASH_BEFORE_CONFIRMATION') {
    // Left in SUBMITTING deliberately. Recovery reads this state and decides; it
    // does not resubmit, because the one thing we cannot know is whether the form
    // received it.
    return {
      probeId: input.probeId, submitted: false, status: 'SUBMITTING',
      payload, payloadDigest: digest, poolNumberE164: allocation.e164,
      detail: 'Simulated crash between preparing and confirming. The probe stays in '
        + 'SUBMITTING: whether the form received it is unknown, so it is resolved by '
        + 'a person reading the ledger rather than by submitting again.',
      liveBlockedBy: blockers,
    };
  }

  const status = await transitionProbe({
    probeId: input.probeId, to: 'SUBMITTED',
    reason: 'dry run: payload prepared and accepted by the simulated transport; '
      + 'nothing was sent',
    actor: 'dry-run',
    set: { submitted_at: input.now },
  });

  return {
    probeId: input.probeId, submitted: false, status,
    payload, payloadDigest: digest, poolNumberE164: allocation.e164,
    detail: 'Prepared and recorded. Zero bytes left this machine.',
    liveBlockedBy: blockers,
  };
}

/**
 * Probes stuck in SUBMITTING, for a person to resolve.
 *
 * Deliberately a report rather than a repair. The unknown is whether the form
 * received the submission, and no amount of code can find that out; guessing either
 * way produces either a lost measurement or a duplicate inquiry.
 */
export async function probesAwaitingManualResolution(): Promise<
  { probeId: string; accountId: string; since: Date }[]
> {
  const { rows } = await query<{ probe_id: string; account_id: string; updated_at: Date }>(
    `select probe_id, account_id, updated_at from lead_response_probes
      where status = 'SUBMITTING' order by updated_at`);
  return rows.map((row) => ({
    probeId: row.probe_id, accountId: row.account_id, since: row.updated_at,
  }));
}
