import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A CLI being absent from PATH does not mean it is absent from the machine.
// Codex, in particular, ships inside the ChatGPT desktop app and is fully
// signed in there while `which codex` finds nothing -- and the macOS app runs
// with its own trimmed PATH, so this matters more here than in a terminal.
const KNOWN_LOCATIONS = {
  claude: [
    '~/.local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ],
  codex: [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '~/Applications/ChatGPT.app/Contents/Resources/codex',
    '~/.codex/plugins/.plugin-appserver/codex',
    '~/.local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ],
  agy: [
    '~/.local/bin/agy',
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ],
};

export const AGENT_BINARIES = Object.keys(KNOWN_LOCATIONS);

function expandHome(value) {
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function isExecutable(file) {
  try {
    return fs.statSync(file).isFile() && fs.accessSync(file, fs.constants.X_OK) === undefined;
  } catch {
    return false;
  }
}

function fromPath(name, searchPath, platform = process.platform) {
  for (const directory of String(searchPath || '').split(platform === 'win32' ? ';' : path.delimiter)) {
    if (!directory) continue;
    for (const suffix of platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']) {
      const candidate = path.join(directory.replace(/^"|"$/g, ''), `${name}${suffix}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return '';
}

/**
 * Absolute path to a model CLI, or '' when it really is not installed.
 * An explicit <NAME>_BIN environment variable always wins.
 */
export function resolveAgentBinary(name, environment = process.env, platform = process.platform) {
  const override = environment[`${name.toUpperCase()}_BIN`];
  if (override && isExecutable(override)) return override;
  const onPath = fromPath(name, environment.PATH || environment.Path, platform);
  if (onPath) return onPath;
  if (platform === 'win32') {
    const home = environment.USERPROFILE || os.homedir();
    const locations = [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')];
    if (environment.APPDATA) locations.push(path.join(environment.APPDATA, 'npm'));
    return locations.map((directory) => fromPath(name, directory, platform)).find(Boolean) || '';
  }
  return (KNOWN_LOCATIONS[name] || []).map(expandHome).find(isExecutable) || '';
}

export function resolveAgentBinaries(environment = process.env) {
  return Object.fromEntries(AGENT_BINARIES.map((name) => [name, resolveAgentBinary(name, environment)]));
}

/** Directories to prepend to PATH so child processes find what we found. */
export function agentBinaryDirectories(environment = process.env) {
  const directories = [];
  for (const binary of Object.values(resolveAgentBinaries(environment))) {
    if (!binary) continue;
    const directory = path.dirname(binary);
    if (!directories.includes(directory)) directories.push(directory);
  }
  return directories;
}
