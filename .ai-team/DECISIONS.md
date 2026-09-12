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

## 2026-09-01 — Native chat entry and project isolation

- Use a signed local AppKit/WKWebView wrapper as the normal macOS entry; it owns and terminates its loopback Node service.
- Ask the human once for a Projects directory through `NSOpenPanel`, persist a security-scoped bookmark, and discover only direct child projects inside that authorized directory.
- Group Code-mode projects by detected root environment markers and address them through opaque catalog IDs, never client-supplied filesystem paths.
- Keep readable files, transcripts, artifact registries, and managed writes scoped to the active project. Existing unmanaged files remain immutable and deletion remains unavailable.
- Permit additional project roots anywhere on mounted storage only after the human selects them in a native directory picker; persist security-scoped bookmarks and pass paths to the server at launch rather than exposing a path-taking browser API.
- Keep every visible workspace sidebar independently collapsible and persist this presentation state outside Git.

## 2026-09-01 — On-demand project context and responsive startup

- Remove the persistent file-context rail and never recursively enumerate an active project during bootstrap or project selection.
- Give Code-mode model sessions read-only access to the active project on demand; keep Chat-mode sessions in the empty sandbox and keep all writes behind artifact approval.
- Refresh Antigravity model choices asynchronously and cache the result so provider discovery does not block the native App's ready state.
- Persist the selected Chat/Code mode together with the remaining sidebar state.

## 2026-09-05 — Durable conversations and approved drafts

- Store complete transcripts with atomic JSON replacement; bound only the context sent to models.
- Persist each completed model reply and its proposals before streaming it to the client, in both relay and parallel mode.
- Scope draft approval to a session and saved proposal ID, persist application status, and retain optimistic file hash checks.
- Reject symbolic links in every artifact path component before any filesystem mutation.
- Session metadata edits must not navigate the active conversation; serialize navigation and block new sends while navigation is pending.

## 2026-09-05 — Windows portable release candidate

- Distribute a Windows x64 ZIP with a checksum-verified, pinned Node.js LTS runtime and a PowerShell/CMD launcher; use the system browser, with no WSL requirement.
- Keep Windows sessions/settings in LOCALAPPDATA, never in the distributable; build from an explicit source allowlist and include third-party licenses.
- Offer a separate optional script to install pinned official Claude/Codex CLIs into the user's local application directory. Accounts and credentials remain owned by the recipient and provider CLIs.
- Use a Windows chat adapter that sends Claude/Codex prompts on stdin, resolves npm shims without a command shell, and preserves the CLI read-only flags. Keep the macOS orchestrator unchanged.
- Label the artifact as a preview until native Windows installation, OAuth, filesystem tools, Unicode paths, and shutdown have been validated. Host-side protocol tests and a packaged HTTP smoke test do not establish native Windows compatibility.
