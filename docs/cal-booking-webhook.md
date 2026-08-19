# Cal.com Booking Webhook — Recommended Architecture (Not Yet Implemented)

## Status: not implemented in this repository

This project's production website is a fully static Astro build
(`output: 'static'` in `astro.config.mjs`, no adapter installed, no
`src/pages/api/` directory, no `functions/`, no `wrangler.toml`,
`netlify.toml`, or `vercel.json`). Deployment is conventional static
hosting (SiteGround). There is no server or serverless runtime in this
project capable of securely receiving and verifying a webhook today.

Per the Sprint 12.5 instructions, this document exists specifically
**because** a real webhook cannot be safely implemented inside a static
site — a webhook secret can never live in client-side JavaScript, and
signature verification cannot happen in the browser. This is the
recommended path to add real server-side booking confirmation, without
pretending it already exists.

Until this is built, the site relies on the **browser-side
`booking_confirmed` event** (`/booking-confirmed/`, see that page's
source) as a behavioral signal only — not a server-verified record of
an actual booking. See that page's comments for the explicit
distinction.

---

## 1. Recommended serverless architecture

**Cloudflare Workers** is the recommended option, for two reasons
specific to this project:

- It requires no change to the existing static-hosting deployment model
  for the website itself — the Worker is a separate, independently
  deployed service that only needs to *exist somewhere reachable*, not
  bundled into the Astro build.
- It's the lowest-friction serverless option that supports Web Crypto
  (`crypto.subtle`) natively, which is what HMAC-SHA-256 signature
  verification requires.

Netlify Functions or Vercel Functions would also work if this project
is ever migrated onto either of those platforms as its primary host,
but neither is currently in use, so recommending them today would mean
introducing a new hosting dependency purely for this one webhook. A
standalone Cloudflare Worker avoids that.

**This recommendation is not a claim that Cloudflare is already used by
this project elsewhere.** If Cloudflare is already the DNS/CDN layer in
front of `youraidepartment.ai` (as referenced in earlier sprint SEO
work regarding www-redirects and HSTS), a Worker is a natural fit
alongside that existing usage. If Cloudflare is not in use at all, any
equivalent platform with Web Crypto support and environment-variable
secret storage is acceptable — the design below does not depend on any
Cloudflare-specific feature beyond the Worker runtime and its
environment/secret bindings.

## 2. Webhook route

```
POST https://<your-worker-subdomain>.workers.dev/cal-webhook
```
or, if mapped to a custom route on the same domain:
```
POST https://youraidepartment.ai/api/cal-webhook
```
(the latter requires a Cloudflare Worker route binding on the zone —
document this as a manual Cloudflare dashboard step, not something
this repository configures).

## 3. Environment variable

```
CAL_WEBHOOK_SECRET
```

Set via the Worker's encrypted environment variable / secret binding
(`wrangler secret put CAL_WEBHOOK_SECRET` or the Cloudflare dashboard's
Worker → Settings → Variables → encrypted). **Never** commit this value
to source control, never place it in any client-side script, and never
print it in logs.

Generate it with a cryptographically random value, e.g.:
```
openssl rand -hex 32
```
Store the same value in Cal.com's webhook configuration (Cal.com →
Settings → Developer → Webhooks → the webhook's "Secret" field) and in
the Worker's `CAL_WEBHOOK_SECRET` variable. They must match exactly.

## 4. HMAC verification algorithm

Cal.com signs the raw request body and sends the signature in the
`x-cal-signature-256` header. Verification (pseudocode, using Web
Crypto — available natively in Cloudflare Workers):

```js
async function verifyCalSignature(rawBody, signatureHeader, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  // Timing-safe comparison. Web Crypto doesn't expose a built-in
  // constant-time string compare, so compare fixed-length byte arrays
  // rather than using `===` on hex strings, which can short-circuit.
  const a = new TextEncoder().encode(computedHex);
  const b = new TextEncoder().encode(signatureHeader || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
```

Critical ordering requirement: **read and verify the raw request body
before parsing it as JSON.** Parsing first and re-serializing for
verification is not equivalent — whitespace/key-order differences would
break signature verification, and more importantly, it creates a path
where malformed/malicious JSON gets parsed before authenticity is
established. Verify raw bytes first; only call `JSON.parse()` after the
signature check passes.

## 5. Required events

Subscribe to, at minimum:

- `BOOKING_CREATED` (required from day one — this is the actual
  "someone booked" signal)
- `BOOKING_RESCHEDULED`
- `BOOKING_CANCELLED`
- `BOOKING_NO_SHOW_UPDATED`

Each payload includes a `triggerEvent` field identifying which of these
fired, and a `payload.uid` identifying the booking. Validate both
before doing anything else:

```js
const ALLOWED_EVENTS = ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'BOOKING_NO_SHOW_UPDATED'];
if (!ALLOWED_EVENTS.includes(body.triggerEvent)) return new Response('Ignored', { status: 200 });
if (!body.payload?.uid || typeof body.payload.uid !== 'string') return new Response('Bad Request', { status: 400 });
```

Return a 2xx quickly for events you recognize but don't specifically
act on (Cal.com may retry on non-2xx responses) — that's what the
`return new Response('Ignored', { status: 200 })` above is for.

## 6. Idempotency design

**Idempotency key: `${triggerEvent}:${payload.uid}`.**

Cal.com (like most webhook providers) may retry delivery on timeout or
non-2xx responses, and the same logical event can arrive more than
once. Before creating or updating any stored record, check whether this
exact `triggerEvent + uid` combination has already been processed:

```js
const idempotencyKey = `${body.triggerEvent}:${body.payload.uid}`;
const alreadyProcessed = await storage.get(idempotencyKey); // see §7
if (alreadyProcessed) return new Response('OK (duplicate)', { status: 200 });
```

