# Your AI Department — Qualified Hot Transfer Specification

**Status:** Optional conversion path; not required for first pilot  
**Date:** 2026-09-03  
**Purpose:** Preserve momentum when a legitimately qualified prospect wants to speak now and Michael is explicitly available, without replacing the standard 15-minute Cal.com booking flow.

---

# 1. DEFAULT

Default next step remains:

**YAD 15-Minute AI Strategy Call via Cal.com / Cal Video.**

Hot transfer is optional and disabled until voice transfer reliability and operator availability are proven.

---

# 2. WHEN HOT TRANSFER MAY BE OFFERED

All should be true:

- Strategy Call Readiness = `BOOK_NOW`;
- prospect is interested and willing to continue now;
- Michael has enabled `accept_hot_transfers`;
- Michael/current designated closer is actually available under current presence/availability source;
- transfer route is healthy;
- current call transport supports transfer/conference cleanly;
- current policy permits.

Do not offer a hot transfer merely because calendar is open.

---

# 3. PROSPECT LANGUAGE

Example:

> Michael's actually available for a few minutes right now. If you'd rather handle it while we're already on the phone, I can see if he can jump on. Want me to connect you?

Do not say Michael is available unless presence/transfer system confirms it.

If prospect prefers scheduled meeting, use Cal.com.

---

# 4. MICHAEL ACCEPTANCE

Preferred flow:

1. prospect agrees;
2. AI requests transfer;
3. system alerts/calls Michael;
4. Michael receives concise whisper/context or portal card:
   - company;
   - prospect/role;
   - problem discussed;
   - key prospect statement;
   - reason for transfer;
5. Michael accepts;
6. bridge/conference completes;
7. AI may give one-sentence introduction then exit or remain only if designed/needed.

Do not dump a long summary while prospect waits silently.

---

# 5. IF MICHAEL DOES NOT ANSWER

Do not leave prospect hanging.

> Looks like I can't get him live right this second. I can grab you a 15-minute slot instead.

Then use Cal.com.

Do not claim Michael declined/ignored call unless known and appropriate.

---

# 6. TRANSFER TIMEOUT

Set a short bounded transfer attempt.

If no acceptance:

- return to AI quickly;
- offer scheduling;
- create internal note.

Do not create 20–30 seconds of unexplained dead air.

---

# 7. PRESENCE CONTROL

Admin control:

```text
Michael Hot Transfers
[OFF]
[AVAILABLE FOR NEXT 30 MIN]
[AVAILABLE UNTIL ...]
```

Do not infer availability solely from an empty Outlook calendar.

Calendar-free does not mean Michael wants a live phone interruption.

---

# 8. TRANSFER METRICS

Track:

- qualified hot transfer offered;
- accepted by prospect;
- Michael answered;
- bridge completed;
- transfer latency;
- fallback to Cal.com;
- opportunity outcome.

---

# 9. CORE RULE

**Use a hot transfer only when it removes friction for an already-qualified prospect. Never turn Michael's phone into the default destination for every connected cold call.**
