# Repository Agent Instructions

This repository is the shared source of truth for Your AI Department.

## Before substantial work

1. Read brain/README.md and brain/TODO.md.
2. Read the relevant subject file under brain/.
3. Read the authoritative specification linked from it.
4. Inspect current code and Git state before proposing or making changes.

The locked commercial hierarchy in CLAUDE.md and docs/00-company/launch-decisions.md controls. The operational brain summarizes current state; it does not authorize invention.

## While working

- Use a stable task ID from brain/TODO.md when practical.
- Preserve user changes and avoid unrelated rewrites.
- Never invent offers, pricing, clients, results, testimonials, ROI, credentials, partnerships, or statistics.
- Never commit secrets, credentials, lead/customer data, assessment submissions, or private exports.
- Distinguish proposed, approved, implemented, deployed, and verified.
- Do not silently resolve a conflict between approved documents; report and reconcile it within the authorized scope.

## After authorized changes

- Run relevant tests/checks/builds.
- Update the relevant brain file and brain/TODO.md when project state changed.
- Record material approved decisions in brain/DECISIONS.md.
- Keep brain updates in the same change as the implementation when possible.
- Handoff the outcome, changed files, verification evidence, remaining blockers, and exact next action.

Do not mark a task complete until its completion gate in brain/TODO.md has been verified.