`BOOKING_CREATED` and a later `BOOKING_RESCHEDULED` for the *same*
booking UID are different idempotency keys (different `triggerEvent`),
which is correct — a reschedule should update the booking's state, not
be silently treated as a duplicate create. A retried delivery of the
*same* `BOOKING_CREATED` for the *same* UID, however, must be a no-op.

## 7. Durable storage — not yet chosen, do not invent one

This repository has no existing database, KV store, or other durable
storage. **Do not silently invent one.** The webhook's idempotency
check and any future offline-conversion reporting require some
persistence layer; the two most natural options given the recommended
Cloudflare Worker are:

- **Cloudflare KV** — simplest option; a key-value store with a
  generous free tier, sufficient for idempotency-key tracking and
  storing a lightweight booking record (uid, trigger event, timestamp,
  booking type, gclid/UTMs if present). Not a relational database — fine
  for this use case.
- **Cloudflare D1** — if querying/reporting across bookings becomes a
  real requirement (e.g. building a dashboard of booked-call
  conversions), a proper SQL database would be more appropriate than
  KV. Worth choosing D1 from the start if that reporting need is already
  anticipated, since migrating later is extra work.

This choice should be made deliberately when the webhook is actually
built, not assumed here. Whichever is chosen, the schema/keys needed at
minimum are described in §8 below.

## 8. Fields to retain vs. never retain/log

**Retain** (needed for idempotency and future offline-conversion
reporting):
- `booking_uid`
- `trigger_event`
- `booking_type` (if forwarded/derivable — see the site's
  `booking_type` query parameter convention used on
  `/booking-confirmed/`)
- `event_timestamp` (when Cal.com's payload says the event occurred)
- `processed_at` (when the webhook handler processed it)
- `gclid` / `gbraid` / `wbraid`, campaign/ad-group attribution, and
  `lead_id` — **only if Cal.com's custom hidden booking-question fields
  were actually filled in for that booking** (see the Cal.com manual
  configuration section of the Sprint 12.5 report). These are what
  would eventually let a booking be matched back to the ad click that
  produced it for offline-conversion upload.
- Booking status (created / rescheduled / cancelled / no-show)

**Never retain or log:**
- Attendee email
- Attendee phone number
- Attendee name
- Free-text booking notes / meeting description
- Any other field from the Cal.com payload not explicitly listed above

If the eventual implementation needs to correlate a booking with a
contact-form lead, use the non-PII `lead_id` (see
`src/lib/attribution.ts`) and/or the Google click IDs — never the
attendee's personal details.

## 9. Deployment steps (once actually built)

1. `npm create cloudflare@latest` (or `wrangler init`) in a **separate**
   repository/directory from this website's source — the Worker is
   independently deployed and does not need to live inside this Astro
   project.
2. Implement the handler per §4–§8 above.
3. `wrangler secret put CAL_WEBHOOK_SECRET` (paste the same secret
   configured in Cal.com).
4. Provision the chosen storage (`wrangler kv:namespace create ...` for
   KV, or `wrangler d1 create ...` for D1) and bind it in
   `wrangler.toml`.
5. `wrangler deploy`.
6. Configure the Cal.com webhook subscriber URL to point at the
   deployed Worker's URL (see §10).
7. Test using §11's procedure before considering this live.

## 10. Cal.com subscriber URL configuration

In Cal.com → Settings → Developer → Webhooks → Add Webhook:

- **Subscriber URL:** the deployed Worker's URL (from §9 step 5/6)
- **Secret:** the same value stored in `CAL_WEBHOOK_SECRET`
- **Event triggers:** `BOOKING_CREATED`, `BOOKING_RESCHEDULED`,
  `BOOKING_CANCELLED`, `BOOKING_NO_SHOW_UPDATED`
- **Payload template:** default (do not customize the payload shape
  unless the handler is written to expect a customized shape)

## 11. Test procedure

1. Cal.com's webhook settings page includes a "Test" / "Ping" action
   that sends a sample payload — use this first to confirm the Worker
   receives requests and responds 2xx before testing with real
   bookings.
2. Make a real test booking through one of the four event types.
   Confirm:
   - the Worker receives a `BOOKING_CREATED` event
   - signature verification passes (log a boolean success/failure — not
     the signature or secret itself — during initial testing, then
     remove even that once confirmed working)
   - the idempotency key gets stored
   - no PII fields appear in whatever storage/logs the Worker writes to
3. Manually trigger Cal.com's retry behavior if possible (or resend the
   same test payload via curl with a valid signature) and confirm the
   second delivery is correctly treated as a duplicate (§6).
4. Test a reschedule and a cancellation on the same test booking; confirm
   each produces the expected state transition, not a fresh duplicate
   "booked" record.
5. Test with a deliberately invalid signature (wrong secret) and confirm
   the Worker rejects it (non-2xx or an explicit rejection response)
   rather than processing the payload.

## 12. Feeding future offline-conversion / qualified-lead reporting

Once bookings are durably stored with their attribution fields (§8),
the eventual (not-yet-built) reporting pipeline would:

1. Query stored bookings where `trigger_event = 'BOOKING_CREATED'` and a
   `gclid` (or `gbraid`/`wbraid`) is present.
2. Format those as offline conversion records per Google Ads' Enhanced
   Conversions for Leads / offline conversion import format (this
   requires Google Ads API credentials and is explicitly out of scope
   until those credentials legitimately exist — see the Sprint 12.5
   report's note on Enhanced Conversions readiness).
3. Upload on a recurring schedule (a separate scheduled Worker /
   cron trigger, not part of the webhook handler itself).

None of step 2 or 3 exists yet. This document only describes the
webhook and storage layer that would need to exist first, so that data
becomes available to feed that pipeline later.
