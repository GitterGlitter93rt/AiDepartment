# Website & Growth Assessment — Security Threat Model (V1)

Status: Architecture Draft — Pending Owner Approval
Extends `scanner-security-architecture.md`. This document is the exhaustive, structured threat-by-threat specification required before any implementation.

## 0. Core Principle

Every submitted URL, every DNS response, every redirect target, and every byte of remote HTML/response content is **untrusted input**, without exception, for the lifetime of the request. No mitigation below is optional for V1.

## 1. Threat Table

Format: Threat → Risk → Attack Example → Required Mitigation → Verification/Test.

### 1.1 SSRF (Server-Side Request Forgery)

- **Risk:** Scanner used to make requests to internal infrastructure on the operator's behalf.
- **Attack example:** User submits `http://169.254.169.254/latest/meta-data/` or a domain whose DNS resolves to an internal IP.
- **Mitigation:** Resolve DNS before fetch; validate every resolved IP against the blocklist in §2 before connecting; re-validate after every redirect (§3); never fetch an IP literal directly without the same validation.
- **Verification/test:** Automated test suite submits each blocked-range representative address (see `implementation-plan.md` Testing Standard) and asserts rejection before any socket is opened.

### 1.2 DNS Rebinding

- **Risk:** DNS resolves to a public IP at validation time, then to a private IP at connection time (classic TOCTOU).
- **Attack example:** Attacker-controlled DNS returns a public IP with a very short TTL, passes validation, then returns `127.0.0.1` on the actual connection.
- **Mitigation:** The application must connect using the same resolved IP address that was validated, not re-resolve the hostname at connect time — resolve, validate the IP, then connect directly to that validated IP (preserving the original `Host` header/TLS SNI for correctness). If the HTTP client library cannot pin the connection to a pre-validated IP, this is a blocking implementation requirement, not an optional hardening step.
- **Verification/test:** Test with a DNS name that returns different IPs on sequential lookups (simulated rebinding); assert the fetch either uses the originally-validated IP or fails closed.

### 1.3 Redirects to Private IPs

- **Risk:** Initial URL is public/valid; a redirect (3xx) points to a private address.
- **Attack example:** `https://attacker.com/redirect` returns `302 Location: http://10.0.0.5/`.
- **Mitigation:** Every redirect target undergoes the full URL + DNS + IP validation pipeline (§2) before being followed, identically to the original URL. No redirect is ever followed without re-validation.
- **Verification/test:** Mock server issues a redirect to each blocked range; assert the chain is aborted.

### 1.4 Redirects to Localhost

- **Risk:** Subset of 1.3; explicit because `localhost` may resolve differently across environments.
- **Mitigation:** `localhost`, `127.0.0.1`, `::1`, and any hostname resolving to loopback are blocked identically at every hop.
- **Verification/test:** Redirect chain ending in `http://localhost/` is rejected.

### 1.5 IPv4 Private Ranges

- **Risk:** Access to internal network segments.
- **Blocked ranges:** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8` (loopback), `169.254.0.0/16` (link-local), `0.0.0.0/8`, `100.64.0.0/10` (shared/CGNAT), `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved).
- **Mitigation:** Explicit allowlist-by-exclusion — an IP is permitted only if it is not in any listed range, rather than trying to enumerate all "public" ranges.
- **Verification/test:** One representative address per range, asserted blocked.

### 1.6 IPv6 Private/Local Equivalents

- **Risk:** Same class of risk as 1.5, in IPv6.
- **Blocked ranges:** `::1/128` (loopback), `fe80::/10` (link-local), `fc00::/7` (unique local), `::ffff:0:0/96` (IPv4-mapped — must unwrap and re-validate the embedded IPv4 address against §1.5), `2001:db8::/32` (documentation), `ff00::/8` (multicast), `::/128`, `100::/64` (discard-only).
- **Mitigation:** Same allowlist-by-exclusion approach as §1.5, plus explicit unwrapping of IPv4-mapped IPv6 addresses before range-checking.
- **Verification/test:** Representative address per range, including an IPv4-mapped address specifically to verify the unwrap logic.

### 1.7 Link-Local Addresses

- Covered by §1.5 (`169.254.0.0/16`) and §1.6 (`fe80::/10`). Listed separately to confirm both stacks are explicitly covered, not merged into a single incomplete check.

