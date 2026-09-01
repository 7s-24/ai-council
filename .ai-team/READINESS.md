# AI Council Workspace Readiness Report

**Date:** 2026-09-01  
**Audited Target:** `ai-council-workspace` (Claw Orchestrator 6.2.0, Claude Code, Codex CLI, Google Antigravity / Gemini)  
**Deliverable Status:** Complete after human reconciliation of the three reviews
**Overall Verdict:** **READY WITH DOCUMENTED LIMITATIONS** for local three-model collaboration.

---

## 1. Executive Summary

The Council audited the workspace configuration, documentation, executable scripts, CLI status, workflow invariants, and tracked repository content.

Static syntax checks passed. The host/root login preflight passed for all three CLIs without changing authentication or global configuration. A rerun from Codex's sandboxed worktree could not access the Claude and Gemini login state, so authentication checks are explicitly treated as a host preflight rather than an in-agent invariant.

---

## 2. Verification Evidence

### 2.1 Static & Module Checks (`npm run check`)
- **Command:** `node --check scripts/lib.mjs && node --check scripts/doctor.mjs && node --check scripts/council.mjs && node --check scripts/council-action.mjs`
- **Result:** Exit code `0`. All script modules conform to ECMAScript module standards without syntax errors.

### 2.2 CLI Doctor & Authentication (`npm run doctor`)
- **Command:** `node scripts/doctor.mjs`
- **Output:**
  ```text
  OK   Codex CLI: codex-cli 0.148.0-alpha.9
  OK   Codex login: signed in
  OK   Claude Code: 2.1.226 (Claude Code)
  OK   Claude login: signed in
  OK   Antigravity CLI: 1.1.23
  OK   Gemini access: signed in; Gemini models available
  OK   Claw Orchestrator: 6.2.0
  OK   Git workspace: repository detected
  ```
- **Finding:** All three agent CLI engines and the orchestrator were available from the host workspace. Login checks can be false negatives inside another model's sandbox, so `npm run team` now runs the doctor before dispatching agents.

---

## 3. Workflow Safety Invariants Verification

| Invariant | Implementation Mechanism | Evidence / Code Reference | Status |
| :--- | :--- | :--- | :---: |
| **Committed Context Sharing** | Git-tracked markdown files (`CONTEXT.md`, `TASK.md`, `DECISIONS.md`, `plan.md`) | `scripts/council.mjs:18-31`, `AGENTS.md:14-17` | **VERIFIED** |
| **Pre-Execution Safety Branch** | Automated snapshot branch `safety/before-<timestamp>` created from `HEAD` before any model is invoked | `scripts/council.mjs:55-57` (`git branch backupBranch HEAD`), verified `safety/before-20260901T070406Z` exists | **VERIFIED** |
| **Refusal of Dirty Working Tree** | Strict branch check (`main`) and working tree status validation (`git status --porcelain=v1`) prior to start | `scripts/lib.mjs:38-48` (`requireCleanMain()`), called in `scripts/council.mjs:43` | **VERIFIED** |
| **Separate Acceptance Gate** | The normal Council run never calls `councilAccept`; review, acceptance, and rejection are separate commands, while `AGENTS.md` assigns external side effects and final decisions to the human | `scripts/council.mjs`, `scripts/council-action.mjs`, `AGENTS.md` | **VERIFIED PROCEDURALLY** |

---

## 4. Security & Secret Scanning

- **Tracked Files:** The tracked state was scanned at the reviewed commit. The exact count changes as Council plans and reviews are added or archived, so it is intentionally not used as a security invariant.
- **Grep Inspection:** Checked for potential credential patterns (`key`, `secret`, `token`, `password`, `auth`, `sk-`). All occurrences correspond to script function names or documentation tokens; zero hardcoded secrets, personal tokens, or API keys are committed.
- **Ignore Rules (`.gitignore`):** Appropriately isolates `node_modules/`, `.worktrees/`, `.ai-team/runtime/`, `.DS_Store`, and `*.log` from accidental tracking.
- **Auth Strategy:** All models use host OS subscription credentials (OAuth/session tokens located in respective user config directories), avoiding local secret exposure.

---

## 5. Operational Limitations & Edge Case Risks

1. **Worktree Concurrency & Branch Coordination:**
   - Simultaneous edits to the same files by parallel agents can lead to merge conflicts if agents commit out of sync.
   - *Mitigation:* Follow the phased collaboration plan (`plan.md`): assign discrete roles (drafting vs. cross-review vs. reconciliation).
2. **Permission Boundary Constraints:**
   - Claude Code and Antigravity operate under `bypassPermissions` inside the workspace to allow headless execution, while Codex runs with `auto` in a sandboxed worktree.
   - *Mitigation:* `AGENTS.md` and repository boundary checks explicitly prohibit accessing files outside the repository or inspecting browser profiles/SSH keys.
3. **Execution Limits & Budgeting:**
   - Configured in `.ai-team/team.json` with a 300-second per-turn timeout, 12 turns max per agent, and $0.50 budget cap. Heavy workloads should be decomposed into smaller council iterations.
4. **Host versus worktree authentication:**
   - Codex's workspace sandbox can prevent its worktree from reading Claude and Gemini login state. This does not mean those accounts are logged out; the authoritative login gate runs from the host workspace before Council starts.
5. **Procedural human gate:**
   - The scripts separate review/accept/reject and never push automatically, but they do not authenticate whether the person invoking `team:accept` is the human owner. Repository policy and local account control remain part of the boundary.

---

## 6. Council Readiness Verdict

```
================================================================================
VERDICT: READY WITH DOCUMENTED LIMITATIONS
================================================================================
The workspace has working three-engine orchestration, shared Git context, safety
snapshots, and an explicit review gate. Use it only as the dedicated local repo
described in README.md, and keep host preflight plus human review enabled.
================================================================================
```

## 7. Council Votes and Human Reconciliation

- Claude: `[CONSENSUS: YES]` based on its independent worktree checks.
- Gemini: `[CONSENSUS: YES]` based on its safety review and host-visible doctor result.
- Codex: `[CONSENSUS: NO]` until absolute paths, the mutable file-count claim, the sandboxed doctor discrepancy, and the wording of the human gate were corrected.
- Human-side reconciliation: the four Codex findings have been incorporated into this report and the launcher. The final repository checks must pass before this run is accepted.
