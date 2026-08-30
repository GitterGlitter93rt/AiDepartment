# MSI EdgeXpert Environment and Agent Operations

**Last user-reported context:** August 2026  
**Verification status:** Machine-local details must be rechecked on the EdgeXpert before dependency or system changes.

## Known environment

- MSI EdgeXpert-class NVIDIA GB10 development system
- ARM64 Ubuntu Noble environment
- Primary local creative/agent project path: ~/ai-ad-brain
- Claude Code is used for repository and terminal work
- GLM-family models, OX/OpenCode, and OpenRouter have been used as alternative or supporting agents
- Tailscale has been set up/discussed for private remote network access; SSH is the terminal-control layer, while GUI remote-control tools are a separate choice

Previously reported versions and hardware details may drift. Before relying on them, capture non-secret outputs for OS, architecture, GPU, memory, Node, Python, Claude Code, OX/OpenCode, and Git state.

## Repository startup workflow

When working on AiDepartment from the EdgeXpert:

1. Confirm the repository path and git status.
2. Fetch/pull the intended branch without discarding local user changes.
3. Read root CLAUDE.md, AGENTS.md, brain/TODO.md, and the relevant brain/specification files.
4. Select one stable task ID.
5. Inspect current code/config before changing it.
6. Implement the smallest coherent change.
7. Run the relevant checks/tests/build.
8. Update the relevant brain file and task status in the same change when authorized.
9. Return the changed files, commands run, results, blockers, and exact next action.

Never use destructive Git cleanup on an unreviewed working tree. Never commit machine-specific secrets, tokens, OpenRouter keys, SSH keys, Tailscale credentials, cookies, or client data.

## ChatGPT ↔ EdgeXpert handoff

The preferred loop is:

Michael/ChatGPT defines the outcome and task ID → Claude/GLM/OX executes or diagnoses locally → Michael sends the result/error/screenshot/log back → ChatGPT reviews and chooses the next action → confirmed state is recorded in Git

When Michael is pasting commands manually, provide:

- The exact terminal/app and directory
- One copyable command or a clearly ordered short block
- What success should look like
- What output to return if it fails

Do not ask Michael to repeat resolved environment facts unless the fact may have changed or verification is necessary for safety.

## Agent selection

- **ChatGPT/Codex:** architecture, task triage, code review, debugging strategy, prompts, copy/creative direction, GitHub brain maintenance.
- **Claude Code:** local repository inspection, implementation, tests, terminal work, and long code-context tasks.
- **GLM/OX/OpenCode:** alternative implementation/review/research runs when useful; they must use the same repo instructions and brain rather than creating a separate truth.
- **Local generation tools:** model inference/rendering where local hardware is valuable.

Choose based on the job. Do not build tool loyalty into project architecture.

## Environment inventory still needed

- Exact local repo paths and remotes
- Current OS/kernel/architecture and NVIDIA stack
- Current Claude Code, OX/OpenCode, Node, Python, PyTorch, and ComfyUI versions
- Service/process launch commands
- Model and output directories
- Remote SSH/Tailscale connection procedure that reveals no secrets
- Backup and recovery approach for large models and generated outputs

Record durable, non-secret facts here after verification. Keep secrets in the appropriate local secret manager/environment only.
