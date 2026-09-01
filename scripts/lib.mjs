import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const runtimeDir = path.join(root, '.ai-team', 'runtime');
export const lastRunPath = path.join(runtimeDir, 'last-run.json');

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function git(args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function command(commandName, args = []) {
  return spawnSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
  });
}

export function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function requireCleanMain() {
  const branch = git(['branch', '--show-current']);
  if (branch !== 'main') {
    throw new Error(`Council must start on main; current branch is '${branch || '(detached)'}'.`);
  }
  const dirty = git(['status', '--porcelain=v1']);
  if (dirty) {
    throw new Error(`Commit or stash all changes before starting Council:\n${dirty}`);
  }
  git(['rev-parse', '--verify', 'HEAD']);
}

export function loadLastRun() {
  if (!fs.existsSync(lastRunPath)) {
    throw new Error('No Council run has been recorded yet.');
  }
  return readJson(lastRunPath);
}

export function compactReview(review) {
  return {
    councilId: review.councilId,
    status: review.status,
    rounds: review.rounds,
    planExists: review.planExists,
    changedFiles: review.changedFiles,
    branches: review.branches,
    worktrees: review.worktrees,
  };
}

