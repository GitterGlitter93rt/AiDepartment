# Design notes

Decisions worth knowing before changing this service.

## Why a separate service

The website is Astro `output: 'static'`, deployed as flat files to SiteGround behind Cloudflare. There is no server at runtime. A voice agent needs a persistent process holding a WebSocket for the duration of every call, so it cannot live inside that build. It sits in the same repo for shared history and review, and deploys independently.

The root `tsconfig.json` includes `**/*`, so `services` was added to its `exclude` — otherwise `npx astro check` would typecheck this service under Astro's browser-oriented config and fail. The service has its own tsconfig and its own test script.

## Why a heuristic in front of the LLM

An LLM round-trip costs roughly a second. On a phone call that second lands as silence right after the caller finishes their opening sentence, which is exactly where the illusion breaks. Most real callers open with something unmistakable, so the common path skips the model entirely.

It also makes routing testable. CI has no API key, and routing correctness is the product's core promise — a keyword table can be asserted on, a model call cannot.

The heuristic is not a fallback for the LLM; the LLM is the general case and the table is the fast path. Confidence is driven by the *margin* between industries rather than raw score, because overlapping vocabulary ("leak", "house", "roof") is the actual difficulty.

## Why routing is one-way

Once a specialist is loaded, `session.routed` stays true. Re-classifying every turn would make the agent switch persona mid-conversation when a divorce caller happens to mention their house. Ambiguity is resolved *before* committing, not continuously.

## Why sessions are keyed by CallSid

There is no module-level "current conversation" anywhere. Every piece of state hangs off `CallSid` in a `SessionStore`, so simultaneous calls cannot see each other — asserted directly in `tests/session-and-tools.test.ts`. For multi-instance deployment, swap the `Map` for Redis behind the same interface.

## Why `fetch` instead of the SDKs

One dependency (`ws`) instead of four. Every adapter is a small function that takes `fetchImpl`, so tests inject a stub and assert on the request without a network. Swapping in an official SDK later is a one-file change behind an unchanged interface.

## Why mocks fail safe

`MOCK_SMS_MODE=false` with no Twilio credentials keeps the mock on rather than attempting a live send. A half-configured deploy sends nothing instead of sending wrongly, and `/health` shows which mode is active.

## Compliance boundaries live in the prompts

Each specialist carries its own limits — no legal advice and no predicted outcomes for family law; no price quotes or claim-approval predictions for roofing; no home valuations or steering for real estate. They are in the industry modules rather than a shared rule because they are domain-specific, and a shared list would get diluted.

## Known limitations

- Contact and qualification capture is structured and populated by the tool layer, but the model is not yet asked to emit structured extractions each turn — the fields are steered conversationally. Extraction is the natural next step.
- Sessions are in-memory: a restart loses in-flight calls.
- No inbound webhook signature validation yet (see next phase).
