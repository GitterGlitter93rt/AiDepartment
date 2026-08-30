# Your AI Department — Operational Brain

**Status:** Active  
**Owner:** Michael Chanata  
**Last reviewed:** 2026-08-30

This directory is the durable, versioned operating context shared by Michael, ChatGPT/Codex, Claude Code, GLM/OX, and other authorized project agents.

It answers four practical questions:

1. What is true now?
2. What has been intentionally decided?
3. What is being worked on next?
4. Where did the last person or agent leave off?

It is not a replacement for the detailed canonical specifications under docs/. It is the current operational layer that points agents to those specifications and prevents project state from being buried in chat histories or machine-local memory.

## Authority map

| Subject | Authority |
|---|---|
| Locked V1 commercial architecture | docs/00-company/launch-decisions.md |
| Foundational company strategy | docs/00-company/master-brain.md and other approved docs/00-company/ files |
| Assessment scoring and recommendation logic | docs/04-assessment/implementation-spec.md plus the related assessment specifications |
| Current priorities, blockers, and work status | brain/TODO.md |
| Approved decisions made after older documents | brain/DECISIONS.md, until reconciled into the canonical specification |
| Current implementation | src/, tests, configuration, and Git history |

If an operational summary conflicts with an approved canonical specification, do not silently choose one. Flag the conflict, use the source-of-truth hierarchy in CLAUDE.md, and reconcile the stale document as part of the authorized work.

## Start-of-work protocol

Before substantial work:

1. Read brain/TODO.md.
2. Read the relevant subject file in this directory.
3. Read the canonical specification linked from that subject file.
4. Inspect the current code or artifact before proposing a change.
5. Use the stable task ID from brain/TODO.md in notes, commits, or handoffs when practical.

Do not load every long strategy document for an unrelated task. Read the smallest authoritative set that covers the work.

## End-of-work protocol

When authorized work changes project state:

1. Update the relevant brain file with confirmed facts only.
2. Move the task in brain/TODO.md only after its stated completion gate is met.
3. Record a material, approved decision in brain/DECISIONS.md.
4. Add a dated summary to brain/CHANGELOG.md for meaningful milestones.
5. Keep the brain update in the same commit or pull request as the work when possible.
6. Report tests run, results, remaining blockers, and the exact next action.

Do not mark a task complete because code was written. Mark it complete only after the stated verification is successful.

## Truth and safety rules

- Never store API keys, passwords, tokens, private customer data, lead lists, or assessment submissions here.
- Distinguish **confirmed**, **planned**, **proposed**, **blocked**, and **unknown**.
- Include a date or commit when a fact may become stale.
- Do not invent pricing, case studies, clients, results, credentials, statistics, or technical configuration.
- Machine-local Claude memory is useful working context, but it is not the shared source of truth.
- Chat transcripts are historical evidence, not the task database.

## File index

| File | Purpose |
|---|---|
| TODO.md | Master roadmap, task states, completion gates, and blockers |
| PROJECT.md | Current business, offer, funnel, and technical snapshot |
| DECISIONS.md | Approved decision log and unresolved proposals |
| WEBSITE.md | Website architecture, current implementation, deployment, SEO, and tracking |
| MARKETING.md | Paid media, targeting, offers, creative, and launch gates |
| AI-ASSESSMENTS.md | Short/long assessment architecture and current implementation gap |
| EDGE-XPERT.md | MSI EdgeXpert environment and agent workflow |
| AI-AD-BRAIN.md | Local creative/video/audio pipeline, experiments, and issues |
| WORKFLOWS.md | How Michael, ChatGPT/Codex, Claude, GLM, and OX work together |
| CHANGELOG.md | Dated brain and project milestones |
