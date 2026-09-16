# Current State — Your AI Department (website line)

Updated: 2026-09-16 (documentation audit; no code changed)

- **Repository:** `/home/roothecks/AiDepartment`
- **Remote:** `origin` → `https://github.com/GitterGlitter93rt/AiDepartment.git`
- **Branch:** `sprint17-local-authority-proof`
- **HEAD:** `9e4c4364ffe68564b44a7f95f27b36c3f198c1c3` — *polish(copy): say what we build, not what we lack* (2026-09-15)
- **Working tree:** one untracked directory, `design-system/` — unrelated to this audit and left alone
- **This branch:** 60 commits ahead of `origin/main`, branched at `648da9d` (2026-08-14)

> **Read this first.** This repository holds *two divergent lines of work* that
> have not been merged. See "The two lines" below before you touch anything.

---

## The two lines

`origin/main` (`d341e5d`) and the website sprint branches parted company on
2026-08-14 and neither has been merged into the other.

| | Website sprint line | Sales Brain line |
|---|---|---|
| Branches | `sprint13-*`, `sprint14-*`, `sprint15-*`, `sprint16-*`, **`sprint17-local-authority-proof`** | `feature/outbound-sales-brain`, `fix/dataforseo-standard-collector`, `feature/sales-brain-rep-enrichment`, `fix/sales-brain-*`, `offline-marathon-20260909` |
| Branched from | `648da9d`, 2026-08-14 | `f031ac7`, 2026-09-01 |
| Ahead of `origin/main` | 60 commits | 513 commits |
| Top-level tree | Astro site, `docs/`, `tests/` | the same **plus** `brain/`, `services/sales-brain`, `services/sales-voice`, `phone-agent/`, `AGENTS.md`, `.github/` |
| Checked out at | `/home/roothecks/AiDepartment` | `/home/roothecks/YAD-Sales-Brain*` (seven worktrees) |

Consequences a fresh agent must know:

- **`brain/` does not exist on this branch.** The operational brain — `brain/README.md`,
  `TODO.md`, `DECISIONS.md`, `PROJECT.md`, `WEBSITE.md`, `TRACKING.md` and the
  rest — lives on `origin/main` and on the Sales Brain line. `AGENTS.md`, which
  tells agents to read it, is likewise absent here. Read it with
  `git show origin/main:brain/TODO.md` rather than assuming there is none.
- **`services/` and `phone-agent/` do not exist on this branch either.** The
  Sales Brain application is real and substantial; it is simply on the other line.
- Merging the two lines is unfinished work nobody has written a plan for.

## Current state of this line

The Astro marketing site for **youraidepartment.ai**: 75 pages under
`src/pages/`, a deterministic assessment engine under `src/lib/assessment/`,
funnel and outbound landing layouts, and 20 test files under `tests/` that
assert routing, SEO, structured data, analytics taxonomy, attribution and A2P
compliance claims.

Sprint 17 is *local authority proof* — a locations architecture intended to
survive a doorway-page audit, with `tests/sprint17LocalAuthority.test.ts` and
`tests/seoQuality.test.ts` measuring the doorway risk rather than trusting a
reviewer.

## Recently completed work

| Commit | Date | Description |
|---|---|---|
| `9e4c436` | 2026-09-15 | Homepage copy: say what we build, not what we lack |
| `a11bd95` | 2026-09-15 | Write down the location rules before they get rediscovered |
| `9527d3c` | 2026-09-15 | Measure the doorway risk instead of trusting the reviewer |
| `3fa3906` | 2026-09-15 | A locations architecture built to survive a doorway audit |
| `4f5cc7d` | 2026-09-14 | Explain why the release package SHA trails the branch tip |
| `a5e57b6` | 2026-09-14 | Strengthen topical internal linking (Sprint 16 GSC) |
| `0172645` | 2026-09-09 | Record the GA4 baseline, the drift, and the operator runbooks |
| `4333317` | 2026-09-09 | Mark developer traffic so QA stops counting as customers |
| `9dcf96a` | 2026-09-09 | Parse JSON-LD nodes instead of regex-slicing them |
| `3b4885c` | 2026-09-09 | A phone number is not SMS consent, and the forms now say so |
| `f146c07` | 2026-09-09 | Centralize the active business identity |

Sprint records: `docs/sprint14-gsc-seo-optimization.md`,
`docs/sprint16-gsc-demand-expansion.md`, `docs/twilio-a2p-resubmission.md`,
`docs/legal-entity-cutover.md`, `docs/analytics/`, `docs/05-seo/`.

## Active / likely next work

**Confirmed** — from `git show origin/main:brain/TODO.md` (last triaged
2026-09-03; read it directly before relying on this summary):

- `WEB-001` complete the live CTA and funnel-routing audit.
- `WEB-002` finish launch and funnel QA (deployed commit, forms, legal pages,
  result privacy, booking paths, mobile, performance, a11y, redirects, sitemap,
  Search Console).
- `WEB-003` synchronize GitHub with the exact production source — production
  has contained newer fixes than the tracked branches.
