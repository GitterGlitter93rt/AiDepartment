# Working Agreement and Cross-Agent Workflows

**Owner:** Michael Chanata  
**Last reviewed:** 2026-08-30

## Communication style

Michael generally wants the answer that moves the work forward. For technical execution:

- Lead with the concrete outcome or next move.
- Give the exact command, where to paste it, and the directory/app it belongs in.
- State the expected successful result.
- State exactly what error/output/screenshot to send back if it fails.
- Use screenshots, logs, generated files, and errors as the next diagnostic input.
- Do not repeatedly ask questions that the project brain or current thread already answers.
- Ask when a genuinely unresolved choice would materially change the result.
- Keep generic background shorter than actionable guidance.

## Roles

Michael is the decision-maker and supplies business intent, approvals, account access, live-site context, and subjective creative review.

ChatGPT/Codex acts as the architect, debugger, reviewer, creative collaborator, and GitHub brain maintainer. It can define tasks, inspect repository state, make authorized changes, prepare exact prompts/commands, and review local-agent outputs.

Claude Code, GLM, OX/OpenCode, and other local agents execute repository, terminal, inference, and long-context tasks on the EdgeXpert. They read the same Git brain and return evidence rather than maintaining a disconnected private plan.

## Standard code workflow

1. Convert the request into an outcome and a brain/TODO.md task ID.
2. Read the relevant brain file and canonical specs.
3. Inspect the actual current code and working-tree state.
4. Identify assumptions, blockers, and a safe verification plan.
5. Make the smallest coherent implementation.
6. Run targeted tests, then the relevant broader build/check.
7. Review the diff for unrelated changes, secrets, stale comments, broken links, and invented content.
8. Update task status and durable context when authorized.
9. Handoff: outcome, files, tests, unresolved items, and exact next step.

Do not use chat completion as evidence that the repo, live site, or EdgeXpert changed. Verify the actual system.

## Standard debugging loop

1. Capture the exact failing command/action and full relevant error.
2. Establish environment, path, branch/commit, version, and whether the failure is reproducible.
3. Narrow the failure to the smallest layer: account/access, network, dependency, configuration, code, model, input, output, or deployment.
4. Change one meaningful variable at a time when diagnosing uncertain behavior.
5. Re-run the smallest verification, then the end-to-end path.
6. Record the confirmed cause and fix in the relevant brain file if it will matter again.

## Standard creative workflow

1. Define audience, problem, offer, hook, CTA, platform, format, and funnel URL.
2. Create a small set of intentionally different concepts, not cosmetic duplicates.
3. Generate or design the asset in the appropriate tool.
4. Review legibility, brand, claim support, mobile crop/safe zones, pacing, audio, and platform requirements.
5. Iterate from concrete defects and performance hypotheses.
6. Save the approved output and enough metadata to identify how it was produced.
7. Map each creative to campaign naming, UTM, audience, and conversion event.

## Chat rollover and continuity

Numbered YourAiDepartment chats are execution rooms. When a chat becomes too large, start the next numbered thread and point it to this repository brain. Do not manually reconstruct the whole project from chat.

The optional MASTER TODO / ROADMAP chat may be used as a readable dashboard, but brain/TODO.md is authoritative. At the end of material work, update Git rather than asking Michael to copy the same status between chats.

## Decision discipline

- Record approved choices in brain/DECISIONS.md.
- Record unresolved alternatives as unresolved; do not pick one silently.
- Reconcile older canonical documents after an approved change.
- Distinguish implementation complete, deployed, and verified in production.
- Do not mark a task done merely because an agent said it was done.

## Security and privacy

- Never paste or commit API keys, passwords, cookies, SSH keys, Tailscale auth material, CRM credentials, or customer/lead exports.
- Redact secrets and private data from screenshots/logs before preserving them.
- Use configured task-relevant credentials only for the requested scope.
- Keep public analytics free of contact data, raw assessment answers, private scores, and sensitive free text.
