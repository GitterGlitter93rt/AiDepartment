# voice-core

The Twilio ConversationRelay transport, shared by the inbound receptionist and by
Production Outbound Sales. It carries words to a caller and reports what the caller
said back. It decides nothing about what to say.

Ported selectively from the deployed receptionist at
`feature/twilio-ai-phone-agent` **2ad644946131ec158fbb89cac80aa9a18498c410**, per
`docs/09-software/outbound-sales-brain-voice-runtime-reuse-audit.md` §3 and
`outbound-sales-brain-shared-twilio-number-dual-service-spec.md` §4.

## Ported

| Module | Change on the way across |
|---|---|
| `twilio/signature.ts` | verbatim |
| `twilio/relay.ts` | verbatim |
| `twilio/twiml.ts` | verbatim, except `escapeXml` now comes from `twilio/xml.ts` instead of the transfer tool |
| `twilio/xml.ts` | just `escapeXml`, lifted out of `tools/transfer.ts` |
| `http/guards.ts` | verbatim |
| `http/paths.ts` | paths built from a prefix, so two services can share a hostname; `PATHS` still resolves to the receptionist's existing surface |
| `core/telemetry.ts` | verbatim, minus the mark that timed the demo line's split intro |
| `core/session.ts` | lifecycle and barge-in truncation kept; receptionist fields replaced by one consumer-owned `state` slot |
| `logger.ts` | verbatim, minus two demo-only event names |

## Deliberately not ported

- the receptionist system prompt and its intent hierarchy;
- the demo intro and its branded positioning;
- multi-industry demo routing and personas;
- the mock calendar and mock SMS tools;
- lead-intake questions and qualification rules;
- anything that decides what to say.

A test in `tests/voiceCore.test.ts` asserts none of that reappears in this package's
code.

## Not deployed

The deployed receptionist still runs its own copy at `2ad6449`. Nothing on the VPS
was changed, and no Twilio webhook points at anything here. Migrating the
receptionist onto this package is a later, separate step.
