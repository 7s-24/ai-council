import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import * as policy from './chat-policy.mjs';
import * as sessions from './chat-sessions.mjs';
import * as protocol from './chat-protocol.mjs';

const serverSource = fs.readFileSync(new URL('./chat-server.mjs', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

// Exercise actual server/client functions with isolated disk and model stubs.
// Do not start the service, probe credentials, or invoke paid model sessions.
function functionsFrom(source, names) {
  return names.map((name) => {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, name);
    const rest = source.slice(start);
    const next = rest.slice(1).search(/\n(?:async )?function |\nconst server = |\n\/\/ A second window/);
    assert.notEqual(next, -1, name);
    return rest.slice(0, next + 1);
  }).join('\n');
}

function fixture(t) {
  const audits = new URL('../.ai-team/audits/', import.meta.url);
  fs.mkdirSync(audits, { recursive: true });
  const root = fs.mkdtempSync(path.join(audits.pathname, 'regression-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = { id: 'test-project', path: path.join(root, 'project') };
  fs.mkdirSync(project.path);
  const context = vm.createContext({
    fs, path, crypto, ...policy, ...sessions, ...protocol,
    hostRoot: project.path, chatRuntimeRoot: path.join(root, 'runtime'),
    defaultProject: project, projects: [project], busySessions: new Set(),
    publicProject: (value) => ({ id: value.id, name: 'Test project' }),
    agents: { claude: { label: 'Claude' }, codex: { label: 'Codex' } },
    MESSAGE_LIMIT: 12000, HISTORY_LIMIT: 16, HISTORY_CHARACTER_LIMIT: 48000,
    readableAgentError: (_key, error) => String(error),
    askAgent: async (key) => ({ key, agent: key, content: 'Answer' }),
  });
  const names = ['loadJson', 'saveJson', 'projectRuntimeRoot', 'projectRegistryPath', 'sessionIndexPath',
    'sessionDirectory', 'transcriptPathFor', 'readTranscript', 'readSessionIndex', 'writeSessionIndex',
    'listSessions', 'createSession', 'resolveProject', 'resolveSession', 'renameSession', 'deleteSession',
    'sessionLockKey', 'appendTranscript', 'pendingProposals', 'sessionPayload', 'artifactRegistry',
    'recentHistory', 'listArtifacts', 'applySessionProposal', 'applyArtifact', 'handleChat'];
  vm.runInContext(functionsFrom(serverSource, names), context);
  return { context, project, root };
}

test('artifact writes reject linked root, nested parents, and dangling links before creating directories', (t) => {
  const { context: c, project, root } = fixture(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const artifacts = path.join(project.path, 'artifacts');
  fs.symlinkSync(outside, artifacts);
  assert.throws(() => c.applyArtifact(project, { path: 'artifacts/new/probe.md', content: 'bad' }), /Symbolic links/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(artifacts);
  fs.mkdirSync(artifacts);
  fs.writeFileSync(path.join(outside, 'existing.md'), 'original');
  fs.symlinkSync(outside, path.join(artifacts, 'nested'));
  assert.throws(() => c.applyArtifact(project, { path: 'artifacts/nested/existing.md', content: 'bad' }), /Symbolic links/);
  fs.symlinkSync(path.join(root, 'missing'), path.join(artifacts, 'dangling'));
  assert.throws(() => c.applyArtifact(project, { path: 'artifacts/dangling/file.md', content: 'bad' }), /Symbolic links/);
  assert.equal(fs.readFileSync(path.join(outside, 'existing.md'), 'utf8'), 'original');
  assert.equal(fs.existsSync(path.join(root, 'missing')), false);
});

test('history survives beyond 200 messages while model context stays bounded', (t) => {
  const { context: c, project } = fixture(t);
  const id = c.createSession(project);
  const items = Array.from({ length: 205 }, (_, n) => ({ role: 'user', content: `message-${n}`, createdAt: '2026-09-05' }));
  c.appendTranscript(project, id, items);
  const restored = c.readTranscript(project, id);
  assert.equal(restored.length, 205);
  assert.equal(restored[0].content, 'message-0');
  assert.equal(c.listSessions(project)[0].messages, 205);
  assert.equal(c.recentHistory(restored).includes('message-0'), false);
  assert.match(c.recentHistory(restored), /message-204/);
});

test('relay persists each completed reply and restores drafts before the next model completes', async (t) => {
  const { context: c, project } = fixture(t);
  const id = c.createSession(project);
  let release;
  const nextTurn = new Promise((resolve) => { release = resolve; });
  c.askAgent = async (key) => {
    if (key === 'codex') await nextTurn;
    return { key, agent: key, content: key === 'claude' ? 'Plan <artifact path="artifacts/plan.md">Saved draft</artifact>' : 'Reviewed' };
  };
  let observed = false;
  await c.handleChat({ projectId: project.id, sessionId: id, message: 'Plan', mode: 'code', route: ['claude', 'codex'] }, (event) => {
    if (event.type !== 'response' || event.response.key !== 'claude') return;
    try {
      const restored = c.sessionPayload(project, id);
      assert.equal(restored.transcript.length, 2);
      assert.equal(restored.proposals[0].content, 'Saved draft');
      assert.equal(restored.proposals[0].id, event.response.proposals[0].id);
      observed = true;
    } finally { release(); }
  });
  assert.equal(observed, true);
  assert.equal(c.readTranscript(project, id).length, 3);
  const proposal = c.pendingProposals(project, id)[0];
  const request = { sessionId: id, proposalId: proposal.id, content: 'untrusted replacement' };
  c.applySessionProposal(project, request);
  assert.equal(fs.readFileSync(path.join(project.path, 'artifacts/plan.md'), 'utf8'), 'Saved draft');
  assert.equal(c.pendingProposals(project, id).length, 0);
  fs.writeFileSync(path.join(project.path, 'artifacts/plan.md'), 'Manual edit');
  c.applySessionProposal(project, request);
  assert.equal(fs.readFileSync(path.join(project.path, 'artifacts/plan.md'), 'utf8'), 'Manual edit');
  assert.throws(() => c.applySessionProposal(project, { sessionId: id, proposalId: 'unknown' }), /Unknown/);
});

test('a draft cannot overwrite a managed file edited since the proposal', (t) => {
  const { context: c, project } = fixture(t);
  const id = c.createSession(project);
  c.applyArtifact(project, { path: 'artifacts/plan.md', content: 'Original' });
  const proposals = policy.extractArtifactProposals('<artifact path="artifacts/plan.md">New</artifact>', c.artifactRegistry(project), project.path);
  c.appendTranscript(project, id, [{ role: 'assistant', proposals }]);
  fs.writeFileSync(path.join(project.path, 'artifacts/plan.md'), 'Human edit');
  assert.throws(() => c.applySessionProposal(project, { sessionId: id, proposalId: proposals[0].id }), /changed after/);
  assert.equal(c.pendingProposals(project, id).length, 1);
});

test('renaming B while A streams never switches A or clears its drafts', async () => {
  const state = { sending: true, activeSessionId: 'A', activeProject: { id: 'project' }, proposals: [{ id: 'draft' }] };
  const c = vm.createContext({ state, window: { prompt: () => 'Renamed' }, t: (key) => key,
    sessionLabel: () => 'B', api: async () => ({ sessions: [{ id: 'B', title: 'Renamed' }] }),
    renderSessions: () => {}, showToast: (error) => { throw new Error(error); } });
  vm.runInContext(functionsFrom(clientSource, ['renameSession']), c);
  await c.renameSession({ id: 'B' });
  assert.equal(state.activeSessionId, 'A');
  assert.equal(state.proposals[0].id, 'draft');
  assert.equal(state.sessions[0].title, 'Renamed');
});

test('unexpected stream EOF is an error instead of a successful empty completion', async () => {
  const c = vm.createContext({ token: 'test', TextDecoder, t: (key) => key,
    fetch: async () => new Response('{"type":"response","response":{"key":"claude"}}\n'),
  });
  vm.runInContext(functionsFrom(clientSource, ['streamChat']), c);
  let received = 0;
  await assert.rejects(c.streamChat({}, () => { received += 1; }), /streamInterrupted/);
  assert.equal(received, 1);
  c.fetch = async () => new Response('{"type":"done"}\n');
  await c.streamChat({}, () => {});
});

test('parallel replies publish and persist without waiting for a slower model', async (t) => {
  const { context: c, project } = fixture(t);
  const id = c.createSession(project);
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  let firstPublished;
  const first = new Promise((resolve) => { firstPublished = resolve; });
  c.askAgent = async (key) => {
    if (key === 'codex') await slow;
    return { key, agent: key, content: 'Answer' };
  };
  const run = c.handleChat({ projectId: project.id, sessionId: id, message: 'Review', target: 'group' }, (event) => {
    if (event.type === 'response' && event.response.key === 'claude') firstPublished();
  });
  let timer;
  try {
    await Promise.race([first, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Fast reply blocked by slow model')), 1000);
    })]);
    assert.equal(c.readTranscript(project, id).length, 2);
  } finally {
    clearTimeout(timer);
    releaseSlow();
    await run;
  }
  assert.equal(c.readTranscript(project, id).length, 3);
});

test('pending navigation blocks sending and a second session switch', async () => {
  const state = { sending: false, navigating: false, activeSessionId: 'A', activeProject: { id: 'project' } };
  let release;
  let requests = 0;
  const c = vm.createContext({ state, URLSearchParams, t: (key) => key,
    closeSessionMenu: () => {}, showToast: () => {},
    api: () => { requests += 1; return new Promise((resolve) => { release = resolve; }); },
    applyProjectState: (data) => { state.activeSessionId = data.activeSessionId; },
  });
  vm.runInContext(functionsFrom(clientSource, ['busy', 'selectSession', 'sendMessage']), c);
  const switching = c.selectSession('B');
  assert.equal(state.navigating, true);
  await c.selectSession('C');
  await c.sendMessage({ preventDefault() {} });
  assert.equal(requests, 1);
  release({ activeSessionId: 'B' });
  await switching;
  assert.equal(state.activeSessionId, 'B');
  assert.equal(state.navigating, false);
});

test('health polling rechecks the CLI after browser login instead of rereading stale cache forever', async () => {
  const queue = [];
  const calls = [];
  const state = { health: { claude: 'error', codex: 'ready', gemini: 'ready' } };
  const c = vm.createContext({ state, renderHealth() {},
    window: { clearTimeout() {}, setTimeout: (callback) => { queue.push(callback); } },
    api: async (url) => {
      calls.push(url);
      const recovered = calls.filter((value) => value.includes('refresh=1')).length >= 2;
      return { health: { claude: recovered ? 'ready' : 'error' }, refreshing: false };
    },
  });
  vm.runInContext(functionsFrom(clientSource, ['refreshHealth']), c);
  await c.refreshHealth();
  while (queue.length && calls.length < 10) await queue.shift()();
  assert.equal(state.health.claude, 'ready');
  assert.equal(calls.filter((url) => url.includes('refresh=1')).length, 2);
  assert.equal(queue.length, 0);
});

test('a cached ready health result waits for the pending probe before stopping', async () => {
  const queue = [];
  const state = { health: { claude: 'ready', codex: 'ready', gemini: 'ready' } };
  let call = 0;
  const c = vm.createContext({ state, renderHealth() {},
    window: { clearTimeout() {}, setTimeout: (callback) => { queue.push(callback); } },
    api: async () => ({ health: state.health, refreshing: call++ === 0 }),
  });
  vm.runInContext(functionsFrom(clientSource, ['refreshHealth']), c);
  await c.refreshHealth();
  assert.equal(queue.length, 1);
  await queue.shift()();
  assert.equal(queue.length, 0);
});