### 1.8 Loopback

- Covered by §1.4/§1.5/§1.6. Confirmed as its own line item because loopback is the single most common SSRF target and must never depend solely on hostname-string matching (`"localhost"`) — IP-level validation is mandatory even when the hostname does not literally say "localhost."

### 1.9 Multicast

- Covered by §1.5 (`224.0.0.0/4`) and §1.6 (`ff00::/8`). Attempting to use the scanner to probe multicast-reachable services is blocked by the same range check.

### 1.10 Reserved Ranges

- Covered by §1.5/§1.6. Implementation must use a maintained library/table for special-purpose IANA registries rather than a hand-rolled, one-time list, so new reservations can be incorporated over time (`implementation-plan.md` Phase A).

### 1.11 Cloud Metadata Services

- **Risk:** Access to cloud-provider metadata endpoints exposes credentials/instance data.
- **Blocked addresses (explicit, in addition to range blocks):** `169.254.169.254` (AWS/GCP/Azure/DigitalOcean/most providers), `fd00:ec2::254` (AWS IPv6 metadata), `169.254.170.2` (AWS ECS task metadata), `metadata.google.internal` (must resolve and IP-check, not hostname-string-match).
- **Mitigation:** Explicit test cases for these exact addresses in addition to the general range blocks, since this is the highest-value SSRF target and deserves defense-in-depth beyond "it happens to be in the link-local range."
- **Verification/test:** Direct submission of `http://169.254.169.254/` and hostname variants must be rejected pre-connection.

### 1.12 Malformed URLs

- **Risk:** Parser confusion or injection.
- **Attack example:** URLs with embedded control characters, homograph characters in the host, or ambiguous authority components (`http://a@b@c/`).
- **Mitigation:** Use a strict, spec-compliant URL parser (WHATWG URL standard). Reject any URL the parser flags as invalid or that fails to round-trip predictably. Reject hosts with Unicode that does not match a standard ASCII or IDNA-encoded form.
- **Verification/test:** Fuzz a set of known-malformed URL patterns; assert clean rejection, not a crash or silent partial-parse.

### 1.13 Embedded Credentials in URLs

- **Risk:** `http://user:pass@host/` — credential leakage, or smuggling a different intended host past casual parsing (`http://trusted.com@evil.com/`).
- **Mitigation:** Reject any submitted or redirect-target URL containing a userinfo component outright. Do not attempt to "strip and continue."
- **Verification/test:** Submit `http://user:pass@example.com/`; assert rejection, not silent stripping.

### 1.14 Unsupported Protocols / Non-HTTP Protocols

- **Risk:** `file://`, `ftp://`, `gopher://`, `dict://`, custom schemes used for SSRF pivoting against internal services expecting non-HTTP protocols.
- **Mitigation:** Allowlist exactly `http` and `https`. Reject everything else, including scheme-confusion attempts (`javascript:`, `data:`, `blob:`).
- **Verification/test:** One rejection test per listed scheme.

### 1.15 Arbitrary Ports

- **Risk:** Port-scanning internal services via arbitrary ports.
- **Mitigation:** V1 restricts fetches to standard ports only: `80` and `443` (and their implied defaults). Reject any explicit non-standard port in the submitted URL or any redirect target.
- **Verification/test:** Submit `http://example.com:8080/`; assert rejection.

### 1.16 Oversized Responses

- **Risk:** Memory exhaustion / cost abuse via extremely large response bodies.
- **Mitigation:** Enforce the 5 MB streaming cap from `crawl-specification.md` §17 — check `Content-Length` if present and reject upfront if it exceeds the cap; regardless of header, abort the stream the moment actual bytes received exceed the cap.
- **Verification/test:** Mock server sends a response with no `Content-Length` that exceeds 5 MB; assert the fetch aborts at the cap.

### 1.17 Decompression Bombs

- **Risk:** Small compressed response expands to huge decompressed size.
- **Mitigation:** Apply the 5 MB cap to the decompressed byte stream, enforced during decompression, never by trusting the compressed transfer size alone.
- **Verification/test:** Serve a gzip response with small compressed size that decompresses beyond 5 MB; assert abort during decompression.

### 1.18 Malicious HTML

