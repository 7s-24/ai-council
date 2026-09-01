# Plan-review chatroom boundary

The local chatroom is intended for discussing and reviewing plans with Claude, Codex, and Gemini.

## Read policy

- The server lists only regular, non-symlink text files inside this repository.
- `.git/`, `node_modules/`, `.worktrees/`, chat runtime data, environment files, private keys, credential stores, and cookies are excluded.
- The human explicitly selects which files are embedded into each chat prompt.
- Selected file contents are sent by the relevant vendor CLI to that model provider; do not select material you do not want to share with the chosen provider.
- Limits apply to file count, individual size, and total prompt size.

## Write policy

- Models never receive direct write authority over the repository.
- A model may return an `<artifact path="artifacts/example.md">...</artifact>` proposal.
- The browser shows each proposal and requires a human Apply action.
- The server accepts only text artifacts beneath `artifacts/`.
- A new path must not already exist. An existing path can be updated only if the chatroom registry proves that the chatroom created it, and only if its content hash has not changed since the proposal was made.
- No delete, rename, move, chmod, executable-file, or arbitrary-path endpoint exists.

## Runtime policy

- The HTTP server binds to `127.0.0.1` only.
- API requests require the random token printed at startup.
- Model sessions use a dedicated empty runtime directory and read-only/no-tool settings where supported.
- Claude additionally uses `--safe-mode`: subscription OAuth remains available, while user/project customizations, MCP servers, hooks, skills, agents, and `CLAUDE.md` are disabled.
- Chat transcripts and the artifact registry are stored beneath `.ai-team/chat/runtime/` and are not committed.
- Vendor CLIs may still update their own login/session metadata in their standard user configuration directories. The chatroom never edits ordinary project files on their behalf.
