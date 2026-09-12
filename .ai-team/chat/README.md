# Plan-review chatroom boundary

The local chatroom is intended for discussing and reviewing plans with Claude, Codex, and Gemini.

## Read policy

- The macOS app discovers direct child directories of the human-authorized Projects folder and accepts additional folders chosen through native `NSOpenPanel` dialogs anywhere on attached disks. Each manually added folder is persisted with a security-scoped bookmark. The browser selects projects by opaque catalog ID and cannot submit an arbitrary filesystem path.
- The startup and project-selection payloads never recursively enumerate the project. This avoids exposing a file catalog to the page and keeps very large or cloud-backed folders responsive.
- Chat-mode sessions use an empty sandbox directory. Code-mode sessions use the active project as their working directory under each provider's read-only sandbox, so the model can inspect files only when a Code request needs them.
- File contents read by a Code-mode CLI are sent to that model provider; do not add material you do not want to share with the chosen provider.

## Write policy

- Models never receive direct write authority over the repository.
- A model may return an `<artifact path="artifacts/example.md">...</artifact>` proposal.
- The browser shows each proposal and requires a human Apply action.
- The server accepts only text artifacts beneath `artifacts/`.
- A new path must not already exist. An existing path can be updated only if the chatroom registry proves that the chatroom created it, and only if its content hash has not changed since the proposal was made.
- No delete, rename, move, chmod, executable-file, or arbitrary-path endpoint exists.

## Runtime policy

- The native macOS wrapper starts this same loopback server on an ephemeral port, embeds it in a `WKWebView`, and terminates its child server when the app exits.
- Native folder selection is the only browser-to-app filesystem bridge action. It opens a system directory picker; the web page never receives or submits the selected absolute paths.
- The HTTP server binds to `127.0.0.1` only.
- API requests require the random token printed at startup.
- Chat sessions use a dedicated empty directory outside the repository. Code sessions use the active project with enforced read-only sandboxes; direct edits remain unavailable.
- Claude additionally uses `--safe-mode` and restricted mode: subscription OAuth remains available, while user/project customizations, MCP servers, hooks, skills, agents, `CLAUDE.md`, shell execution, and write-capable tools are disabled.
- Chat transcripts and the artifact registry are stored beneath `.ai-team/chat/runtime/` and are not committed. Non-host projects use separate hashed runtime directories, so their histories and managed-file registries do not mix.
- Vendor CLIs may still update their own login/session metadata in their standard user configuration directories. The chatroom never edits ordinary project files on their behalf.

## Conversation modes and routing

- The Code-mode Projects rail groups discovered projects by root markers for Node.js, Python, Swift, Rust, Go, JVM, mixed, or other environments. Switching projects refreshes the transcript and managed artifacts without crawling the project tree.
- Projects and artifact sidebars collapse independently into narrow rails. Their state and the selected Chat/Code mode are stored in ignored local runtime data.
- Chinese and English UI languages can be switched from the title bar. The selection is persisted with the other UI settings and also updates the native macOS menus.
- Light and dark themes use a flat, high-density Reddit/Discord-inspired layout. The theme persists and updates the native macOS window appearance.
- The chatroom adds no default persona, review role, or behavioral preset. Each provider CLI keeps its own default behavior unless the human configures an agent-specific preset prompt.
- Model overrides and optional preset prompts are stored independently for Claude, Codex, and Gemini beneath the ignored chat runtime directory. Empty values mean CLI defaults and no preset prompt.
- Gemini model choices are refreshed in the background from the installed `agy models` command and cached locally, so model discovery never delays App startup. Effort-qualified slugs are passed through unchanged and stale legacy choices are migrated when a compatible current model exists.
- `Chat` mode is discussion-only and never turns model output into artifact proposals.
- `Code` mode may parse the documented artifact envelope, but still requires the human Apply action.
- Clicking agent chips builds an explicit sequential route of up to eight turns. Repeated agents are preserved, and clicking a route node removes that exact turn.
- Typed mentions are case-insensitive and also preserve every occurrence in appearance order.
- Each later model in a mention queue receives the earlier model answers from that same turn as shared context. Without mentions, the Group target runs all three in parallel.

## Output rendering

- Responses are rendered locally with `markdown-it`, with raw HTML and Markdown images disabled. Links open separately with `noopener` and `noreferrer`.
- Each model is asked for a short, user-facing `<reasoning_summary>` before its final Markdown answer. This is an explicit rationale summary, not private hidden chain-of-thought.
- Claude and Google Gemini logo paths are sourced from Simple Icons; the Codex avatar uses the OpenAI mark. All names and marks belong to their respective owners.
