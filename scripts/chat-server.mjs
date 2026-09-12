import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { WindowsChatManager, cliInvocation } from './windows-agents.mjs';
import { pickWindowsFolder, openWindowsLogin, openWindowsBrowser } from './windows-desktop.mjs';
import { root as hostRoot } from './lib.mjs';
import {
  chatRuntimeRoot,
  contentHash,
  extractArtifactProposals,
  normalizeArtifactPath,
  validateArtifactContent,
} from './chat-policy.mjs';
import {
  extractReasoningSummary,
  MAX_ROUTE_TURNS,
  normalizeRoute,
  parseMentionOrder,
  stripArtifactBlocks,
} from './chat-protocol.mjs';
import { buildAgentPrompt } from './chat-prompt.mjs';
import { createTurnProgress, describeToolEvent } from './chat-progress.mjs';
import {
  emptyChatSettings,
  normalizeChatSettings,
  normalizeUISettings,
  parseAgyModelOutput,
  resolveAgyModel,
} from './chat-settings.mjs';
import { discoverProjects, publicProject } from './project-catalog.mjs';
import { resolveAgentBinaries } from './agent-binaries.mjs';
import {
  isSessionId,
  makeSessionId,
  MAX_SESSIONS_PER_PROJECT,
  normalizeSessionIndex,
  normalizeSessionTitle,
  publicSession,
  sortSessions,
  summarizeTranscript,
} from './chat-sessions.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;
const BODY_LIMIT = 1_000_000;
const MESSAGE_LIMIT = 12_000;
const HISTORY_LIMIT = 16;
const HISTORY_CHARACTER_LIMIT = 48_000;
// Progress lines are cosmetic; coalesce them so a chatty engine cannot flood
// the response stream.
const PROGRESS_INTERVAL_MS = 250;
// Chat mode answers from the prompt alone. Code mode has to list the project,
// read files, and only then answer -- three turns is not even enough for the
// model to finish saying "let me look", so the answer never arrives.
const TURN_LIMITS = {
  chat: { maxTurns: 6, maxBudgetUsd: 0.2 },
  code: { maxTurns: 24, maxBudgetUsd: 1 },
};
const PUBLIC_DIR = path.join(hostRoot, 'public');
const execFilePromise = promisify(execFile);
function execFileAsync(binary, args, options) {
  const invocation = process.platform === 'win32' ? cliInvocation(binary, args) : { command: binary, args };
  return execFilePromise(invocation.command, invocation.args, { ...options, windowsHide: true });
}
const agyModelsCachePath = path.join(chatRuntimeRoot, 'agy-models.json');

// Resolve every model CLI once, then hand the answers to the orchestrator and
// to our own probes through the environment it already reads.
const agentBinaries = resolveAgentBinaries();
if (agentBinaries.codex) process.env.CODEX_BIN = agentBinaries.codex;
if (agentBinaries.agy) process.env.AGY_BIN = agentBinaries.agy;
if (agentBinaries.claude) process.env.CLAUDE_BIN = agentBinaries.claude;

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function cachedAgyModels() {
  const cached = loadJson(agyModelsCachePath, {});
  return Array.isArray(cached.models)
    ? cached.models.filter((value) => /^gemini-[A-Za-z0-9.-]+$/.test(value))
    : [];
}

const modelOptions = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-5.5'],
  gemini: cachedAgyModels(),
};
const agentHealth = { claude: 'unknown', codex: 'unknown', gemini: 'unknown' };
let healthRefreshPromise = null;

async function refreshAgyModels() {
  if (!agentBinaries.agy) {
    agentHealth.gemini = 'error';
    return;
  }
  try {
    const { stdout } = await execFileAsync(agentBinaries.agy, ['models'], {
      cwd: hostRoot,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 1_000_000,
    });
    const models = parseAgyModelOutput(stdout);
    if (!models.length) {
      agentHealth.gemini = 'error';
      return;
    }
    modelOptions.gemini = models;
    agentHealth.gemini = 'ready';
    saveJson(agyModelsCachePath, { updatedAt: new Date().toISOString(), models });
  } catch {
    agentHealth.gemini = 'error';
    // Model discovery is advisory; never hold up the local UI on it.
  }
}

async function probeLogin(command, args, matcher) {
  if (!command) return 'error';
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: hostRoot,
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: 200_000,
    });
    return matcher(`${stdout}\n${stderr}`) ? 'ready' : 'error';
  } catch {
    return 'error';
  }
}

function refreshAgentHealth() {
  if (healthRefreshPromise) return healthRefreshPromise;
  healthRefreshPromise = Promise.all([
    probeLogin(agentBinaries.claude, ['auth', 'status'], (output) => /"loggedIn"\s*:\s*true/i.test(output))
      .then((value) => { agentHealth.claude = value; }),
    probeLogin(agentBinaries.codex, ['login', 'status'], (output) => /logged in/i.test(output))
      .then((value) => { agentHealth.codex = value; }),
    refreshAgyModels(),
  ]).finally(() => { healthRefreshPromise = null; });
  return healthRefreshPromise;
}

