# AI Council

A local workspace for chatting and reviewing ideas with Claude, Codex, and Gemini through their CLI tools. Use one model, compare parallel replies, or let models respond in sequence.

- Multiple projects and saved conversations.
- Chat mode for discussion; Code mode for project review and file drafts.
- Manual approval before applying drafts.
- English and Chinese interfaces, with light and dark themes.

## Windows preview

[Download Windows x64 RC1](https://github.com/7s-24/ai-council/releases/tag/v1.0.0-rc.1)

1. Extract the entire ZIP.
2. If needed, run `Install-Model-CLIs.cmd` to install Claude Code and Codex.
3. Run `Start-AI-Council.cmd`, then sign in with your own accounts from Settings.

Node.js is included; WSL is not required. The interface opens in your browser. Keep the console open while using the app.

**Preview only:** this release has not been tested on a Windows machine. Gemini requires a compatible Antigravity CLI and is not installed by the setup script.

## Run from source

Requires Node.js 22+ and the CLI tools for the models you want to use.

```bash
git clone https://github.com/7s-24/ai-council.git
cd ai-council
npm ci
npm run chat
```

Open the local URL printed in the terminal.

On macOS, build the desktop app with Xcode Command Line Tools installed:

```bash
npm run macos:build
open "dist/AI Council.app"
```

## Notes

Model access uses your own accounts. Conversations are stored locally, but prompts and project content read by a model are sent to that model's provider.

Code mode is intended for review and approved text drafts, not unrestricted editing. Gemini's Code-mode tool access needs additional configuration.

For development, run `npm run check`. The separate Git-based Council workflow uses the task files in `.ai-team/`; its rules are documented in [AGENTS.md](AGENTS.md).
