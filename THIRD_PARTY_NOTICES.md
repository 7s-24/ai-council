# Third-party notices

## Claw Orchestrator

AI Council was initially built using [Claw Orchestrator](https://github.com/Enderfga/claw-orchestrator) by **enderfga**, through the npm package `@enderfga/claw-orchestrator` (version 6.2.0).

It provides the Git-based Council workflow and the macOS chat orchestration backend. The Windows chat adapter was developed with reference to its CLI invocation and response protocols. The Windows portable package does not bundle the Claw Orchestrator npm package itself; this notice is included to preserve attribution for that implementation reference.

Claw Orchestrator is distributed under the MIT License. The following is the complete license shipped with the version used by this project:

```text
MIT License

Copyright (c) 2024 enderfga

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Other bundled components

- **markdown-it** and its bundled dependencies: the Windows package includes their notices under `THIRD-PARTY-LICENSES/`.
- **Node.js** and **npm**: the Windows package retains the official runtime's `runtime/LICENSE` and npm's own license files.
- The optional CLI installer downloads Claude Code and Codex separately from their publishers. Those tools retain their own licenses and service terms; their accounts and credentials are not bundled with AI Council.

Source installations also retain dependency licenses in `node_modules/`.

## Provider names and logos

Provider names and logos identify their respective services and belong to their respective owners: Anthropic (Claude), OpenAI (Codex/OpenAI), and Google (Gemini). AI Council is an independent project and is not endorsed by these providers. These marks are excluded from AI Council's MIT license.

Asset review on 2026-09-12:

- `public/logos/claude.svg`: SVG path exactly matches [Simple Icons' Claude asset](https://github.com/simple-icons/simple-icons/blob/develop/icons/claude.svg).
- `public/logos/gemini.svg`: SVG path exactly matches [Simple Icons' Google Gemini asset](https://github.com/simple-icons/simple-icons/blob/develop/icons/googlegemini.svg).
- These matches identify an available source, not the original download history, which was not recorded. Simple Icons uses [CC0 1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md); it does not grant trademark rights or clear third-party rights.
- `public/logos/codex.svg` depicts the OpenAI Blossom, rather than a distinct Codex mark. The exact source and redistribution permission for this SVG remain unverified.

Brand guidance is separate from asset copyright licensing:

- [OpenAI's brand guidelines](https://openai.com/brand/) permit only uses within their terms, require accurate service identification, and prohibit incorporating the logo into one's own branding. The current macOS app icon combines provider logos; replace it with an original AI Council icon before a stable release.
- [Google's brand resources](https://about.google/brand-resource-center/products-and-services/) direct integrations to product-icon and integration guidelines. A path match alone does not verify this application's permission to display Gemini's mark.
- [Anthropic's official newsroom assets](https://brandfolder.com/anthropic/newsroom) were located, but a license granting this application's logo use was not verified.

The existing provider icons have not been certified as cleared for redistribution. Before a stable release, obtain applicable permissions or replace unresolved assets with neutral, original symbols. The existing RC1 ZIP has not been rebuilt as part of this documentation update.

AI Council's original code is licensed under [MIT](LICENSE). Third-party components and marks retain their separate terms described above.
