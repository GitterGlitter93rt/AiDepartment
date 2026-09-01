# Paid Audit Post-Payment Access — Architecture & Limitation

Status: Documented limitation + integration points (no automated access today)
Version: 1.0

---

# CURRENT FLOW

```
/comprehensive-ai-business-audit/
  -> "Book Your $495 Comprehensive AI Business Audit"
  -> Cal.com: https://cal.com/youraidepartment/comprehensive-ai-business-audit
  -> required $495 payment at booking (processed entirely by Cal.com)
  -> 45-minute strategy review session booked
  -> buyer receives (manually, from our team) instructions to complete
     the comprehensive 64-question assessment that powers the audit
  -> /ai-assessment/full/ is the underlying fulfillment engine
```

# THE GAP

There is no automated, secure handoff from "payment confirmed" to
"buyer gets access to the comprehensive assessment." This is a known,
deliberate gap — not an oversight to paper over.

# WHY SECURE VERIFICATION CANNOT RUN ON CURRENT HOSTING

This project builds to a fully static site (`output: 'static'`, no
adapter, no serverless functions, no `src/pages/api/`). Production
hosting is SiteGround static delivery. That means:

1. A Cal.com webhook (BOOKING_CREATED for the comprehensive-audit
   event) cannot be received or signature-verified anywhere in this
   deployment. There is no server runtime.
2. Any "verification" implemented in client-side JavaScript would
   expose the verification secret in the browser and would be
   bypassable by anyone reading the bundle. Forbidden.
3. Gating access with a guessable static query parameter (e.g.
   `/ai-assessment/full/?paid=1`) provides no security whatsoever —
   it is fake access control. Forbidden.

See `docs/cal-booking-webhook.md` for the full recommended
server-side webhook architecture (Cloudflare Worker with
HMAC-SHA-256 signature verification via Web Crypto, environment-bound
secrets, and a durable booking record). That document remains the
canonical implementation plan.

# WHAT IS TRUE TODAY

- Payment is real and secure — handled entirely by Cal.com at booking.
- Post-payment handoff is MANUAL: our team sends the buyer
  instructions to complete the comprehensive assessment after
  confirmed payment.
- `/ai-assessment/full/` remains reachable by direct URL but is
  deliberately noindex, excluded from the sitemap, and publicly
  unlinked. It is not advertised as free, and no page pretends it is
  access-controlled. Anyone reaching it finds a free diagnostic tool
  — a known, accepted posture until real access control exists.
- The booking-confirmed success page (`/booking-confirmed/`) accepts
  a `booking_type=comprehensive_audit` query parameter as a
  browser-side GA4 signal only (`booking_confirmed` event). This is a
  behavioral analytics signal, not payment verification, and the page
  says so in its own source comments.

# CLEAN INTEGRATION POINTS FOR FUTURE VERIFICATION

When the webhook worker from `docs/cal-booking-webhook.md` is built:

1. Worker receives `BOOKING_CREATED` for the
   `comprehensive-ai-business-audit` Cal.com event.
2. Worker verifies the HMAC-SHA-256 signature against the
   `CAL_WEBHOOK_SECRET` environment binding (never client-side).
3. Worker confirms the booking payload indicates completed required
   payment (Cal.com's payload for paid events includes payment
   status — verify against the live payload schema at build time).
4. Worker mints a short-lived, single-use, signed access token bound
   to the booking UID (HMAC with a server-held secret, TTL of days not
   months, single redemption recorded in the worker's durable store).
5. Worker emails/delivers the buyer a link of the form:
   `/ai-assessment/full/?token=<signed-token>` — the token being the
   ONLY thing that varies; no static parameter is ever accepted.
6. A small server-verified step (the same worker, or a build-time
   service) validates the token before serving anything privileged.
7. Only then may the site treat the comprehensive engine as a
   paid-access deliverable. Until every step above exists, the
   manual handoff remains the process of record.

# RULES THAT DO NOT CHANGE

- Do not fake payment verification client-side.
- Do not expose secrets in frontend code.
- Do not gate anything on a guessable static query parameter.
- Do not publicly advertise `/ai-assessment/full/`.
- Do not weaken or remove the manual handoff before the secure one
  exists.