const AGENT_COMMANDS = { claude: 'claude', codex: 'codex', gemini: 'agy' };

// Only rewrite a failure when the cause is known. Anything else -- an
// unsupported CLI flag, a crash, a timeout -- must reach the user verbatim, or
// they are sent chasing a problem the message never names.
function readableAgentError(key, error, language = 'zh') {
  const message = error instanceof Error ? error.message : String(error || 'Agent failed.');
  const isEnglish = language === 'en';

  if (/\bENOENT\b/.test(message)) {
    const binary = AGENT_COMMANDS[key] || key;
    return isEnglish
      ? `The ${agents[key]?.label || key} CLI (\`${binary}\`) is not installed, or is not on the PATH this app was launched with. Install it and restart the local service.`
      : `找不到 ${agents[key]?.label || key} 的命令行工具（\`${binary}\`）：未安装，或不在本 App 启动时的 PATH 中。安装后重启本地服务即可。`;
  }

  // agy auto-denies every tool permission in headless mode and then exits with
  // no output at all, so an empty Gemini turn in Code mode is almost always
  // this and not a transient hiccup.
  if (key === 'gemini' && /returned an empty response/i.test(message)) {
    return isEnglish
      ? 'Gemini produced no output. In Code mode the Antigravity CLI needs to read files, but headless runs cannot prompt for tool permission and auto-deny it. Add a read-only allow-rule (for example `read_file(<folder>)`) under `permissions.allow` in ~/.gemini/antigravity-cli/settings.json, or ask Gemini in Chat mode, which needs no file access.'
      : 'Gemini 没有产生任何输出。Code 模式下 Antigravity CLI 需要读取文件，但无人值守运行时它无法弹出授权提示，会自动拒绝并静默退出。可在 ~/.gemini/antigravity-cli/settings.json 的 `permissions.allow` 中加入只读规则（例如 `read_file(<目录>)`），或改用不需要读文件的 Chat 模式提问。';
  }

  const signedOut = /not signed in|not logged in|please run \/login|invalid api key|oauth token (?:has )?expired|authentication (?:failed|required|error)|401 unauthorized/i;
  if (!signedOut.test(message)) return message;

  if (key === 'claude') {
    return isEnglish
      ? 'Claude is signed out. Open Settings → Models and choose “Sign in again”, then retry.'
      : 'Claude 登录已失效。请打开“设置 → 模型”，点击“重新登录”，完成后重试。';
  }
  if (key === 'codex') {
    return isEnglish
      ? 'Codex is signed out. Open Settings → Models and choose “Sign in again”, then retry.'
      : 'Codex 登录已失效。请打开“设置 → 模型”，点击“重新登录”，完成后重试。';
  }
  return isEnglish
    ? 'Gemini’s Google authorization expired. Open Settings → Models and choose “Sign in again”, then retry.'
    : 'Gemini 的 Google 授权已过期。请打开“设置 → 模型”，点击“重新登录”，完成后重试。';
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argumentValues(name) {
  return process.argv.flatMap((value, index) => (
    value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
  ));
}

const requestedPort = Number.parseInt(argument('--port', String(DEFAULT_PORT)), 10);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error('Invalid --port value.');
}

const accessToken = argument('--token', crypto.randomBytes(24).toString('base64url'));
const accessTokenBuffer = Buffer.from(accessToken, 'utf8');
const requestedReadyFile = argument('--ready-file', '');
let readyFile = '';
if (requestedReadyFile) {
  const candidate = path.resolve(requestedReadyFile);
  const candidateParent = fs.realpathSync(path.dirname(candidate));
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if ((candidateParent !== temporaryRoot && !candidateParent.startsWith(`${temporaryRoot}${path.sep}`))
    || !/^ai-council-ready-[A-Za-z0-9-]+\.json$/.test(path.basename(candidate))) {
    throw new Error('Invalid --ready-file value.');
  }
  readyFile = candidate;
}
// `--room-id` is the pre-session name for the same thing; both still work.
const requestedSessionId = argument('--session-id', argument('--room-id', ''));
if (requestedSessionId && !isSessionId(requestedSessionId)) throw new Error('Invalid --session-id value.');
const requestedProjectsRoot = path.resolve(argument('--projects-root', path.dirname(hostRoot)));
if (!fs.existsSync(requestedProjectsRoot) || !fs.statSync(requestedProjectsRoot).isDirectory()) {
  throw new Error('Invalid --projects-root value.');
}
const windowsProjectsPath = path.join(chatRuntimeRoot, 'windows-projects.json');
const savedWindowsProjects = process.platform === 'win32' ? loadJson(windowsProjectsPath, []) : [];
const requestedProjectPaths = [...argumentValues('--project-path'), ...(Array.isArray(savedWindowsProjects) ? savedWindowsProjects.filter((p) => typeof p === 'string') : [])].map((value) => path.resolve(value));
const projects = discoverProjects(requestedProjectsRoot, hostRoot, requestedProjectPaths);
const projectSelectionPath = path.join(chatRuntimeRoot, 'project-selection.json');
const savedProjectId = loadJson(projectSelectionPath, {}).projectId;
let defaultProject = projects.find((project) => project.id === savedProjectId)
  || projects.find((project) => project.path === fs.realpathSync(hostRoot))
  || projects[0];
