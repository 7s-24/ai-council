import { command, git } from './lib.mjs';
import { resolveAgentBinaries } from './agent-binaries.mjs';

const binaries = resolveAgentBinaries();
const missing = { status: 1, stdout: '', stderr: '', error: new Error('not installed') };

// Report against the same binaries the chatroom will actually run, so doctor
// cannot say a CLI is missing while the chatroom happily uses it.
function run(name, args) {
  return binaries[name] ? command(binaries[name], args) : missing;
}

const checks = [];

function record(name, result, detail) {
  const ok = result.status === 0;
  checks.push({ name, ok, detail: detail(result) });
}

// A CLI that is not installed leaves stdout and stderr null, so every detail
// reader has to survive that -- otherwise one missing tool aborts the report
// before the other tools are ever checked.
function firstLine(result) {
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (output) return output.split('\n')[0];
  return result.error ? result.error.message : 'not found';
}

const codexVersion = run('codex', ['--version']);
record('Codex CLI', codexVersion, firstLine);

const codexAuth = run('codex', ['login', 'status']);
record('Codex login', codexAuth, (r) =>
  r.status === 0 && /logged in/i.test(`${r.stdout}\n${r.stderr}`) ? 'signed in' : 'not confirmed',
);

const claudeVersion = run('claude', ['--version']);
record('Claude Code', claudeVersion, firstLine);

const claudeAuth = run('claude', ['auth', 'status']);
record('Claude login', claudeAuth, (r) => {
  try {
    const parsed = JSON.parse(r.stdout || '');
    return parsed.loggedIn ? 'signed in' : 'not signed in';
  } catch {
    return r.status === 0 ? 'signed in' : 'not confirmed';
  }
});

const agyVersion = run('agy', ['--version']);
record('Antigravity CLI', agyVersion, firstLine);

const agyModels = run('agy', ['models']);
record('Gemini access', agyModels, (r) =>
  r.status === 0 && /gemini-/i.test(r.stdout) ? 'signed in; Gemini models available' : 'not confirmed',
);

const clawVersion = command('clawo', ['--version']);
record('Claw Orchestrator', clawVersion, firstLine);

try {
  git(['rev-parse', '--is-inside-work-tree']);
  checks.push({ name: 'Git workspace', ok: true, detail: 'repository detected' });
} catch (error) {
  checks.push({ name: 'Git workspace', ok: false, detail: error.message });
}

for (const check of checks) {
  console.log(`${check.ok ? 'OK  ' : 'FAIL'} ${check.name}: ${check.detail}`);
}

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1;
}
