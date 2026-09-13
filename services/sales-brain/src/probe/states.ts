/**
 * The probe lifecycle, and the transitions that are allowed to happen.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §13.
 *
 * A probe is a thing we did to a real company, so its path is evidence and not just
 * bookkeeping. Two consequences shape this file.
 *
 * The transition table is explicit rather than permissive. A status field with no
 * table around it drifts into "any value to any value", and the states that matter
 * here are exactly the ones somebody would be tempted to skip: SUBMITTED straight to
 * ATTRIBUTED without a response event, or FAILED to RESPONDED because a late webhook
 * arrived for a probe that never submitted.
 *
 * PLANNED is both the initial state and the resting state of a deferred probe. That
 * is not an accident of naming: a probe that cannot get a non-colliding number has
 * not failed and must not be forced onto one, so it waits where it started.
 */

export type ProbeStatus =
  | 'PLANNED'
  | 'AUTHORIZED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'AUTO_ACKNOWLEDGED'
  | 'RESPONDED'
  | 'ATTRIBUTED'
  | 'AMBIGUOUS'
  | 'NO_RESPONSE_WINDOW_1'
  | 'NO_RESPONSE_FINAL'
  | 'CANCELLED'
  | 'FAILED';

/**
 * Statuses that occupy the Account and the pool number.
 *
 * PLANNED counts as open, which is what makes the unique index in migration 049 a
 * duplicate-probe guard rather than a duplicate-submission guard. Two planned probes
 * for one company is the duplicate worth preventing: by the time one has submitted
 * the other would be a second inquiry.
 */
export const OPEN_STATUSES: readonly ProbeStatus[] = [
  'PLANNED', 'AUTHORIZED', 'SUBMITTING', 'SUBMITTED', 'AUTO_ACKNOWLEDGED', 'RESPONDED',
];

/**
 * Statuses where a response window is still running, and therefore where an inbound
 * event may still be attributed.
 *
 * `NO_RESPONSE_WINDOW_1` belongs here, which is not obvious and is the whole point:
 * window 1 closing is provisional, and the next-afternoon callback is the single most
 * interesting measurement this subsystem takes. Leaving that status out made the
 * probe invisible to the attribution ladder, so a real human callback was recorded
 * against nothing and the probe closed as NO_RESPONSE_FINAL -- a verdict defended by
 * discarding the evidence against it.
 */
export const AWAITING_RESPONSE_STATUSES: readonly ProbeStatus[] = [
  'SUBMITTED', 'AUTO_ACKNOWLEDGED', 'RESPONDED', 'NO_RESPONSE_WINDOW_1',
];

export const TERMINAL_STATUSES: readonly ProbeStatus[] = [
  'ATTRIBUTED', 'AMBIGUOUS', 'NO_RESPONSE_FINAL', 'CANCELLED', 'FAILED',
];

/**
 * Statuses that produced a measurement worth deriving a signal from.
 *
 * AMBIGUOUS and FAILED are deliberately absent. Attribution failure is our failure
 * and an unreachable form is a fact about the form; neither is evidence about the
 * company, so neither may reach the signal layer at all.
 */
export const MEASURED_STATUSES: readonly ProbeStatus[] = [
  'ATTRIBUTED', 'NO_RESPONSE_FINAL',
];

const TRANSITIONS: Record<ProbeStatus, readonly ProbeStatus[]> = {
  PLANNED: ['AUTHORIZED', 'CANCELLED', 'FAILED'],
  // Authorization can be withdrawn, and eligibility can change between authorizing
  // and submitting -- a form that gained a consent gate, an Account that gained a
  // suppression.
  AUTHORIZED: ['SUBMITTING', 'CANCELLED', 'FAILED'],
  // No path back to AUTHORIZED. A crash during submission is resolved by reading the
  // ledger, never by submitting again: a blind retry is how one audit becomes two
  // inquiries.
  SUBMITTING: ['SUBMITTED', 'FAILED'],
  // NO_RESPONSE_FINAL is reachable directly, not only through window 1. A worker
  // outage between the two sweeps must not strand a probe in SUBMITTED for ever,
  // holding its Account and its pool number: the final window closing has to be
  // able to terminate a probe whatever happened to the provisional one.
  SUBMITTED: ['AUTO_ACKNOWLEDGED', 'RESPONDED', 'AMBIGUOUS', 'NO_RESPONSE_WINDOW_1',
              'NO_RESPONSE_FINAL'],
  // ATTRIBUTED is reachable directly: a probe whose only response was an
  // automated acknowledgement did attribute a response, and closing it as
  // NO_RESPONSE_FINAL would lose the acknowledgement we actually measured. The
  // absence of a human is carried by `no_human_followup_observed`, not by
  // pretending nothing arrived.
  AUTO_ACKNOWLEDGED: ['RESPONDED', 'ATTRIBUTED', 'AMBIGUOUS', 'NO_RESPONSE_WINDOW_1'],
  // A response arrived and was attributed, or could not be. ATTRIBUTED is only
  // reachable from a state where a response actually exists.
  RESPONDED: ['ATTRIBUTED', 'AMBIGUOUS'],
  // The first window closing is provisional: a late human callback is common and
  // must be able to promote the probe rather than being discarded to protect a
  // verdict already written down.
  NO_RESPONSE_WINDOW_1: ['RESPONDED', 'AUTO_ACKNOWLEDGED', 'AMBIGUOUS', 'NO_RESPONSE_FINAL'],
  ATTRIBUTED: [],
  AMBIGUOUS: [],
  NO_RESPONSE_FINAL: [],
  CANCELLED: [],
  FAILED: [],
};

export function isOpen(status: ProbeStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function canTransition(from: ProbeStatus, to: ProbeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Refuse an illegal transition loudly.
 *
 * Thrown rather than returned because every caller is inside a transaction that
 * should not commit. A probe silently staying in the wrong state is worse than a
 * failed job: the job can be retried, and a wrong state becomes a wrong measurement.
 */
export function assertTransition(from: ProbeStatus, to: ProbeStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    throw new Error(
      `Probe cannot go from ${from} to ${to}. `
      + (allowed.length > 0 ? `Allowed: ${allowed.join(', ')}.` : `${from} is terminal.`),
    );
  }
}