- `TRACK-001` … `TRACK-006` measurement inventory, GA4 funnel coverage, Meta
  Pixel, the dataLayer contract, attribution and consent QA.
- `ASM-001`/`ASM-002` reconcile the canonical documents with the deployed
  two-path assessment (free 15-question + $495 comprehensive audit backed by an
  internal 64-question engine) and version that engine.
- `MKT-001`/`MKT-002` Facebook page identity and the first paid campaign plan.

**Inferred** (shape of recent commits, not written down): continuing the local
authority / locations cluster, and eventually merging the two lines.

## Known issues / risks

- **Two unmerged lines**, above. The longer they diverge the more a merge costs.
- **Production may be ahead of Git** — `WEB-003` says so explicitly. Do not
  assume the deployed site equals `HEAD`; verify the deployed commit before
  overwriting website code.
- **`brain/TODO.md` was last triaged 2026-09-03** and predates Sprints 14–17.
  Treat its website items as a backlog, not a status report.
- **Untracked `design-system/`** sits in this working tree. It is not part of
  the build and was not touched by this audit.
- Claims made on the public site (A2P/SMS consent, analytics, credentials) are
  guarded by tests. Changing copy can break `tests/twilioA2pCompliance.test.ts`
  or `tests/analyticsIntegrity.test.ts`, and that is the intended behaviour.

## Production state

- **Site:** `https://youraidepartment.ai`, configured as `site` in
  `astro.config.mjs`, `trailingSlash: 'always'`, `output: 'static'`.
- **Host:** SiteGround VPS/cloud per `CLAUDE.md`. Deployment is an upload of the
  generated static directory; there is no adapter and no Node runtime
  requirement at deploy time.
- **Campaign domain:** `hireanaidepartment.com`.
- `dist/` in this working tree is a local build artifact (gitignored), not a
  record of what is live.
- **NEEDS VERIFICATION:** the exact commit deployed to production, the GTM/GA4/
  Ads identifiers currently live (recorded in `brain/TRACKING.md` on the other
  line), and DNS/host details. None of it is provable from this checkout.

## Relevant branches

| Branch | Head | Date | Note |
|---|---|---|---|
| `sprint17-local-authority-proof` | `9e4c436` | 2026-09-15 | Current; matches `origin` |
| `sprint16-gsc-demand-expansion` | `4f5cc7d` | 2026-09-14 | Previous sprint |
| `sprint15-analytics-conversion-integrity` | `0172645` | 2026-09-09 | |
| `sprint14-gsc-seo-optimization` | `fdff424` | 2026-09-09 | |
| `sprint13-twilio-a2p-compliance` | `4c1e01d` | 2026-09-09 | |
| `sprint16-twilio-30923-prod` / `-forced-consent` | `4096307` / `bf3f2ee` | 2026-09-10 | A2P campaign work |
| `feature/outbound-sales-brain` | `d856bce` | 2026-09-15 | Sales Brain line (see below) |
| `feature/sales-brain-rep-enrichment` | `523d8da` | 2026-09-16 | Newest Sales Brain work |
| `origin/main` | `d341e5d` | 2026-09-05 | Has `brain/` and `services/`; behind both lines |

## Worktrees

`git worktree list` from this repository:

```text
/home/roothecks/AiDepartment                          sprint17-local-authority-proof
/home/roothecks/AiDepartment-portal-test              (detached 24af959)
/home/roothecks/YAD-Sales-Brain                       feature/outbound-sales-brain   [locked]
/home/roothecks/YAD-Sales-Brain-baseline-check        (detached ef4d343)
/home/roothecks/YAD-Sales-Brain-collector-fix         fix/dataforseo-standard-collector
/home/roothecks/YAD-Sales-Brain-enrichment            feature/sales-brain-rep-enrichment
/home/roothecks/YAD-Sales-Brain-marathon              offline-marathon-20260909
/home/roothecks/YAD-Sales-Brain-p0-entity-resolution  fix/sales-brain-p0-entity-resolution
/home/roothecks/YAD-Sales-Brain-readmodel-fix         fix/sales-brain-discovery-coverage-identity
```

At the time of this audit, `/home/roothecks/YAD-Sales-Brain` had a live agent
session and a running Sales Brain API and worker, and
`/home/roothecks/YAD-Sales-Brain-enrichment` was running its test suite. **Check
for live sessions before working in any worktree** — `ps` for processes whose
cwd is under it, and for `node dist/bin/{api,worker}.js`.

## Handoff notes

1. Read `CLAUDE.md` in full. The "do not invent" rule at the top is the most
   important line in this repository: no offers, pricing, testimonials, case
   studies, clients, ROI, statistics or credentials that are not in an approved
   source document.
2. Then read `git show origin/main:brain/TODO.md` and the relevant
   `brain/*.md`, because this branch does not carry them.
3. `docs/00-company/launch-decisions.md` controls the V1 commercial model. The
   source-of-truth hierarchy is in `CLAUDE.md`.
4. Implement approved copy; do not rewrite messaging during development.
5. Run `npm test` (it builds first) before claiming anything works.
6. Never publish an indicative internal price range as a fixed promise.
