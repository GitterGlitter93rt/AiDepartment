# Website & Growth Assessment — Architecture Checklist

Status: Working Gate

## Must Be Approved Before Production Build

### Scoring

- category definitions
- individual scoring rules
- category weights
- overall score formula
- score-band labels
- missing-evidence behavior
- confidence model

### Scanner

- crawl scope
- URL validation
- SSRF protections
- redirect behavior
- timeouts
- response-size limits
- rate limits
- user-agent
- robots.txt policy
- caching

### Performance

- provider
- API limits
- failure behavior
- performance-score mapping

### Questions

- final question set
- branching
- deterministic answer weights
- "not sure" handling

### Recommendations

- finding taxonomy
- severity model
- deterministic ranking
- service mapping
- wording guardrails

### Backend

- provider
- API architecture
- job model
- result persistence
- email delivery if any
- spam/abuse controls

### Privacy

- fields collected
- retention
- consent
- third-party processors
- privacy-policy updates

### Frontend

- intake UX
- progress state
- error states
- results design
- mobile behavior
- CTA hierarchy

## Current Gate

Frontend production implementation:

BLOCKED

until the above architecture is approved.
