import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { cliInvocation, windowsTurn, turnEvent, WindowsChatManager } from './windows-agents.mjs';
import { resolveAgentBinary } from './agent-binaries.mjs';
import { psLiteral, encodedScript } from './windows-desktop.mjs';

function fixture(t) {
  const base = new URL('../.ai-team/audits/', import.meta.url);
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base.pathname, 'win-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Windows discovery finds native and npm executables even when PATH uses semicolons', (t) => {
  const root = fixture(t);
  const binary = path.join(root, 'claude.exe');
  fs.writeFileSync(binary, 'stub', { mode: 0o700 });
  assert.equal(resolveAgentBinary('claude', { PATH: `missing;${root}` }, 'win32'), binary);
  const cmd = path.join(root, 'codex.cmd');
  fs.writeFileSync(cmd, 'stub', { mode: 0o700 });
  assert.equal(resolveAgentBinary('codex', { Path: `"${root}"` }, 'win32'), cmd);
});

test('npm shims resolve their JS or EXE entrypoint and never use cmd.exe for prompts', (t) => {
  const root = fixture(t);
  const module = path.join(root, 'node_modules', 'provider');
  fs.mkdirSync(module, { recursive: true });
  fs.writeFileSync(path.join(module, 'cli.js'), '');
  fs.writeFileSync(path.join(module, 'cli.exe'), '');
  const shim = path.join(root, 'model.cmd');
  fs.writeFileSync(shim, 'IF EXIST "%dp0%\\node.exe"\n"%dp0%\\node_modules\\provider\\cli.js" %*');
  const prompt = 'quote " & %PATH% $(bad)\n你好';
  const call = cliInvocation(shim, ['-p', prompt], 'bundled-node.exe');
  assert.equal(call.command, 'bundled-node.exe');
  assert.deepEqual(call.args, [path.join(module, 'cli.js'), '-p', prompt]);
  fs.writeFileSync(shim, '"%dp0%\\node_modules\\provider\\cli.exe" %*');
  assert.equal(cliInvocation(shim, []).command, path.join(module, 'cli.exe'));
  fs.writeFileSync(shim, 'powershell.exe dangerous');
  assert.throws(() => cliInvocation(shim, []), /Unsupported/);
});

test('read-only Windows turns pass Claude and Codex prompts over stdin and retain permission flags', () => {
  for (const engine of ['claude', 'codex']) {
    const result = windowsTurn({ engine }, 'prompt\nwith "&"');
    assert.equal(result.stdin, 'prompt\nwith "&"');
    assert.equal(result.args.includes(result.stdin), false);
    assert.equal(result.args.includes(engine === 'claude' ? 'plan' : 'read-only'), true);
  }
  assert.throws(() => windowsTurn({ engine: 'agy' }, 'x'.repeat(20001)), /too long/);
});

test('native CLI event formats expose final responses and surface errors', () => {
  assert.equal(turnEvent({ type: 'result', result: 'answer' }, 'claude').final, 'answer');
  assert.equal(turnEvent({ type: 'result', is_error: true, result: 'not logged in' }, 'claude').error, 'not logged in');
  assert.equal(turnEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'answer' } }, 'codex').text, 'answer');
  assert.equal(turnEvent({ type: 'turn.failed', error: { message: 'auth failed' } }, 'codex').error, 'auth failed');
  assert.equal(turnEvent({ event: 'result', result: { status: 'SUCCESS', response: 'answer' } }, 'agy').final, 'answer');
});

test('Windows manager handles split JSON output and sends the literal prompt without a shell', async () => {
  let sent = '', invocation;
  const spawn = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on('data', (chunk) => { sent += chunk; });
    child.stdin.on('finish', () => {
      child.stdout.write('{"type":"item.completed","item":{"type":"agent_message",');
      child.stdout.end('"text":"Hello"}}\n');
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };
  const manager = new WindowsChatManager({ codex: 'codex.exe' }, spawn);
  await manager.startSession({ name: 'test', engine: 'codex', cwd: '.' });
  const result = await manager.sendMessage('test', '你好 & "literal"', { timeout: 1000 });
  assert.equal(result.output.trim(), 'Hello');
  assert.equal(sent, '你好 & "literal"');
  assert.equal(invocation.options.shell, false);
  await manager.stopSession('test');
});

test('PowerShell scripts quote filenames literally and encode Unicode correctly', () => {
  const value = "C:\\用户\\Bob's folder\\cli.exe";
  assert.equal(psLiteral(value), "'C:\\用户\\Bob''s folder\\cli.exe'");
  assert.equal(Buffer.from(encodedScript(value), 'base64').toString('utf16le'), value);
});
