# Claude Code Start Prompt — YAD Prospect Factory / Outbound Sales Brain

Copy/paste the prompt below into Claude Code on the EdgeXpert when implementation is ready to begin.

---

Read `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md` first. Treat it as the current architecture manifest if older index/handoff files have shorter document lists.

Then read the Gate 0 documents identified in `docs/09-software/outbound-sales-brain-gate-document-map.md`, plus the required project/source-of-truth files (`CLAUDE.md`, `brain/README.md`, `brain/TODO.md`, `brain/PHONE-AGENT.md`, `docs/00-company/launch-decisions.md`, and the relevant Sales Manual overview).

Execute **Gate 0 only** using `docs/09-software/outbound-sales-brain-gate0-audit-template.md`.

Your job in Gate 0 is to inspect the actual repository and EdgeXpert/server environment and report the implementation reality before writing substantial new code.

Audit:

1. the current `feature/outbound-sales-brain` branch and existing `phone-agent/` prototype;
2. the current Twilio/receptionist implementation;
3. the `voice.youraidepartment.ai` runtime/deployment, Nginx/TLS/WebSocket/service setup available from this environment;
4. existing persistence/database state;
5. current STT/TTS/LLM/model and prompt paths;
6. current callbacks/ConversationRelay/Media Stream/AMD behavior;
7. CRM/calendar/SMS/email integrations already present;
8. current local EdgeXpert development/test workflow;
9. security gaps in the prototype/runtime;
10. the likely source of the previously observed 3–5 second ordinary voice pauses if actual evidence supports a diagnosis.

Do **not** enable production dialing.

Do **not** call real prospects.

Do **not** submit fake customer forms/appointments.

Do **not** re-enable automatic GitHub Actions. The existing phone-agent CI must remain manual-only unless Michael explicitly changes that requirement.

Do **not** merge to `main`.

Do **not** commit secrets.

Do **not** spend money on external providers during Gate 0 except a tiny explicitly necessary diagnostic that cannot be performed with existing configuration/fake data; if such a request is genuinely required, explain it before doing it.

Treat the current `phone-agent/` code as an early prototype, not architecture authority. Recommend which pieces should be reused, refactored, quarantined, or replaced based on what you actually inspect.

For the implementation stack, recommend the simplest durable architecture compatible with the actual EdgeXpert environment and V1 specs. In particular, report your recommendation for:

- PostgreSQL access/query library and migration framework;
- durable job queue approach;
- package/module structure;
- local test setup with fake providers;
- how Market Miner can be developed/tested without GitHub Actions;
- how staging/test secrets and controlled Twilio allowlists should be separated from production.

Do not begin building Twilio/realtime voice features. The engineering order is Market Miner first, Human Assist second, then Sales Manual/roleplay/compliance, then realtime voice later.

Your Gate 0 deliverable must include:

- exact repository/runtime findings;
- current branch/HEAD;
- reusable-vs-replaceable code table;
- security/persistence gaps;
- deployment/voice architecture as it exists now;
- latency-path audit;
- proposed module/file structure for Gates 1–7;
- database/queue recommendation based on actual environment;
- exact local commands for install/typecheck/build/test/start DB/migrate/start API/start workers;
- credentials/integration readiness as yes/no only, never secret values;
- blockers separated into true blockers vs items that can use fake adapters;
- Gate 1–7 implementation sequence;
- final `GATE 0 PASS` or `GATE 0 BLOCKED` statement.

Stop after the Gate 0 report if there is any product-level conflict that requires Michael's decision. Otherwise report that Gate 1 can begin, but do not silently change scoring, offers, compliance policy, or sales doctrine.
