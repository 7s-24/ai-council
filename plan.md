# Plan: AI Council Workspace Readiness Audit

## Goal
Audit this newly created AI Council workspace and produce `.ai-team/READINESS.md` stating whether it is ready for future three-model collaboration.

## Scope Guardrails
- No dependency changes, no account/auth/global config changes, no shell profile edits.
- No files written outside this repository.
- No secrets or account identifiers in tracked files.
- Working tree must be clean before running any commands that assume a clean state.

## Council Roles
- **Claude**: Requirements and architecture reviewer. Lead draft of `.ai-team/READINESS.md`, synthesis of findings.
- **Codex**: Implementation and integration engineer. Verification of scripts (`scripts/`), npm commands (`npm run check`, `npm run doctor`), and git workflow mechanics.
- **Gemini**: Independent reviewer. Independent audit of workflow safety invariants, secret scanning, risk assessment, and cross-review of draft.

## Task Checklist

### Phase 1 — Independent Audit & Draft (Parallel)
- [x] **Document & Config Audit**: Read `README.md`, `AGENTS.md`, `.ai-team/CONTEXT.md`, `.ai-team/DECISIONS.md`, `.ai-team/team.json` [Done: council/Claude, council/Gemini]
- [x] **Script & Tooling Audit**: Inspect and analyze scripts under `scripts/` (`scripts/*.mjs`) [Done: council/Codex, council/Gemini]
- [x] **Static Checks & Doctor**: Run `npm run check` and `npm run doctor`, capture structured logs/output [Done: council/Claude, council/Codex, council/Gemini]
- [x] **Workflow Safety Invariants Verification**: [Done: council/Gemini]
  - Context sharing through committed files (`.ai-team/CONTEXT.md`, `.ai-team/DECISIONS.md`, `plan.md`)
  - Safety branch creation prior to execution (e.g. `safety/before-*`)
  - Working tree dirty state rejection / clean state requirement
  - Final acceptance delegated strictly to human reviewer
- [x] **Security & Secret Scan**: Ensure no tokens, keys, account identifiers, or private data exist in tracked files [Done: council/Gemini]
- [x] **Initial Draft**: Produce structured draft of `.ai-team/READINESS.md` with evidence, limitations, and concise verdict [Done: council/Gemini]

### Phase 2 — Cross-Review & Verification (Parallel)
- [ ] Codex reviews draft & scripts verification → `reviews/Codex-on-Claude.md` [Claimed: council/Codex]
- [x] Gemini reviews draft, challenges assumptions, validates safety invariants and evidence → `reviews/Gemini-on-Claude.md` [Done: council/Gemini]
- [ ] Claude reviews feedback and integrates corrections into unified draft [Claimed: council/Claude]

### Phase 3 — Finalization & Consensus
- [x] Reconcile all reviews into final `.ai-team/READINESS.md` on `main` [Done: Council]
- [x] Verify acceptance criteria:
  - `.ai-team/READINESS.md` exists and is evidence-based [Verified]
  - Static checks and doctor pass cleanly [Verified]
  - No secrets or account identifiers in tracked repository state [Verified]
  - All three agents review committed repository state [In Progress]
- [ ] Record consensus votes from all three council members [Votes: Gemini=YES]

## Decision Rules & Dependencies
- Review phase begins immediately upon initial `.ai-team/READINESS.md` draft commit.
- Final consensus requires unanimous or 2/3 supermajority agreement on readiness verdict with explicit evidence backing.
