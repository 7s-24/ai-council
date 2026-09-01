# Shared Decisions

## 2026-09-01 — Local subscription-backed orchestration

- Use Claw Orchestrator as the local coordinator.
- Use Claude Code, Codex CLI, and Antigravity CLI through their existing signed-in subscriptions.
- Use Git and committed Markdown files as durable cross-model context.
- Run autonomous Council work only inside this dedicated repository.
- Create a safety branch before every Council run and require human review before acceptance.
- Never push or perform external side effects without explicit human approval.

## 2026-09-01 — Host preflight and explicit task readiness

- Run CLI/login checks from the host workspace before dispatching agents; a model worktree sandbox may not be able to read another provider's login state.
- Require `.ai-team/TASK.md` to contain `Status: READY` before any model is called.
- Treat `team:accept` as a separate procedural gate. The scripts do not authenticate the identity of its invoker.
