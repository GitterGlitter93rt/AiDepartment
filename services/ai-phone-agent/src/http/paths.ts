// The service's public HTTP/WS surface, in one place.
//
// Shared by config.ts (which derives the ConversationRelay URL) and
// server.ts (which routes on them). Duplicating these was a real bug:
// the derived relay URL said /relay while the socket listened on
// /twilio/conversation, so Twilio would have dialled a path that does
// not exist and every call would drop on connect.
export const PATHS = {
  health: '/health',
  incoming: '/twilio/incoming',
  status: '/twilio/status',
  relay: '/twilio/conversation',
} as const;
