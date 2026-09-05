/**
 * The relay session lives in voice-core.
 *
 * It is pure transport -- turn ordering, barge-in truncation, the holding line, the
 * end-once guard -- and the inbound service needs exactly the same machinery. Two
 * copies of it would drift, and the half that drifted would be the one nobody was
 * looking at. This module keeps the outbound names so nothing that already imports
 * them has to change.
 */
export {
  createRelaySession as createSalesRelaySession,
  HOLDING_LINE_AFTER_MS,
  type RelaySessionState as SalesRelayState,
  type Socket,
  type TurnProducer,
} from '../../voice-core/src/core/relaySession.ts';
