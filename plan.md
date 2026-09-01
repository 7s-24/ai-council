# Plan: AI Council Workspace Readiness Audit

## Goal
Audit this newly created AI Council workspace and produce `.ai-team/READINESS.md` stating whether it is ready for future three-model collaboration.

## Scope guardrails
- No dependency changes, no account/auth/global config changes, no shell profile edits.
- No files written outside this repository.
- No secrets or account identifiers in tracked files.
- Working tree must be clean before running any commands that assume a clean state.

## Task Checklist

### Phase 1 — Draft (independent, parallel)
- [ ] Read `README.md`, `AGENTS.md`, `.ai-team/CONTEXT.md`, `.ai-team/DECISIONS.md`, `.ai-team/team.json`, and `scripts/*.mjs` [Claimed: council/Claude]
- [ ] Run `npm run check` and `npm run doctor`, capture output as evidence (no auth/config changes) [Claimed: council/Claude]
- [ ] Verify workflow properties from committed evidence: [Claimed: council/Claude]
  - shares context via committed files (e.g. `.ai-team/CONTEXT.md`, `DECISIONS.md`)
  - creates a safety branch before execution
  - refuses to run on a dirty working tree
  - leaves final acceptance to a human (no auto-merge/auto-push to a protected branch without review)
- [ ] Draft `.ai-team/READINESS.md` with: evidence section (command outputs/observations), limitations, concise verdict (Ready / Not Ready / Ready with caveats) [Claimed: council/Claude]

### Phase 2 — Review
- [ ] Codex reviews Claude's draft `.ai-team/READINESS.md` → `reviews/Codex-on-Claude.md` [Claimed: council/Codex]
- [ ] Gemini reviews Claude's draft `.ai-team/READINESS.md` → `reviews/Gemini-on-Claude.md` [Claimed: council/Gemini]
- [ ] Claude reviews any alternate drafts from Codex/Gemini if they produce their own, and reconciles into a single `.ai-team/READINESS.md` [Claimed: council/Claude]

### Phase 3 — Finalize
- [ ] Reconcile feedback, finalize single `.ai-team/READINESS.md` on `main`
- [ ] Each agent records consensus vote in their report
- [ ] Confirm acceptance criteria met: file exists, evidence-based, static checks + doctor pass, no secrets, all three agents reviewed same committed state

## Dependencies
- Review phase depends on Draft phase producing a committed `.ai-team/READINESS.md` on `main`.
- Finalize depends on at least 2/3 agents giving `[APPROVE]`.

## Notes
- Since this is a single-document audit deliverable (not a multi-module build), we avoid splitting the draft into competing parallel drafts — one agent drafts, others cross-review, to prevent conflicting `READINESS.md` merges. First agent to claim Phase 1 tasks owns the draft.
