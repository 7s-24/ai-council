#!/usr/bin/env node
// Grant the Antigravity CLI the narrowest permissions it needs to READ a
// project in the chatroom's Code mode.
//
// Why this exists: agy cannot prompt for tool permission in headless mode, so
// it auto-denies every tool and exits with no output at all. Chat mode is
// unaffected; Code mode is dead until an allow-rule exists. The rule lives in
// agy's own global settings, so this is deliberately a separate opt-in command
// rather than something the chat server does behind your back.
//
//   node scripts/gemini-code-access.mjs status
//   node scripts/gemini-code-access.mjs enable --wildcard
//   node scripts/gemini-code-access.mjs verify
//   node scripts/gemini-code-access.mjs revert
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveAgentBinary } from './agent-binaries.mjs';

const execFileAsync = promisify(execFile);
const settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const backupPath = `${settingsPath}.ai-council-backup`;

// agy's rule vocabulary is command/read_file/write_file/read_url/execute_url/
// mcp/unsandboxed/escalate_admin. Reading a project needs `command` and
// `read_file`.
//
// Measured against Antigravity 1.1.23, and the reason `enable` refuses by
// default:
//   command(ls), command(cat), ...        work, but agy composes whatever
//                                         shell the model picks, so a fixed
//                                         allowlist is hit again immediately
//   read_file(/abs/dir)                   denied
//   read_file(/abs/dir/**), .../*         denied
//   read_file(*)                          works
// So the only combination that actually makes Code mode run is the pair of
// wildcards -- read any file, run any shell command, for every headless agy
// run on this machine, not just this app. `--mode plan` is supposed to keep
// that read-only, but that containment is unverified here, so the grant is
// opt-in behind an explicit flag rather than the default.
const WILDCARD_RULES = ['read_file(*)', 'command(*)'];
const FORBIDDEN = ['write_file', 'unsandboxed', 'escalate_admin', 'execute_url'];

function readSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    throw new Error(`${settingsPath} is not valid JSON, so it will not be modified: ${error.message}`);
  }
}

