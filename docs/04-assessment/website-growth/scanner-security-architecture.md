# Website & Growth Assessment — Scanner & Security Architecture

Status: Architecture Draft Authority

## Objective

Define a secure server-side website-analysis architecture suitable for evaluating public business websites.

The scanner must treat every submitted URL and every remote website as untrusted input.

## Proposed High-Level Architecture

Astro Website
→ Assessment Intake
→ Secure Analysis API
→ URL Validation
→ Controlled Fetcher
→ HTML / Metadata Analyzer
→ Approved Performance Provider
→ Deterministic Scoring Engine
→ Results Store
→ Results Page

The static Astro frontend must not directly fetch arbitrary user-supplied URLs from the browser.

## Server-Side Requirement

Website analysis requires a server-side or isolated execution layer.

Potential deployment options may include:

- Cloudflare Workers
- serverless functions
- dedicated API service

Provider selection remains TBD.

Do not select a provider during implementation unless architecture review approves it.

## URL Validation

Accept only:

- http
- https

Prefer upgrading http to https where appropriate.

Reject or block:

- file:
- ftp:
- data:
- javascript:
- localhost
- loopback addresses
- private IP ranges
- link-local ranges
- multicast
- reserved ranges
- cloud metadata IPs
- IPv6 local/private equivalents
- user-info URLs where inappropriate

## DNS / SSRF Protection

Resolve DNS before fetching.

Block destinations resolving to:

- 127.0.0.0/8
- 10.0.0.0/8
- 172.16.0.0/12
- 192.168.0.0/16
- 169.254.0.0/16
- IPv6 loopback
- IPv6 link-local
- IPv6 unique-local networks
- cloud metadata services
- other reserved/internal network ranges

Revalidate destination after redirects.

Do not trust DNS only once if redirect targets change.

## Redirect Controls

Limit redirects.

Every redirect destination must pass the same URL and IP validation rules.

Suggested maximum:

5 redirects

Exact limit may be adjusted during implementation.

## Fetch Controls

Use strict limits for:

- total response size
- connection timeout
- read timeout
- redirect count
- page count
- concurrent requests
- crawl depth

Do not crawl an entire website.

Initial V1 should inspect a limited set of public pages.

Potential V1 page set:

- homepage
- primary service pages discovered from navigation
- contact page
- selected high-value internal pages
- robots.txt
- sitemap.xml

Exact crawl strategy must be deterministic.

## Script Execution

Do not execute arbitrary third-party website JavaScript inside the core scanner.

Prefer HTTP retrieval and static parsing.

If browser rendering is later required, isolate it in a hardened browser service with separate security controls.

Do not use browser execution simply for convenience.

## HTML Handling

Treat HTML as untrusted.

Do not inject remote HTML into the Your AI Department page.

Parse only necessary elements.

Potential extraction targets:

- title
- meta tags
- headings
- links
- forms
- phone/email links
- structured data
- scripts by src/domain
- canonical
- robots
- visible CTA indicators where reliably detectable

## File Downloads

Do not automatically download linked files.

Avoid fetching:

- executables
- archives
- large media
- documents

unless explicitly approved for a later architecture.

## Rate Limits

Protect the service against abuse.

Potential controls:

- per-IP submission rate limits
- per-email submission limits
- per-domain cooldown
- global concurrency cap
- job timeout
- duplicate-request caching

Exact values should be defined during implementation.

## Domain Ownership

The free assessment does not require proving website ownership unless later required for abuse prevention.

The scanner analyzes only publicly available information.

Do not attempt authenticated access.

## Robots

Decide before implementation whether the V1 scanner will respect robots.txt for assessment crawling.

Document and implement the decision consistently.

Do not leave behavior ambiguous.

## Performance Testing

Use an approved external or server-side performance analysis method.

Potential options may include:

- PageSpeed Insights API
- Lighthouse in controlled infrastructure

Exact provider remains TBD.

Do not expose API keys in frontend code.

## Data Storage

Store only data necessary to produce the assessment and support legitimate business follow-up.

Potential fields:

- submitted URL
- company
- name
- email
- optional phone
- industry
- user answers
- analysis findings
- category scores
- overall score
- timestamps

Retention policy must align with the final Privacy Policy.

## Logging

Do not log unnecessary sensitive information.

Do not log full request bodies containing personal information unless operationally necessary and protected.

## Abuse / Safety

The system must not be usable as:

- a generic open proxy
- an internal network scanner
- a port scanner
- a file fetcher
- a DDoS tool
- a credential collection tool

## Error States

The system should distinguish:

- invalid URL
- blocked destination
- timeout
- website unavailable
- unsupported content
- analysis incomplete
- external performance provider unavailable

Do not convert technical failure into a low business score.

## Retry Behavior

Retries should be limited and controlled.

Do not repeatedly hammer unavailable websites.

## Implementation Gate

Production crawler implementation is blocked until:

- scoring matrix approved
- security architecture approved
- crawl scope approved
- performance provider selected
- backend provider selected
- rate limits defined
- privacy/data handling reviewed

