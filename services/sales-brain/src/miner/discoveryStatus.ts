/**
 * What a discovery provider's answer meant.
 *
 * Its own file because two very different callers need the same rule and neither may
 * restate it: the miner, which decides what a run achieved, and the Mining page,
 * which decides what to tell an operator about a search bought days ago. Importing
 * the miner for it would drag the whole job-handler registration into the web
 * process, and copying it is how a page comes to disagree with the worker -- the
 * Mining page read "not PENDING" as "the provider answered", which turned our own
 * budget refusing to buy a search into a search whose results were ingested.
 */

/**
 * Why a provider came back with what it came back with.
 *
 * An adapter used to answer with an array, and every failure -- no credential, a
 * 401, a timeout, a task still sitting in the provider's queue, an exhausted budget
 * -- answered with an empty one. The orchestrator counted that as "the provider was
 * asked and found nothing", which is the exact lie the job outcome field was built
 * to stop, reintroduced one layer further down. A provider that could not answer
 * must not be indistinguishable from a market with no businesses in it.
 */
export type DiscoveryStatus =
  /** The provider answered and the answer contained businesses. */
  | 'OK'
  /** The provider answered, and this market genuinely has nothing usable in it. */
  | 'ZERO_RESULTS'
  /** No credential, or the adapter is switched off. */
  | 'NOT_CONFIGURED'
  /** Credentialed, but the source governance review is not signed. */
  | 'GOVERNANCE_BLOCKED'
  /** The provider rejected the credential: 401 or 403. Retrying only spends money. */
  | 'CREDENTIALS_INVALID'
  /** The provider asked us to slow down. */
  | 'RATE_LIMITED'
  /** The provider did not answer in time. */
  | 'TIMEOUT'
  /** The provider is failing: 5xx, or the socket went away. */
  | 'OUTAGE'
  /** Our own ceiling stopped the call before the money was spent. */
  | 'BUDGET_EXHAUSTED'
  /** An asynchronous task was accepted and its results are not ready yet. */
  | 'PENDING'
  /** The provider answered with something this adapter cannot read. */
  | 'MALFORMED'
  /**
   * The saved market was switched off before this search was submitted, so nothing
   * new was bought. Deliberately not `ZERO_RESULTS`: nobody looked. Deliberately not
   * a failure either -- it is our own decision, like `BUDGET_EXHAUSTED`.
   */
  | 'MARKET_DISABLED'
  /**
   * A confirmed search authorised as "collect the task you already paid for", whose
   * task had already been collected by the time this run reached it.
   *
   * Nothing is owed and nothing is bought: the search the operator approved has
   * already happened and its results are already in inventory. Not a failure, and
   * emphatically not a licence to buy a replacement.
   */
  | 'ALREADY_FULFILLED'
  /**
   * A confirmed search whose approved task can no longer be collected, because it
   * failed, was abandoned, or is gone.
   *
   * The authorisation was to collect one specific task, not to buy a search of this
   * market, so this run cannot honour it and does not substitute a purchase. A new
   * preview is the way to buy it again.
   */
  | 'PLAN_UNFULFILLABLE';

/** The statuses that mean the provider actually answered the question we asked. */
export function providerAnswered(status: DiscoveryStatus): boolean {
  return status === 'OK' || status === 'ZERO_RESULTS';
}
