import { command, git } from './lib.mjs';

const checks = [];

function record(name, result, detail) {
  const ok = result.status === 0;
  checks.push({ name, ok, detail: detail(result) });
}

const codexVersion = command('codex', ['--version']);
record('Codex CLI', codexVersion, (r) => (r.stdout || r.stderr).trim().split('\n')[0]);

const codexAuth = command('codex', ['login', 'status']);
record('Codex login', codexAuth, (r) =>
  r.status === 0 && /logged in/i.test(`${r.stdout}\n${r.stderr}`) ? 'signed in' : 'not confirmed',
);

const claudeVersion = command('claude', ['--version']);
record('Claude Code', claudeVersion, (r) => (r.stdout || r.stderr).trim().split('\n')[0]);

const claudeAuth = command('claude', ['auth', 'status']);
record('Claude login', claudeAuth, (r) => {
  try {
    const parsed = JSON.parse(r.stdout);
    return parsed.loggedIn ? 'signed in' : 'not signed in';
  } catch {
    return r.status === 0 ? 'signed in' : 'not confirmed';
  }
});

const agyVersion = command('agy', ['--version']);
record('Antigravity CLI', agyVersion, (r) => (r.stdout || r.stderr).trim().split('\n')[0]);

const agyModels = command('agy', ['models']);
record('Gemini access', agyModels, (r) =>
  r.status === 0 && /gemini-/i.test(r.stdout) ? 'signed in; Gemini models available' : 'not confirmed',
);

const clawVersion = command('clawo', ['--version']);
record('Claw Orchestrator', clawVersion, (r) => (r.stdout || r.stderr).trim().split('\n')[0]);

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
