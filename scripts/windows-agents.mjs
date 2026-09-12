import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import readline from 'node:readline';

// npm's Windows .cmd shims cannot be passed to spawn without cmd.exe. Resolve
// their JS entrypoint instead, so prompts never pass through a command shell.
export function cliInvocation(binary, args, node = process.execPath) {
  if (!binary) throw new Error('ENOENT: model CLI not found. Install it and restart AI Council.');
  if (!/\.(cmd|bat)$/i.test(binary)) return { command: binary, args };
  const shim = fs.readFileSync(binary, 'utf8');
  const match = [...shim.matchAll(/"%dp0%[\\/]([^"\r\n]+\.(?:c?js|mjs|exe))"/gi)]
    .find((candidate) => /^node_modules[\\/]/i.test(candidate[1]));
  if (!match) throw new Error('Unsupported CLI command shim. Install the native CLI or a standard npm installation.');
  const entry = path.resolve(path.dirname(binary), ...match[1].split(/[\\/]/));
  if (!entry.startsWith(`${path.resolve(path.dirname(binary))}${path.sep}`) || !fs.statSync(entry).isFile()) {
    throw new Error('Invalid npm CLI entrypoint.');
  }
  return /\.exe$/i.test(entry) ? { command: entry, args } : { command: node, args: [entry, ...args] };
}

export function windowsTurn(config, prompt) {
  if (config.engine === 'claude') {
    return { args: ['--safe-mode', '-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'plan', '--no-session-persistence',
      '--max-turns', String(config.maxTurns || 6), '--max-budget-usd', String(config.maxBudgetUsd || 0.2),
      ...(config.model ? ['--model', config.model] : [])], stdin: prompt };
  }
  if (config.engine === 'codex') {
    return { args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json',
      '--ignore-user-config', '--ephemeral', ...(config.model ? ['--model', config.model] : []), '-'], stdin: prompt };
  }
  // Native Antigravity is optional. Never substitute a different Gemini CLI,
  // whose flags and file access behavior are not the same protocol.
  if (config.engine === 'agy') {
    // agy accepts the prompt as an argument. Keep under Windows' command-line
    // limit and fail clearly rather than truncating the conversation silently.
    if (prompt.length > 20000) throw new Error('Gemini on Windows: conversation is too long for this CLI. Start a new session or use Claude/Codex.');
    return { args: ['-p', prompt, '--output-format', 'stream-json', '--mode', 'plan',
      ...(config.model ? ['--model', config.model] : [])], stdin: '' };
  }
  throw new Error('Unsupported model engine.');
}

export function turnEvent(event, engine) {
  if (engine === 'claude') {
    if (event.type === 'result') return { final: event.result || '', error: event.is_error ? (event.errors?.join('\n') || event.result || 'Claude failed') : '' };
    if (event.type === 'assistant') return { text: (event.message?.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n') };
  }
  if (engine === 'codex') {
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') return { text: event.item.text || '' };
    if (event.type === 'turn.failed' || event.type === 'error') return { error: event.error?.message || event.message || 'Codex failed' };
  }
  if (engine === 'agy' && event.event === 'result') {
    const result = event.result || {};
    return { final: result.response || '', error: result.error || (result.status && result.status !== 'SUCCESS' ? result.status : '') };
  }
  return {};
}

function stopTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
  } else child.kill('SIGTERM');
}

export class WindowsChatManager {
  constructor(binaries, spawnProcess = spawn) { this.binaries = binaries; this.spawn = spawnProcess; this.sessions = new Map(); }
  async startSession(config) { this.sessions.set(config.name, { config, child: null }); }
  async stopSession(name) { const session = this.sessions.get(name); stopTree(session?.child); this.sessions.delete(name); }
  async sendMessage(name, prompt, callbacks = {}) {
    const session = this.sessions.get(name);
    if (!session) throw new Error('Unknown model session.');
    const { config } = session;
    const turn = windowsTurn(config, prompt);
    const invocation = cliInvocation(this.binaries[config.engine], turn.args);
    return new Promise((resolve, reject) => {
      const child = this.spawn(invocation.command, invocation.args, { cwd: config.cwd, env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
      session.child = child;
      let output = '', final = null, error = '', stderr = '', bytes = 0, settled = false;
      const finish = (failure) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (failure) { stopTree(child); reject(failure); } else resolve({ output: final || output });
      };
      const timer = setTimeout(() => finish(new Error('Timeout waiting for model response')), callbacks.timeout || 300000);
      child.on('error', (error) => finish(error));
      child.stdin.on('error', () => {});
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        if (settled) return;
        bytes += Buffer.byteLength(line);
        if (bytes > 8_000_000) { finish(new Error('Model output exceeded the size limit.')); return; }
        let event; try { event = JSON.parse(line); } catch { return; }
        const parsed = turnEvent(event, config.engine);
        if (parsed.error) error = parsed.error;
        if (parsed.final !== undefined) final = parsed.final;
        if (parsed.text) { output += `${parsed.text}\n`; callbacks.onChunk?.(parsed.text); }
        callbacks.onEvent?.(event);
      });
      child.on('close', (code) => finish(code !== 0 || error ? new Error(error || stderr || `Model exited with code ${code}`) : null));
      child.stdin.end(turn.stdin);
    });
  }
}
