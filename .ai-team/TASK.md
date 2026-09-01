# Current Council Task

## Goal

Audit this newly created AI Council workspace and produce `.ai-team/READINESS.md` stating whether it is ready for future three-model collaboration.

## Required work

- Read `README.md`, `AGENTS.md`, `.ai-team/CONTEXT.md`, `.ai-team/DECISIONS.md`, `.ai-team/team.json`, and the scripts under `scripts/`.
- Run `npm run check` and `npm run doctor` without changing authentication or global configuration.
- Check that the workflow shares context through committed files, creates a safety branch before execution, refuses a dirty working tree, and leaves final acceptance to a human.
- Create `.ai-team/READINESS.md` with evidence, limitations, and a concise verdict.
- Do not change dependencies, account settings, shell profiles, or files outside this repository.

## Acceptance criteria

- `.ai-team/READINESS.md` exists and is evidence-based.
- Static checks and the CLI doctor pass.
- No secrets or account identifiers are written to tracked files.
- All three agents review the same committed repository state and state a consensus vote.