if (!defaultProject) throw new Error('No projects are available.');

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-council-${process.pid}-`));
const settingsPath = path.join(chatRuntimeRoot, 'settings.json');
const uiSettingsPath = path.join(chatRuntimeRoot, 'ui.json');

fs.writeFileSync(
  path.join(sandboxDir, 'BOUNDARY.txt'),
  'This directory intentionally contains no project files. File evidence is embedded in each chat prompt.\n',
);

const manager = process.platform === 'win32' ? new WindowsChatManager(agentBinaries)
  : new (await import('@enderfga/claw-orchestrator')).SessionManager({
  // Claude Code's --bare mode intentionally ignores subscription OAuth. This
  // wrapper uses --safe-mode instead: OAuth remains available while user/project
  // customizations, MCP servers, hooks, skills, and CLAUDE.md are disabled.
  claudeBin: path.join(hostRoot, 'scripts', 'claude-review-wrapper.sh'),
});
const activeSessions = new Set();
// One chat session answers one turn at a time; separate sessions -- including
// sessions open in separate windows -- run concurrently.
const busySessions = new Set();
let turnCounter = 0;

const agents = {
  claude: {
    label: 'Claude',
    engine: 'claude',
    config: {
      permissionMode: 'manual',
      // Maps to `--permission-mode plan` for Claude, which is the read-only
      // boundary this room needs. Do not add `restricted: true` on top: the
      // orchestrator turns that into `--restricted`, which the Claude CLI does
      // not accept, and every turn dies before the model is ever reached.
      sandboxMode: 'read-only',
      noSessionPersistence: true,
    },
  },
  codex: {
    label: 'Codex',
    engine: 'codex',
    config: {
      permissionMode: 'manual',
      sandboxMode: 'read-only',
      ignoreUserConfig: true,
      noSessionPersistence: true,
    },
  },
  gemini: {
    label: 'Gemini',
    engine: 'agy',
    config: {
      permissionMode: 'manual',
      sandboxMode: 'read-only',
      noSessionPersistence: true,
    },
  },
};

function projectRuntimeRoot(project) {
  if (project.path === fs.realpathSync(hostRoot)) return chatRuntimeRoot;
  return path.join(chatRuntimeRoot, 'projects', project.id);
}

function projectRegistryPath(project) {
  return path.join(projectRuntimeRoot(project), 'artifact-registry.json');
}

function sessionIndexPath(project) {
  return path.join(projectRuntimeRoot(project), 'sessions.json');
}

function sessionDirectory(project, sessionId) {
  if (!isSessionId(sessionId)) throw new Error('Invalid chat session id.');
  return path.join(projectRuntimeRoot(project), sessionId);
}

function transcriptPathFor(project, sessionId) {
  return path.join(sessionDirectory(project, sessionId), 'transcript.json');
}

function readTranscript(project, sessionId) {
  const stored = loadJson(transcriptPathFor(project, sessionId), []);
  return Array.isArray(stored) ? stored : [];
}

// Sessions live on disk, so every window and every restart sees the same list.
// Directories left by earlier single-room builds are adopted on first read.
function readSessionIndex(project) {
  const entries = normalizeSessionIndex(loadJson(sessionIndexPath(project), {}));
  const runtimeRoot = projectRuntimeRoot(project);
  let dirty = false;
  let names = [];
  try {
    names = fs.readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && isSessionId(entry.name))
      .map((entry) => entry.name);
  } catch {
    // A project with no chat history yet simply has no runtime directory.
  }
  for (const id of names) {
    if (entries.has(id)) continue;
    if (!fs.existsSync(transcriptPathFor(project, id))) continue;
    entries.set(id, { id, title: null, messages: null, createdAt: null, updatedAt: null });
    dirty = true;
  }
  for (const [id, entry] of entries) {
    if (!fs.existsSync(transcriptPathFor(project, id))) {
      entries.delete(id);
      dirty = true;
      continue;
    }
    if (entry.title !== null && entry.messages !== null) continue;
    const transcript = readTranscript(project, id);
    const summary = summarizeTranscript(transcript);
    entries.set(id, {
      ...entry,
      title: entry.title ?? summary.title,
      messages: summary.messages,
      createdAt: entry.createdAt || transcript[0]?.createdAt || null,
      updatedAt: entry.updatedAt || summary.updatedAt,
    });
    dirty = true;
  }
  return { entries, dirty };
}

function writeSessionIndex(project, entries) {
  saveJson(sessionIndexPath(project), { sessions: sortSessions([...entries.values()]) });
}

function listSessions(project) {
  const { entries, dirty } = readSessionIndex(project);
  if (dirty) writeSessionIndex(project, entries);
  return sortSessions([...entries.values()]).map(publicSession);
}

function createSession(project, { id = null, title = '' } = {}) {
  const { entries } = readSessionIndex(project);
  if (entries.size >= MAX_SESSIONS_PER_PROJECT) {
    throw new Error(`This project already has ${MAX_SESSIONS_PER_PROJECT} chat sessions; delete one first.`);
  }
  let sessionId = id && isSessionId(id) && !entries.has(id) ? id : makeSessionId();
  while (entries.has(sessionId)) sessionId = makeSessionId();
  const now = new Date().toISOString();
  saveJson(transcriptPathFor(project, sessionId), []);
  entries.set(sessionId, {
    id: sessionId,
    title: normalizeSessionTitle(title),
    messages: 0,
    createdAt: now,
    updatedAt: now,
  });
  writeSessionIndex(project, entries);
  return sessionId;
}

function resolveProject(projectId) {
  if (projectId === undefined || projectId === null || projectId === '') return defaultProject;
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error('Unknown project.');
  return project;
}

// Pin to the requested session when it exists, otherwise fall back to the most
// recent one, and only create when the project has no history at all.
function resolveSession(project, sessionId, { create = false } = {}) {
  const { entries } = readSessionIndex(project);
  if (sessionId) {
    if (!isSessionId(sessionId)) throw new Error('Invalid chat session id.');
    if (entries.has(sessionId)) return sessionId;
    if (!create) throw new Error('Unknown chat session.');
    return createSession(project, { id: sessionId });
  }
  const [latest] = sortSessions([...entries.values()]);
  if (latest) return latest.id;
  return createSession(project);
}

function renameSession(project, sessionId, title) {
  const { entries } = readSessionIndex(project);
  const entry = entries.get(sessionId);
  if (!entry) throw new Error('Unknown chat session.');
  entries.set(sessionId, { ...entry, title: normalizeSessionTitle(title) });
  writeSessionIndex(project, entries);
}

function deleteSession(project, sessionId) {
  const { entries } = readSessionIndex(project);
  if (!entries.has(sessionId)) throw new Error('Unknown chat session.');
  if (busySessions.has(sessionLockKey(project, sessionId))) {
    throw new Error('Wait for the current reply before deleting this chat session.');
  }
  const directory = sessionDirectory(project, sessionId);
  const runtimeRoot = projectRuntimeRoot(project);
  if (path.dirname(directory) !== runtimeRoot) throw new Error('Chat session path escaped the runtime directory.');
  fs.rmSync(directory, { recursive: true, force: true });
  entries.delete(sessionId);
  writeSessionIndex(project, entries);
}

function sessionLockKey(project, sessionId) {
  return `${project.id}:${sessionId}`;
}

function appendTranscript(project, sessionId, items) {
  const transcript = [...readTranscript(project, sessionId), ...items];
  saveJson(transcriptPathFor(project, sessionId), transcript);
  const { entries } = readSessionIndex(project);
  const entry = entries.get(sessionId);
  if (entry) {
    const summary = summarizeTranscript(transcript);
    entries.set(sessionId, {
      ...entry,
      title: entry.title || summary.title,
      messages: summary.messages,
      updatedAt: summary.updatedAt || entry.updatedAt,
    });
    writeSessionIndex(project, entries);
  }
  return transcript;
}

function pendingProposals(project, sessionId) {
  return readTranscript(project, sessionId).flatMap((item) => (
    (item.proposals || []).filter((proposal) => !proposal.appliedAt)
      .map((proposal) => ({ ...proposal, agent: item.agent }))
  ));
}

function sessionPayload(project, sessionId) {
  return {
    activeProject: publicProject(project),
    activeSessionId: sessionId,
    sessions: listSessions(project),
    transcript: readTranscript(project, sessionId),
    proposals: pendingProposals(project, sessionId),
    artifacts: listArtifacts(project),
  };
}

function loadChatSettings() {
  try {
    const settings = normalizeChatSettings(loadJson(settingsPath, emptyChatSettings()));
    const configured = settings.agents.gemini.model;
    if (configured && modelOptions.gemini.length) {
      const resolved = resolveAgyModel(configured, modelOptions.gemini);
      if (resolved !== configured) {
        settings.agents.gemini.model = resolved;
        saveJson(settingsPath, settings);
      }
    }
    return settings;
  } catch {
    return emptyChatSettings();
  }
}

let chatSettings = loadChatSettings();

function updateChatSettings(value) {
  chatSettings = normalizeChatSettings(value);
  if (chatSettings.agents.gemini.model && modelOptions.gemini.length) {
    chatSettings.agents.gemini.model = resolveAgyModel(
      chatSettings.agents.gemini.model,
      modelOptions.gemini,
    );
  }
  saveJson(settingsPath, chatSettings);
  return chatSettings;
}

let uiSettings = normalizeUISettings(loadJson(uiSettingsPath, {}));

function updateUISettings(value) {
  uiSettings = normalizeUISettings(value);
  saveJson(uiSettingsPath, uiSettings);
  return uiSettings;
}

function artifactRegistry(project) {
  return loadJson(projectRegistryPath(project), {});
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function apiAuthorized(req) {
  const provided = req.headers['x-chat-token'];
  if (typeof provided !== 'string') return false;
  const candidate = Buffer.from(provided, 'utf8');
  return candidate.length === accessTokenBuffer.length
    && crypto.timingSafeEqual(candidate, accessTokenBuffer);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function recentHistory(transcript) {
  const selected = transcript.slice(-HISTORY_LIMIT);
  let remaining = HISTORY_CHARACTER_LIMIT;
  const lines = [];
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const item = selected[index];
    const label = item.role === 'user' ? 'Human' : item.agent;
    const value = `${label}: ${item.content}`;
    if (value.length > remaining) continue;
    lines.unshift(value);
    remaining -= value.length;
  }
  return lines.join('\n\n');
}

function streamHandlers(key, label, onProgress) {
  const progress = createTurnProgress();
  let lastSentAt = 0;
  let lastPayload = '';

  const send = (payload, force = false) => {
    const serialized = JSON.stringify(payload);
    if (serialized === lastPayload) return;
    const now = Date.now();
    if (!force && now - lastSentAt < PROGRESS_INTERVAL_MS) return;
    lastSentAt = now;
    lastPayload = serialized;
    onProgress({ type: 'progress', key, agent: label, ...payload });
  };

  return {
    onChunk: (chunk) => {
      const snapshot = progress.addChunk(chunk);
      if (snapshot.phase === 'starting') return;
      send({ phase: snapshot.phase, reasoning: snapshot.reasoning });
    },
    onEvent: (event) => {
      const tool = describeToolEvent(event);
      // A tool call is the most informative thing that can happen during a long
      // turn, so it is never dropped by the throttle.
      if (tool) send({ phase: 'tool', tool: tool.tool, detail: tool.detail }, true);
    },
  };
}

async function askAgent(key, { message, files, mode, roomHistory, relayTurns = [], turn, project, sessionId, onProgress }) {
  const agent = agents[key];
  const preference = chatSettings.agents[key];
  const selectedModel = key === 'gemini'
    ? resolveAgyModel(preference.model, modelOptions.gemini)
    : preference.model;
  const sessionName = `review-chat-${sessionId}-${project.id}-${key}-${turnCounter += 1}`;
  const startedAt = Date.now();
  activeSessions.add(sessionName);
  try {
    await manager.startSession({
      name: sessionName,
      cwd: mode === 'code' ? project.path : sandboxDir,
      engine: agent.engine,
      ...agent.config,
      ...(TURN_LIMITS[mode] || TURN_LIMITS.chat),
      ...(selectedModel ? { model: selectedModel } : {}),
    });
    const result = await manager.sendMessage(sessionName, buildAgentPrompt({
      message,
      files,
      mode,
      roomHistory,
      relayTurns,
      presetPrompt: preference.prompt,
      turn,
      project: publicProject(project),
    }), {
      timeout: 300000,
      stream: Boolean(onProgress),
      ...(onProgress ? streamHandlers(key, agent.label, onProgress) : {}),
    });
    const output = String(result.output || '').trim();
    if (!output) throw new Error(`${agent.label} returned an empty response.`);
    if (/not logged in|please run \/login/i.test(output)) {
      throw new Error(`${agent.label} is not signed in.`);
    }
    const parsed = extractReasoningSummary(output);
    if (!parsed.content) throw new Error(`${agent.label} returned no final answer.`);
    return {
      key,
      agent: agent.label,
      content: parsed.content,
      reasoning: parsed.reasoning,
      model: selectedModel || null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await manager.stopSession(sessionName).catch(() => {});
    activeSessions.delete(sessionName);
  }
}

function listArtifacts(project) {
  const registry = artifactRegistry(project);
  const items = [];
  for (const [relativePath, metadata] of Object.entries(registry)) {
    try {
      const { absolutePath } = normalizeArtifactPath(relativePath, project.path);
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const content = fs.readFileSync(absolutePath, 'utf8');
      items.push({
        path: relativePath,
        size: stat.size,
        hash: contentHash(content),
        updatedAt: metadata.updatedAt,
      });
    } catch {
      // Ignore stale registry entries rather than exposing an unsafe path.
    }
  }
  return items.sort((left, right) => left.path.localeCompare(right.path));
}

function applySessionProposal(project, body) {
  const sessionId = resolveSession(project, body.sessionId);
  const transcript = readTranscript(project, sessionId);
  const proposal = transcript.flatMap((item) => item.proposals || [])
    .find((item) => item.id === body.proposalId);
  if (!proposal || proposal.rejected) throw new Error('Unknown or rejected file draft.');
  // Another window may already have applied this draft. Do not write it twice.
  if (proposal.appliedAt) return { path: proposal.path, operation: 'updated' };
  const artifact = applyArtifact(project, proposal);
  proposal.appliedAt = new Date().toISOString();
  saveJson(transcriptPathFor(project, sessionId), transcript);
  return artifact;
}

function applyArtifact(project, body) {
  const { relativePath, absolutePath } = normalizeArtifactPath(body.path, project.path);
  const content = validateArtifactContent(body.content);
  const registry = artifactRegistry(project);
  const exists = fs.existsSync(absolutePath);

  if (exists) {
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Artifact target is not a regular file.');
    if (!registry[relativePath]) throw new Error('Existing file is not chatroom-managed and cannot be modified.');
    const current = fs.readFileSync(absolutePath, 'utf8');
    if (!body.baseHash || body.baseHash !== contentHash(current)) {
      throw new Error('Artifact changed after the proposal; refresh and request a new proposal.');
    }
    fs.writeFileSync(absolutePath, content, 'utf8');
  } else {
    if (body.baseHash !== null && body.baseHash !== undefined) throw new Error('New artifacts must not include a base hash.');
    const parent = path.dirname(absolutePath);
    fs.mkdirSync(parent, { recursive: true });
    const realArtifacts = fs.realpathSync(path.join(project.path, 'artifacts'));
    const realParent = fs.realpathSync(parent);
    if (realParent !== realArtifacts && !realParent.startsWith(`${realArtifacts}${path.sep}`)) {
      throw new Error('Artifact parent escaped artifacts/.');
    }
    fs.writeFileSync(absolutePath, content, { encoding: 'utf8', flag: 'wx' });
  }

  const now = new Date().toISOString();
  registry[relativePath] = {
    createdAt: registry[relativePath]?.createdAt || now,
    updatedAt: now,
    lastAgent: typeof body.agent === 'string' ? body.agent.slice(0, 40) : 'unknown',
  };
  saveJson(projectRegistryPath(project), registry);
  return { path: relativePath, operation: exists ? 'updated' : 'created', hash: contentHash(content) };
}

function serveStatic(req, res, pathname) {
  const files = {
    '/': [path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8'],
    '/app.js': [path.join(PUBLIC_DIR, 'app.js'), 'text/javascript; charset=utf-8'],
    '/i18n.js': [path.join(PUBLIC_DIR, 'i18n.js'), 'text/javascript; charset=utf-8'],
    '/styles.css': [path.join(PUBLIC_DIR, 'styles.css'), 'text/css; charset=utf-8'],
    '/flat-theme.css': [path.join(PUBLIC_DIR, 'flat-theme.css'), 'text/css; charset=utf-8'],
    '/logos/claude.svg': [path.join(PUBLIC_DIR, 'logos', 'claude.svg'), 'image/svg+xml'],
    '/logos/codex.svg': [path.join(PUBLIC_DIR, 'logos', 'codex.svg'), 'image/svg+xml'],
    '/logos/gemini.svg': [path.join(PUBLIC_DIR, 'logos', 'gemini.svg'), 'image/svg+xml'],
    '/vendor/markdown-it.min.js': [
      path.join(hostRoot, 'node_modules', 'markdown-it', 'dist', 'browser', 'markdown-it.umd.min.js'),
      'text/javascript; charset=utf-8',
    ],
  };
  const entry = files[pathname];
  if (!entry) return false;
  const body = fs.readFileSync(entry[0]);
  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    'Content-Type': entry[1],
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
  return true;
}

async function handleChat(body, onProgress = null) {
  const project = resolveProject(body.projectId);
  // A window pinned to a session another window deleted gets that session back
  // as an empty one, rather than silently posting into someone else's thread.
  const sessionId = resolveSession(project, body.sessionId, { create: true });
  const lock = sessionLockKey(project, sessionId);
  if (busySessions.has(lock)) throw new Error('This chat session is already waiting for a reply.');

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > MESSAGE_LIMIT) throw new Error('Message must be between 1 and 12000 characters.');
  const mode = body.mode === 'code' ? 'code' : 'chat';
  const target = body.target || 'group';
  const configuredRoute = normalizeRoute(body.route);
  const mentionOrder = parseMentionOrder(message);
  if (mentionOrder.length > MAX_ROUTE_TURNS) {
    throw new Error(`Mention routes support at most ${MAX_ROUTE_TURNS} turns.`);
  }
  const sequence = configuredRoute.length ? configuredRoute : mentionOrder;
  const sequential = sequence.length > 0;
  const keys = sequential ? sequence : (target === 'group' ? Object.keys(agents) : [target]);
  if (keys.some((key) => !agents[key])) throw new Error('Unknown chat target.');

  busySessions.add(lock);
  try {
    const files = [];
    const roomHistory = recentHistory(readTranscript(project, sessionId));
    const userItem = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      files: files.map((file) => file.path),
      mode,
      route: keys,
      project: publicProject(project),
      createdAt: new Date().toISOString(),
    };
    // Persist the human turn before the models run, so a crash or a closed
    // window during a long turn cannot lose what the user actually typed.
    appendTranscript(project, sessionId, [userItem]);

    const context = { message, files, mode, project, sessionId, onProgress };
    if (onProgress) onProgress({ type: 'user', user: userItem, route: keys });

    const registry = artifactRegistry(project);
    const appended = [];

    // Finalizing per turn rather than after the whole route means a relay can
    // hand each answer to the browser the moment it lands, instead of holding
    // the first one back until the last agent is done.
    const finalize = (result, key) => {
      const createdAt = new Date().toISOString();
      if (result.status === 'rejected') {
        const failure = {
          key,
          agent: agents[key].label,
          error: readableAgentError(key, result.reason, body.language),
        };
        // A failed turn is part of the history too; without this the session
        // reloads as a question nobody ever answered.
        appended.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          key,
          agent: failure.agent,
          error: failure.error,
          mode,
          project: publicProject(project),
          createdAt,
        });
        return failure;
      }
      const response = result.value;
      response.proposals = mode === 'code'
        ? extractArtifactProposals(response.content, registry, project.path)
        : [];
      response.proposals = response.proposals.map((proposal) => ({ ...proposal, id: proposal.id || crypto.randomUUID() }));
      const visibleContent = mode === 'code' ? stripArtifactBlocks(response.content) : response.content;
      const proposalNotice = body.language === 'en'
        ? `> Generated ${response.proposals.length} file draft${response.proposals.length === 1 ? '' : 's'}. Review and approve them in the right sidebar.`
        : `> 已生成 ${response.proposals.length} 个文件草案，请在右侧预览并确认。`;
      response.content = response.proposals.length
        ? `${visibleContent}\n\n${proposalNotice}`.trim()
        : visibleContent;
      appended.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        key: response.key,
        agent: response.agent,
        content: response.content,
        proposals: response.proposals.map((proposal) => ({ ...proposal, agent: response.agent })),
        reasoning: response.reasoning,
        model: response.model,
        durationMs: response.durationMs,
        mode,
        project: publicProject(project),
        createdAt,
      });
      return response;
    };

    const responses = [];
    const publish = (result, key) => {
      const response = finalize(result, key);
      responses.push(response);
      appendTranscript(project, sessionId, appended.splice(0));
      if (onProgress) onProgress({ type: 'response', response });
      return response;
    };

    if (sequential) {
      const relayTurns = [];
      for (const [index, key] of keys.entries()) {
        const turn = {
          agent: agents[key].label,
          delivery: 'sequential',
          position: index + 1,
          participants: keys.map((participant) => agents[participant].label),
        };
        if (onProgress) onProgress({ type: 'progress', key, agent: turn.agent, phase: 'starting' });
        let result;
        try {
          result = {
            status: 'fulfilled',
            value: await askAgent(key, {
              ...context,
              roomHistory,
              // Mark this agent's own earlier turns so a repeated speaker can
              // tell its previous answer apart from the other agents'.
              relayTurns: relayTurns.map((entry) => ({ ...entry, self: entry.key === key })),
              turn,
            }),
          };
        } catch (error) {
          result = { status: 'rejected', reason: error };
        }
        const response = publish(result, key);
        if (result.status === 'fulfilled') {
          relayTurns.push({
            key,
            agent: response.agent,
            // File drafts are for the human to approve, not for the next agent
            // to copy forward.
            content: mode === 'code' ? stripArtifactBlocks(response.content) : response.content,
          });
        }
      }
    } else {
      await Promise.all(keys.map(async (key, index) => {
        let result;
        try {
          result = { status: 'fulfilled', value: await askAgent(key, {
            ...context,
            roomHistory,
            turn: {
              agent: agents[key].label,
              delivery: 'parallel',
              position: index + 1,
              participants: keys.map((participant) => agents[participant].label),
            },
          }) };
        } catch (error) {
          result = { status: 'rejected', reason: error };
        }
        publish(result, key);
      }));
    }

    return {
      user: userItem,
      responses,
      routing: { sequential, order: keys },
      sessions: listSessions(project),
      activeSessionId: sessionId,
    };
  } finally {
    busySessions.delete(lock);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && serveStatic(req, res, url.pathname)) return;
    if (!url.pathname.startsWith('/api/')) {
      json(res, 404, { error: 'Not found.' });
      return;
    }
    if (!apiAuthorized(req)) {
      json(res, 401, { error: 'Invalid chat token.' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      const project = resolveProject(url.searchParams.get('project') || '');
      const sessionId = url.searchParams.get('new') === '1'
        ? createSession(project)
        : resolveSession(project, url.searchParams.get('session') || requestedSessionId, { create: true });
      json(res, 200, {
        agents: Object.entries(agents).map(([key, value]) => ({ key, label: value.label })),
        projects: projects.map(publicProject),
        ...sessionPayload(project, sessionId),
        desktop: process.platform === 'win32' ? 'windows' : null,
        modelOptions,
        health: agentHealth,
        settings: chatSettings,
        ui: uiSettings,
        policy: {
          localOnly: true,
          deleteEnabled: false,
          artifactRoot: 'artifacts/',
        },
      });
      return;
    }

    if (process.platform === 'win32' && req.method === 'POST' && url.pathname === '/api/desktop/login') {
      const body = await readBody(req);
      await openWindowsLogin(body.agent, resolveAgentBinaries());
      json(res, 200, { opened: true });
      return;
    }

    if (process.platform === 'win32' && req.method === 'POST' && url.pathname === '/api/desktop/project') {
      const selected = await pickWindowsFolder();
      if (selected) {
        requestedProjectPaths.push(selected);
        const refreshed = discoverProjects(requestedProjectsRoot, hostRoot, requestedProjectPaths);
        projects.splice(0, projects.length, ...refreshed);
        saveJson(windowsProjectsPath, [...new Set(requestedProjectPaths)]);
      }
      json(res, 200, { projects: projects.map(publicProject) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/models') {
      json(res, 200, { modelOptions });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (url.searchParams.get('refresh') === '1') void refreshAgentHealth();
      json(res, 200, { health: agentHealth, refreshing: Boolean(healthRefreshPromise) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      const project = resolveProject(url.searchParams.get('project') || '');
      const sessionId = resolveSession(project, url.searchParams.get('session') || '', { create: true });
      json(res, 200, sessionPayload(project, sessionId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/create') {
      const body = await readBody(req);
      const project = resolveProject(body.projectId);
      json(res, 200, sessionPayload(project, createSession(project, { title: body.title })));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/rename') {
      const body = await readBody(req);
      const project = resolveProject(body.projectId);
      renameSession(project, body.sessionId, body.title);
      json(res, 200, { sessions: listSessions(project) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/delete') {
      const body = await readBody(req);
      const project = resolveProject(body.projectId);
      deleteSession(project, body.sessionId);
      json(res, 200, { sessions: listSessions(project) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/projects/select') {
      const body = await readBody(req);
      const project = resolveProject(body.projectId);
      defaultProject = project;
      saveJson(projectSelectionPath, { projectId: project.id });
      json(res, 200, {
        projects: projects.map(publicProject),
        ...sessionPayload(project, resolveSession(project, body.sessionId || '')),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const body = await readBody(req);
      json(res, 200, { settings: updateChatSettings(body) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ui') {
      const body = await readBody(req);
      json(res, 200, { ui: updateUISettings(body) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readBody(req);
      // Newline-delimited JSON: progress lines while the models work, then one
      // final line with the same payload the non-streaming reply used to carry.
      // Everything that can be rejected is validated inside handleChat before
      // the first agent starts, and a throw there still lands on the 400 path
      // below as long as nothing has been written yet.
      let started = false;
      const write = (event) => {
        if (!started) {
          started = true;
          res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
        }
        res.write(`${JSON.stringify(event)}\n`);
      };
      try {
        const result = await handleChat(body, write);
        write({ type: 'done', ...result });
        res.end();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!started) throw error;
        write({ type: 'error', error: message });
        res.end();
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/artifacts/apply') {
      const body = await readBody(req);
      const project = resolveProject(body.projectId);
      json(res, 200, { artifact: applySessionProposal(project, body), artifacts: listArtifacts(project) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/artifacts') {
      const project = resolveProject(url.searchParams.get('project') || '');
      json(res, 200, { artifacts: listArtifacts(project) });
      return;
    }

    json(res, 404, { error: 'Unknown API endpoint.' });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(requestedPort, HOST, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  const openURL = `http://${HOST}:${port}/?token=${encodeURIComponent(accessToken)}`;
  if (readyFile) fs.writeFileSync(readyFile, `${JSON.stringify({ url: openURL })}\n`, { mode: 0o600 });
  console.log('Plan Review Room is ready.');
  console.log(`Open: ${openURL}`);
  console.log('The server is bound to localhost only. Press Ctrl-C to stop.');
  if (process.platform === 'win32' && process.argv.includes('--open-browser')) openWindowsBrowser(openURL);
  void refreshAgentHealth();
});

async function shutdown() {
  server.close();
  await Promise.all([...activeSessions].map((name) => manager.stopSession(name).catch(() => {})));
  fs.rmSync(sandboxDir, { recursive: true, force: true });
  if (readyFile) fs.rmSync(readyFile, { force: true });
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