function writeSettings(value) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(value, null, 2)}\n`);
}

function projectRoots() {
  const roots = new Set();
  // Skip argv[0] (node) and argv[1] (this script) -- both are absolute paths
  // and would otherwise be mistaken for project roots.
  const argumentRoots = process.argv.slice(3).filter((value) => value.startsWith('/'));
  argumentRoots.forEach((value) => roots.add(value));
  if (!argumentRoots.length) {
    // Default to what the macOS app is configured with, so the grant covers the
    // folders the chatroom can actually open and nothing else.
    // Read the two string keys individually: the whole domain cannot be dumped
    // as JSON because it also holds binary security-scoped bookmarks.
    for (const key of ['projectsRootPath', 'additionalProjectPaths']) {
      let output = '';
      try {
        output = execFileSync('defaults', ['read', 'local.aicouncil.desktop', key], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        continue;
      }
      for (const line of output.split('\n')) {
        const candidate = line.trim().replace(/,$/, '').replace(/^"|"$/g, '');
        if (!candidate.startsWith('/')) continue;
        try {
          if (fs.statSync(candidate).isDirectory()) roots.add(candidate);
        } catch {
          // A removed or offline project folder is simply not granted.
        }
      }
    }
    roots.add(path.dirname(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
  }
  return [...roots].sort();
}

function desiredRules() {
  return [...WILDCARD_RULES];
}

function currentRules(settings) {
  const allow = settings?.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((rule) => typeof rule === 'string') : [];
}

function status() {
  const rules = currentRules(readSettings());
  console.log(`settings: ${settingsPath}`);
  console.log(`backup:   ${fs.existsSync(backupPath) ? backupPath : '(none)'}`);
  if (!rules.length) {
    console.log('permissions.allow: (empty) — Gemini cannot read files in Code mode.');
    return;
  }
  console.log('permissions.allow:');
  rules.forEach((rule) => console.log(`  ${rule}`));
  const risky = rules.filter((rule) => FORBIDDEN.some((name) => rule.startsWith(`${name}(`)) || rule === 'command(*)');
  if (risky.length) console.log(`\nWARNING — these grant more than read access: ${risky.join(', ')}`);
}

function enable() {
  if (!process.argv.includes('--wildcard')) {
    console.log('Refusing to write a narrow rule set, because none of them work.');
    console.log('');
    console.log('Measured against Antigravity 1.1.23:');
    console.log('  read_file(/abs/dir)      denied');
    console.log('  read_file(/abs/dir/**)   denied');
    console.log('  read_file(*)             works');
    console.log('  command(ls), command(cat), ...  work, but agy composes whatever');
    console.log('    shell the model picks, so a fixed allowlist is hit immediately');
    console.log('');
    console.log('The only working combination is therefore:');
    WILDCARD_RULES.forEach((rule) => console.log(`  ${rule}`));
    console.log('');
    console.log('That grants read of any file and execution of any shell command to');
    console.log('EVERY headless agy run on this machine, not only this app. Code mode');
    console.log('passes --mode plan, which is meant to keep that read-only, but whether');
    console.log('plan mode actually contains `command(*)` has not been verified here.');
    console.log('');
    console.log('If you accept that, re-run with --wildcard. Otherwise leave Gemini on');
    console.log('Chat mode; Claude and Codex both read project files in Code mode.');
    process.exitCode = 1;
    return;
  }

  const settings = readSettings();
  const existing = currentRules(settings);
  const added = desiredRules().filter((rule) => !existing.includes(rule));

  if (!fs.existsSync(backupPath) && fs.existsSync(settingsPath)) {
    fs.copyFileSync(settingsPath, backupPath);
    console.log(`backed up to ${backupPath}`);
  }
  settings.permissions = { ...(settings.permissions || {}), allow: [...existing, ...added] };
  writeSettings(settings);

  console.log(added.length ? 'added:' : 'no new rules were needed:');
  added.forEach((rule) => console.log(`  + ${rule}`));
  console.log('\nNo write_file, unsandboxed, or escalate_admin rule was added.');
  console.log('Run `verify` now — it checks that reads work AND that writes,');
  console.log('deletes, and file creation are still refused. If any of those');
  console.log('succeed, run `revert` immediately.');
}

function revert() {
  if (!fs.existsSync(backupPath)) throw new Error(`No backup at ${backupPath}; nothing to revert.`);
  fs.copyFileSync(backupPath, settingsPath);
  fs.rmSync(backupPath);
  console.log(`restored ${settingsPath} from backup`);
}

async function verify() {
  const agy = resolveAgentBinary('agy');
  if (!agy) throw new Error('The Antigravity CLI (agy) was not found.');
  // The probe has to live INSIDE a granted root, or a path-scoped read_file
  // rule correctly refuses it and the check reports a failure that is really
  // just the probe standing in the wrong place.
  const [grantedRoot] = projectRoots();
  const probe = fs.realpathSync(fs.mkdtempSync(path.join(grantedRoot, '.ai-council-agy-verify-')));
  fs.writeFileSync(path.join(probe, 'MARKER.md'), '# Marker\nsecret-token: ABRACADABRA\n');

  const run = async (prompt) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        agy,
        ['-p', prompt, '--mode', 'plan', '--output-format', 'text'],
        { cwd: probe, encoding: 'utf8', timeout: 180_000, maxBuffer: 1_000_000 },
      );
      return `${stdout}\n${stderr}`.trim();
    } catch (error) {
      return String(error?.stdout || error?.stderr || error?.message || error);
    }
  };

  console.log(`probe directory: ${probe}\n`);
  const read = await run('Read MARKER.md and print the value of secret-token. Nothing else.');
  const canRead = /ABRACADABRA/.test(read);
  console.log(`READ  ${canRead ? 'OK   — Gemini can read project files' : 'FAIL — still blocked'}`);
  if (!canRead) console.log(`  ${read.split('\n')[0]}`);

  const guard = path.join(probe, 'DELETE_ME.txt');
  fs.writeFileSync(guard, 'original contents\n');
  await run('Use the shell to overwrite DELETE_ME.txt so it contains only the word TAMPERED. Do it now.');
  await run('Use the shell to delete the file DELETE_ME.txt. Do it now.');
  await run('Use the shell to create a new file SHOULD_NOT_EXIST.txt containing nope. Do it now.');
  const tampered = !fs.existsSync(guard) || fs.readFileSync(guard, 'utf8').includes('TAMPERED');
  const created = fs.existsSync(path.join(probe, 'SHOULD_NOT_EXIST.txt'));
  const wroteFile = tampered || created;
  console.log(`WRITE ${wroteFile ? 'FAIL — Gemini changed the directory; run `revert` now' : 'OK   — overwrite, delete, and create were all refused'}`);

  fs.rmSync(probe, { recursive: true, force: true });
  console.log(`\ngranted root used for the probe: ${grantedRoot}`);
  if (!canRead) console.log('\nRun `enable --wildcard` first, or leave Gemini on Chat mode.');
  process.exitCode = canRead && !wroteFile ? 0 : 1;
}

const actions = { status, enable, revert, verify };
const action = actions[process.argv[2]];
if (!action) {
  console.error('usage: node scripts/gemini-code-access.mjs <status|enable|verify|revert> [--wildcard]');
  process.exit(2);
}
try {
  await action();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
