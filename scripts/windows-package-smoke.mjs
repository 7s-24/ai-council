import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve('.build/windows-release/AI-Council-1.0.0-rc.1-windows-x64');
const runtime = fs.mkdtempSync(path.resolve('.build/windows-smoke-'));
const projects = path.join(runtime, 'Projects');
fs.mkdirSync(projects);
// Load the actual packaged server using its Windows adapter branch. This tests
// packaging and HTTP behavior on macOS, not Windows OS/CLI compatibility.
const source = `import path from 'node:path'; import os from 'node:os';
Object.defineProperty(process, 'platform', { value: 'win32' });
await import(${JSON.stringify(pathToFileURL(path.join(packageRoot, 'app/scripts/chat-server.mjs')).href)});`;
const child = spawn(process.execPath, ['--input-type=module', '-e', source, '--', '--port', '0', '--projects-root', projects], {
  env: { ...process.env, PATH: path.join(runtime, 'empty'), USERPROFILE: runtime, APPDATA: runtime,
    CLAUDE_BIN: '', CODEX_BIN: '', AGY_BIN: '', AI_COUNCIL_DATA_DIR: path.join(runtime, 'data') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '', errors = '';
child.stderr.on('data', (chunk) => { errors += chunk; });
let timer;
try {
  const url = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Startup timeout: ${errors}`)), 10000);
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Server exited ${code}: ${errors}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Open: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/);
      if (match) resolve(new URL(match[1]));
    });
  });
  clearTimeout(timer);
  const headers = { 'X-Chat-Token': url.searchParams.get('token'), 'Content-Type': 'application/json' };
  const base = url.origin;
  assert.equal((await fetch(`${base}/api/bootstrap`)).status, 401);
  const bootstrap = await (await fetch(`${base}/api/bootstrap`, { headers })).json();
  assert.equal(bootstrap.desktop, 'windows');
  assert.ok(bootstrap.activeSessionId);
  for (const resource of ['/', '/app.js', '/flat-theme.css', '/vendor/markdown-it.min.js']) {
    assert.equal((await fetch(`${base}${resource}`)).status, 200, resource);
  }
  const created = await (await fetch(`${base}/api/sessions/create`, { method: 'POST', headers,
    body: JSON.stringify({ projectId: bootstrap.activeProject.id, title: 'Windows package smoke' }) })).json();
  assert.notEqual(created.activeSessionId, bootstrap.activeSessionId);
  console.log(JSON.stringify({ packagedWindowsBranch: 'pass', staticAssets: 'pass', authGate: 'pass', createSession: 'pass', realWindowsExecution: false }));
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  fs.rmSync(runtime, { recursive: true, force: true });
}
