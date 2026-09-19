/**
 * The relay session, from voice-core.
 *
 * The inbound service uses exactly the same transport as the outbound one -- turn
 * ordering, barge-in truncation, the end-once guard -- because the difference
 * between a cold call and a callback is the producer and the persona, not the
 * machinery that carries the words.
 */
export {
  createRelaySession as createInboundRelaySession,
  HOLDING_LINE_AFTER_MS,
  type RelaySessionState as InboundRelayState,
  type Socket,
  type TurnProducer,
} from '../../voice-core/src/core/relaySession.ts';
