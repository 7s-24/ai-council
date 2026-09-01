import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './lib.mjs';

export const artifactsRoot = path.join(root, 'artifacts');
export const chatRuntimeRoot = path.join(root, '.ai-team', 'chat', 'runtime');

const MAX_FILES = 12;
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 500_000;
const MAX_ARTIFACT_BYTES = 250_000;
const MAX_PROPOSALS = 4;

const readableExtensions = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const artifactExtensions = new Set(['.csv', '.json', '.md', '.txt', '.yaml', '.yml']);
const deniedDirectories = new Set(['.git', '.worktrees', 'node_modules']);
const deniedPrefixes = ['.ai-team/chat/runtime/', '.ai-team/runtime/'];
const sensitiveDirectories = new Set(['.aws', '.gnupg', '.ssh']);

function hasSensitiveName(relativePath) {
  const lower = relativePath.toLowerCase();
  const base = path.posix.basename(lower);
  const parts = lower.split('/');
  return (
    parts.some((part) => sensitiveDirectories.has(part)) ||
    base === '.env' ||
    base.startsWith('.env.') ||
    ['.git-credentials', '.netrc', '.npmrc', '.pypirc', 'credentials', 'cookies', 'id_rsa', 'id_ed25519'].includes(base) ||
    /^(?:client[_-]?secret|credentials|secrets?)(?:\.|-|_)/.test(base) ||
    /^(?:auth|tokens?)\.json$/.test(base) ||
    ['.key', '.kdbx', '.p12', '.pem', '.pfx'].some((extension) => base.endsWith(extension))
  );
}

function normalizeRepositoryPath(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid file path.');
  const slashed = value.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:\//.test(slashed)) throw new Error('Absolute paths are not allowed.');
  const normalized = path.posix.normalize(slashed).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Path traversal is not allowed.');
  }
  return normalized;
}

export function isReadableRelativePath(value) {
  let relativePath;
  try {
    relativePath = normalizeRepositoryPath(value);
  } catch {
    return false;
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => deniedDirectories.has(part))) return false;
  if (deniedPrefixes.some((prefix) => relativePath.startsWith(prefix))) return false;
  if (hasSensitiveName(relativePath)) return false;
  const extension = path.posix.extname(relativePath).toLowerCase();
  return readableExtensions.has(extension) || ['LICENSE', 'Makefile'].includes(path.posix.basename(relativePath));
}

export function listReadableFiles() {
  const files = [];
  const stack = [{ absolute: root, relative: '' }];

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current.absolute, { withFileTypes: true });
    for (const entry of entries) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (deniedDirectories.has(entry.name) || deniedPrefixes.some((prefix) => `${relative}/`.startsWith(prefix))) {
          continue;
        }
        stack.push({ absolute: path.join(current.absolute, entry.name), relative });
        continue;
      }
      if (!entry.isFile() || !isReadableRelativePath(relative)) continue;
      const stat = fs.statSync(path.join(current.absolute, entry.name));
      if (stat.size <= MAX_FILE_BYTES) files.push({ path: relative, size: stat.size });
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function readSelectedFiles(values) {
  if (!Array.isArray(values)) throw new Error('files must be an array.');
  const unique = [...new Set(values)];
  if (unique.length > MAX_FILES) throw new Error(`Select at most ${MAX_FILES} files.`);

  let totalBytes = 0;
  return unique.map((value) => {
    const relativePath = normalizeRepositoryPath(value);
    if (!isReadableRelativePath(relativePath)) throw new Error(`File is not readable by policy: ${relativePath}`);
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('Path escaped the repository.');
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${relativePath}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File is too large: ${relativePath}`);
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Selected files exceed the total size limit.');
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (content.includes('\0')) throw new Error(`Binary content is not allowed: ${relativePath}`);
    return { path: relativePath, size: stat.size, content };
  });
}

export function normalizeArtifactPath(value) {
  const relativePath = normalizeRepositoryPath(value);
  if (!relativePath.startsWith('artifacts/')) throw new Error('Artifacts must be inside artifacts/.');
  if (relativePath === 'artifacts/.gitkeep') throw new Error('The placeholder file cannot be modified.');
  if (relativePath.split('/').slice(1).some((part) => part.startsWith('.'))) {
    throw new Error('Hidden artifact paths are not allowed.');
  }
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!artifactExtensions.has(extension)) throw new Error('Artifact type is not allowed.');
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${artifactsRoot}${path.sep}`)) throw new Error('Artifact path escaped artifacts/.');
  return { relativePath, absolutePath };
}

export function validateArtifactContent(value) {
  if (typeof value !== 'string') throw new Error('Artifact content must be text.');
  if (Buffer.byteLength(value, 'utf8') > MAX_ARTIFACT_BYTES) throw new Error('Artifact content is too large.');
  if (value.includes('\0')) throw new Error('Binary artifact content is not allowed.');
  return value;
}

export function contentHash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function extractArtifactProposals(output, registry = {}) {
  const proposals = [];
  const expression = /<artifact\s+path="([^"]+)">\s*([\s\S]*?)\s*<\/artifact>/gi;
  let match;
  while ((match = expression.exec(String(output))) && proposals.length < MAX_PROPOSALS) {
    try {
      const { relativePath, absolutePath } = normalizeArtifactPath(match[1]);
      const content = validateArtifactContent(match[2]);
      const exists = fs.existsSync(absolutePath);
      const registered = Boolean(registry[relativePath]);
      if (exists && !registered) {
        proposals.push({ path: relativePath, content, rejected: true, reason: 'Existing file is not chatroom-managed.' });
        continue;
      }
      if (exists) {
        const stat = fs.lstatSync(absolutePath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          proposals.push({ path: relativePath, content, rejected: true, reason: 'Artifact target is not a regular file.' });
          continue;
        }
      }
      const current = exists ? fs.readFileSync(absolutePath, 'utf8') : null;
      proposals.push({
        id: crypto.randomUUID(),
        path: relativePath,
        content,
        operation: exists ? 'update' : 'create',
        baseHash: current === null ? null : contentHash(current),
      });
    } catch (error) {
      proposals.push({ path: match[1], content: match[2], rejected: true, reason: error.message });
    }
  }
  return proposals;
}
