// The service's public HTTP/WS surface, in one place.
//
// Ported from services/ai-phone-agent at 2ad6449, where the comment records a real
// outage: the derived relay URL said /relay while the socket listened on
// /twilio/conversation, so Twilio would have dialled a path that does not exist and
// every call would drop on connect.
//
// Changed on the way across: the paths are built from a prefix rather than fixed, so
// inbound and outbound can run as separate services behind one hostname without
// either one guessing the other's routes.

export interface VoicePaths {
  health: string;
  incoming: string;
  status: string;
  relay: string;
  relayAction: string;
}

/**
 * @param prefix mounted under this path, e.g. '' for the receptionist's existing
 *   surface or '/outbound' for Production Outbound Sales.
 */
export function voicePaths(prefix = ''): VoicePaths {
  const base = prefix.replace(/\/+$/, '');
  return {
    health: `${base}/health`,
    incoming: `${base}/twilio/incoming`,
    status: `${base}/twilio/status`,
    relay: `${base}/twilio/conversation`,
    /** Twilio POSTs here when the relay session ends, which is how a warm transfer
     * becomes an actual <Dial>. */
    relayAction: `${base}/twilio/relay-action`,
  };
}

/** The receptionist's existing surface, unchanged, so nothing deployed moves. */
export const PATHS = voicePaths('');

/** Derives the ConversationRelay WebSocket URL from the public base URL. */
export function relayUrlFor(publicBaseUrl: string, paths: VoicePaths): string {
  return publicBaseUrl.replace(/^http/i, 'ws').replace(/\/+$/, '') + paths.relay;
}
