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

Provider names and logos identify the corresponding model services. No endorsement is implied. The original source of the SVG files under `public/logos/` was not recorded in the repository; their provenance and applicable brand permissions still need verification before a stable release. Dependency licenses do not establish licensing rights for those assets.

These notices apply to the identified third-party components. They do not assign a license to AI Council's original code.