- **Risk:** Crafted HTML exploiting a parser vulnerability or reflected unsafely elsewhere.
- **Mitigation:** Use a hardened, well-maintained HTML parser for extraction only (title, meta, headings, links, forms, etc.). Never render fetched HTML in a browser context (§1.19). Never reflect raw fetched HTML into the results page — only extracted, sanitized field values are ever displayed.
- **Verification/test:** Feed a corpus of malformed/malicious HTML samples through the parser in isolation; assert no crash and no unescaped output reaches the results page.

### 1.19 Script Execution

- **Risk:** Executing arbitrary remote JavaScript inside the scanning infrastructure.
- **Mitigation:** V1 does not execute any JavaScript from the fetched page — HTTP-fetch + static-HTML-parse only, per `scanner-security-architecture.md` §"Script Execution." A future rendered-DOM analysis would require an isolated, separately-approved hardened browser service — out of scope for V1.
- **Verification/test:** Architecture review confirms no headless-browser dependency in the V1 scanner path.

### 1.20 Iframe/Object/Embed Behavior

- **Risk:** Fetched pages may reference iframes/objects/embeds pointing to further untrusted content.
- **Mitigation:** V1 extraction does not follow or fetch the `src` of `<iframe>`, `<object>`, or `<embed>`. They may be noted as present (e.g., a chat-widget iframe pattern for AI-03) via markup inspection only, never fetched.
- **Verification/test:** Confirm extraction logic has no code path issuing a network request for these element types.

### 1.21 Malicious Files / Automatic Downloads

- **Risk:** Linked files could be malware or exhaust storage/bandwidth.
- **Mitigation:** File-extension exclusion list (`crawl-specification.md` §10) applied before fetch; no file is ever downloaded or stored.
- **Verification/test:** Confirm a linked `.exe`/`.zip` is skipped without a network request.

### 1.22 XML Edge Cases

- **Risk:** XXE or billion-laughs-style expansion via sitemap XML parsing.
- **Mitigation:** Sitemap XML parsing must use a parser with external entity resolution disabled and entity expansion limits enforced. Applies to `sitemap.xml` and one level of sitemap-index children (`crawl-specification.md` §12).
- **Verification/test:** Feed a billion-laughs and an XXE-attempt sitemap payload; assert safe rejection/bounded parsing.

### 1.23 Redirect Loops

- Covered in `crawl-specification.md` §7 (loop detection before hitting the numeric limit). An unbounded redirect loop is a resource-exhaustion vector if not detected explicitly.

### 1.24 Excessive Crawl Depth / Excessive Page Counts

- Covered by `crawl-specification.md` §8–§9 (8 pages, depth 2). Without a hard cap, a pathological site could cause unbounded work per submission.

### 1.25 Repeated Submissions

- **Risk:** Same URL submitted repeatedly to waste resources.
- **Mitigation:** 24-hour result cache (`crawl-specification.md` §17) returns cached results rather than re-scanning. Combined with rate limiting (§1.27).
- **Verification/test:** Submit the same URL twice within 24 hours; assert the second request does not trigger a new crawl.

### 1.26 Bot Abuse / Denial of Service

- **Risk:** Automated mass submission to exhaust capacity or run up performance-provider API costs.
- **Mitigation:** Per-IP rate limits, per-email limits, global concurrency cap, and a CAPTCHA-or-equivalent consideration at the intake layer (see §4 Unresolved Decisions).
- **Verification/test:** Load-test exceeding the configured rate limit; assert requests beyond the limit are rejected clearly, not queued indefinitely.

### 1.27 Rate Limiting

- **V1 recommended values (pending owner approval):** 5 submissions per IP per hour; 3 submissions per email address per 24 hours; global concurrency cap of 10 simultaneous analysis jobs. Starting values, not empirically tuned.

### 1.28 IP Reputation Considerations

- **Unresolved for V1:** whether to integrate a third-party IP-reputation/abuse-scoring service. Not blocking V1 launch since rate limiting + caching provide baseline protection.

### 1.29 Denial of Service (Outbound)

- **Risk:** The scanner becomes a tool to direct traffic at a third-party site.
- **Mitigation:** Bounded page count (8), concurrency (2), and 24-hour cache inherently limit outbound traffic any submission can generate. No mechanism allows a user to trigger unbounded repeated fetches of a third-party site.

### 1.30 Open-Proxy Behavior

