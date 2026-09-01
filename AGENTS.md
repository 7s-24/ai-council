# AI Council Workspace Rules

These rules apply to Claude, Codex, Gemini, and any coordinating agent.

## Workspace boundary

- Work only inside this Git repository and the worktrees created beneath `.worktrees/`.
- Never read or change files outside this repository unless the human explicitly expands the scope.
- Never inspect browser profiles, credentials, keychains, SSH material, cloud tokens, or unrelated repositories.
- Never push, force-push, publish, deploy, send messages, or open pull requests without explicit human approval.

## Shared context

- Read `.ai-team/CONTEXT.md`, `.ai-team/TASK.md`, and `.ai-team/DECISIONS.md` before acting.
- Treat Git state and committed files as the durable shared context.
- Separate observed evidence from assumptions. Record durable architectural decisions in `.ai-team/DECISIONS.md`.
- Do not place credentials, authorization codes, cookies, or other secrets in prompts, logs, commits, or shared context files.

## Collaboration roles

- Claude focuses on requirements, architecture, edge cases, and clear plans.
- Codex focuses on implementation, tests, debugging, and integration.
- Gemini focuses on independent review, alternative approaches, and missing risks.
- Roles are defaults, not monopolies. Every agent must inspect evidence and challenge weak conclusions.

## Change discipline

- Keep changes scoped to the current task and preserve unrelated human work.
- Run the smallest relevant validation before claiming completion.
- Never bypass failing tests by weakening or deleting them unless the task explicitly requires a test correction.
- Do not make destructive Git changes such as `reset --hard`, forced branch deletion outside `council/*`, or history rewriting.
- Council branches may merge locally into `main`; they must never push. A human reviews the result before acceptance.

## Completion

A task is complete only when the requested deliverable exists, relevant checks pass, remaining risks are stated, and the repository has no unexplained uncommitted changes.