- **Risk:** The scanner could be misused as a general-purpose URL-fetching proxy if it returns raw fetched content.
- **Mitigation:** The scanner never returns raw fetched bytes to the caller — only extracted, structured, deterministic findings. No code path echoes arbitrary remote content back to the submitter.

### 1.31 DNS Failures

- **Risk:** Non-resolving or slow-resolving hostnames could hang requests.
- **Mitigation:** DNS resolution is subject to the connection timeout (5s). A DNS failure is a page-fetch failure, never a security bypass.

### 1.32 Timeout Abuse

- **Risk:** A target server deliberately drips data slowly (slow-loris-style) against the scanner.
- **Mitigation:** Connect (5s) and read (10s) timeouts apply per-page; the 60s total-analysis timeout is a hard ceiling regardless of per-page behavior.

### 1.33 Data Leakage

- **Risk:** Sensitive information about the scanning infrastructure leaking to the target site or logs.
- **Mitigation:** Distinct, honest User-Agent rather than spoofing a browser. No internal infrastructure identifiers, credentials, or environment details in outbound requests or user-facing error messages (§1.36).

### 1.34 Secret Leakage

- **Risk:** API keys (e.g., performance-provider key) exposed in logs, error messages, or client-visible responses.
- **Mitigation:** Secrets never appear in frontend code or client-visible API responses. Backend logging redacts known secret patterns before persisting logs.

### 1.35 Sensitive Logs

- **Risk:** Logging full request/response bodies could capture PII or sensitive third-party content unnecessarily.
- **Mitigation:** Do not log full request bodies containing personal information unless operationally necessary and protected. Log structured metadata (status codes, timings, rule outcomes) rather than raw bodies by default.

### 1.36 Error-Message Leakage

- **Risk:** Verbose internal error messages (stack traces, internal hostnames) exposed to the end user.
- **Mitigation:** User-facing error states are limited to a closed set (`crawl-specification.md` §18 / `results-contract.md`) — never raw exception text or internal identifiers.

### 1.37 Storing Submitted URLs / Storing Analysis Output

- **Risk:** Indefinite retention without a defined purpose or retention policy.
- **Mitigation:** Governed by `data-model.md` (per-field retention classification) and must align with the Privacy Policy. No field is retained "because it can be" — every stored field must have a stated purpose.

## 2. URL Validation Requirements (Pre-Every-Network-Request)

Before any network request (initial fetch, every redirect hop, robots.txt, sitemap.xml):

1. Parse with a strict WHATWG-compliant URL parser. Reject on parse failure.
2. Scheme must be exactly `http` or `https`. Reject otherwise (§1.14).
3. No userinfo component. Reject otherwise (§1.13).
4. Port must be the default for the scheme, or absent. Reject explicit non-standard ports (§1.15).
5. Resolve the hostname via DNS. If resolution fails, treat as fetch failure (§1.31), not a security event.
6. For every resolved IP address (a hostname may resolve to multiple), check against the full blocklist in §1.5/§1.6/§1.11. If any resolved IP is blocked, reject the entire request — do not attempt to connect to "the other" IP if multiple were returned and at least one is blocked.
7. Only after all of the above pass does the connection occur, and it must connect to the specific validated IP (§1.2 rebinding pinning), not re-resolve.

## 3. Destination-IP Validation After Redirects

Every redirect response (3xx) triggers the full §2 pipeline again on the `Location` target, with no shortcuts. A hostname validated once is not "trusted" for subsequent requests in the same chain — each hop is validated independently, specifically to defend against DNS rebinding between the original validation and a later redirect (§1.2).

## 4. Unresolved Decisions

| Decision | Options | Recommendation | Approval Needed |
|---|---|---|---|
| CAPTCHA or equivalent on intake form | None / hCaptcha / Turnstile / honeypot-only | Lean toward Cloudflare Turnstile if Cloudflare Workers is the backend (see `backend-options.md`) | Owner |
| IP-reputation third-party service | None / integrate a service | Do not integrate for V1 — rate limiting + caching sufficient initially | Owner |
| Non-standard port support (§1.15) | Stay at 80/443 only / allow approved ports later | Stay at 80/443 for V1 | Owner |
| Exact rate-limit numeric values (§1.27) | As proposed / adjusted | Use proposed values as a starting point, revisit after real usage data | Owner |
