const params = new URLSearchParams(window.location.search);
const token = params.get('token') || sessionStorage.getItem('plan-review-token') || '';
// A window is pinned to one project and one chat session. `new=1` asks the
// server for a fresh session, which is how "open in a new window" starts blank.
const pinned = {
  projectId: params.get('project') || '',
  sessionId: params.get('session') || '',
  fresh: params.get('new') === '1',
};
if (token) {
  sessionStorage.setItem('plan-review-token', token);
  history.replaceState(null, '', window.location.pathname);
}

// Keep project and session in the address bar (never the token) so a reload,
// or a restored window, comes back to the same conversation.
function rememberLocation() {
  const query = new URLSearchParams();
  if (state.activeProject?.id) query.set('project', state.activeProject.id);
  if (state.activeSessionId) query.set('session', state.activeSessionId);
  const search = query.toString();
  history.replaceState(null, '', search ? `${window.location.pathname}?${search}` : window.location.pathname);
}

const agentLabels = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const agentLogos = {
  claude: '/logos/claude.svg',
  codex: '/logos/codex.svg',
  gemini: '/logos/gemini.svg',
};
const MAX_ROUTE_TURNS = 8;
const translations = window.AICouncilI18n || { zh: {}, en: {} };

function t(key, values = {}) {
  const language = state?.language || 'zh';
  const template = translations[language]?.[key] || translations.zh?.[key] || key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

const MarkdownIt = typeof window.markdownit === 'function' ? window.markdownit : window.markdownit?.default;
if (typeof MarkdownIt !== 'function') throw new Error('Markdown renderer failed to load.');

const markdown = MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open
  || ((tokens, index, options, environment, renderer) => renderer.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noreferrer noopener');
  return defaultLinkOpen(tokens, index, options, environment, renderer);
};
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || t('imageAlt'));

const state = {
  projects: [],
  activeProject: null,
  sessions: [],
  activeSessionId: '',
  sessionMenuOpen: false,
  artifacts: [],
  proposals: [],
  settings: {
    agents: {
      claude: { model: '', prompt: '' },
      codex: { model: '', prompt: '' },
      gemini: { model: '', prompt: '' },
    },
  },
  modelOptions: { claude: [], codex: [], gemini: [] },
  health: { claude: 'unknown', codex: 'unknown', gemini: 'unknown' },
  settingsAgent: 'claude',
  sending: false,
  navigating: false,
  desktop: null,
  mode: 'chat',
  language: 'zh',
  theme: 'light',
  routeSequence: [],
  sidebars: { projects: false, artifacts: false },
};

const elements = {
  status: document.querySelector('#room-status'),
  topbarStatus: document.querySelector('.topbar-status'),
  modelHealth: document.querySelector('.model-health'),
  healthIndicators: [...document.querySelectorAll('[data-agent-health]')],
  projectGroups: document.querySelector('#project-groups'),
  projectCount: document.querySelector('#project-count'),
  activeProject: document.querySelector('#active-project'),
  addProjects: document.querySelector('#add-projects'),
  sessionControl: document.querySelector('.session-control'),
  sessionMenuButton: document.querySelector('#session-menu-button'),
  sessionTitle: document.querySelector('#session-title'),
  sessionMenu: document.querySelector('#session-menu'),
  sessionList: document.querySelector('#session-list'),
  sessionCount: document.querySelector('#session-count'),
  sessionMenuNew: document.querySelector('#session-menu-new'),
  newSession: document.querySelector('#new-session'),
  newWindow: document.querySelector('#new-window'),
  sidebarPanels: [...document.querySelectorAll('[data-sidebar-panel]')],
  sidebarToggles: [...document.querySelectorAll('[data-sidebar-toggle]')],
  messages: document.querySelector('#messages'),
  emptyState: document.querySelector('#empty-state'),
  composer: document.querySelector('#composer'),
  target: document.querySelector('#target'),
  message: document.querySelector('#message'),
  send: document.querySelector('#send'),
  modeButtons: [...document.querySelectorAll('.mode-button')],
  languageButtons: [...document.querySelectorAll('.language-button')],
  themeToggle: document.querySelector('#theme-toggle'),
  mentionChips: [...document.querySelectorAll('.mention-chip')],
  routePreview: document.querySelector('#route-preview'),
  proposals: document.querySelector('#proposals'),
  proposalCount: document.querySelector('#proposal-count'),
  proposalEmpty: document.querySelector('#proposal-empty'),
  artifactList: document.querySelector('#artifact-list'),
  refreshArtifacts: document.querySelector('#refresh-artifacts'),
  previewDialog: document.querySelector('#preview-dialog'),
  previewTitle: document.querySelector('#preview-title'),
  previewContent: document.querySelector('#preview-content'),
  closePreview: document.querySelector('#close-preview'),
  openSettings: document.querySelector('#open-settings'),
  settingsDialog: document.querySelector('#settings-dialog'),
  closeSettings: document.querySelector('#close-settings'),
  settingsForm: document.querySelector('#settings-form'),
  settingsTabs: [...document.querySelectorAll('.settings-tab')],
  settingsPanels: [...document.querySelectorAll('.settings-panel')],
  modelInputs: [...document.querySelectorAll('[data-model]')],
  promptInputs: [...document.querySelectorAll('[data-prompt]')],
  clearAgentSettings: document.querySelector('#clear-agent-settings'),
  reauthButtons: [...document.querySelectorAll('[data-reauth]')],
  modelLists: {
    claude: document.querySelector('#claude-models'),
    codex: document.querySelector('#codex-models'),
    gemini: document.querySelector('#gemini-models'),
  },
  toast: document.querySelector('#toast'),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Chat-Token': token,
      ...(options.headers || {}),
    },
  });
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(t('invalidResponse', { status: response.status }));
  }
  if (!response.ok) throw new Error(value.error || t('requestFailed', { status: response.status }));
  return value;
}

// /api/chat answers with newline-delimited JSON so progress can arrive while
// the models are still working. Everything else stays a plain JSON request.
async function streamChat(body, onEvent) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Chat-Token': token },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    let value = {};
    try {
      value = await response.json();
    } catch {
      throw new Error(t('invalidResponse', { status: response.status }));
    }
    throw new Error(value.error || t('requestFailed', { status: response.status }));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const deliver = (event) => {
    if (event.type === 'done') completed = true;
    onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) deliver(JSON.parse(line));
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) deliver(JSON.parse(buffer));
    if (!completed) throw new Error(t('streamInterrupted'));
  } finally {
    reader.releaseLock();
  }
}

function renderHealth() {
  const values = Object.keys(agentLabels).map((key) => state.health[key] || 'unknown');
  const ready = values.filter((value) => value === 'ready').length;
  const failed = values.filter((value) => value === 'error').length;
  elements.status.textContent = `${ready}/3`;
  elements.status.classList.toggle('ready', ready === 3);
  elements.status.classList.toggle('error', failed > 0);
  elements.modelHealth.classList.toggle('ready', ready === 3);
  elements.modelHealth.classList.toggle('error', failed > 0);
  elements.healthIndicators.forEach((indicator) => {
    const value = state.health[indicator.dataset.agentHealth] || 'unknown';
    indicator.dataset.status = value;
  });
  elements.topbarStatus.dataset.i18nAria = 'roomHealth';
  elements.topbarStatus.dataset.i18nTitle = 'roomHealth';
  elements.topbarStatus.dataset.i18nValues = JSON.stringify({ ready });
  elements.topbarStatus.setAttribute('aria-label', t('roomHealth', { ready }));
  elements.topbarStatus.title = t('roomHealth', { ready });
}

async function refreshHealth(attempt = 0, generation = refreshHealth.generation || 0) {
  if (attempt === 0) {
    generation = (refreshHealth.generation || 0) + 1;
    refreshHealth.generation = generation;
    window.clearTimeout(refreshHealth.timer);
  }
  try {
    // Re-probe periodically while login may still be happening in a browser.
    const data = await api(`/api/health${attempt % 4 === 0 ? '?refresh=1' : ''}`);
    if (generation !== refreshHealth.generation) return;
    state.health = { ...state.health, ...(data.health || {}) };
    renderHealth();
    if (attempt < 20 && (data.refreshing || Object.values(state.health).some((value) => value !== 'ready'))) {
      refreshHealth.timer = window.setTimeout(() => refreshHealth(attempt + 1, generation), 1_500);
    }
  } catch {
    // Chat remains usable when a background health probe is unavailable.
  }
}

function refreshHealthOnReturn() {
  if (document.visibilityState !== 'hidden') void refreshHealth(0);
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function translationValues(element) {
  if (!element.dataset.i18nValues) return {};
  try {
    return JSON.parse(element.dataset.i18nValues);
  } catch {
    return {};
  }
}

function translateDocument() {
  document.documentElement.lang = state.language === 'en' ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n, translationValues(element));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAria, translationValues(element)));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle, translationValues(element));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder, translationValues(element));
  });
  document.querySelectorAll('[data-duration-ms]').forEach((element) => {
    element.textContent = formatDuration(Number(element.dataset.durationMs));
  });
}

function setLanguage(language, persist = false) {
  state.language = language === 'en' ? 'en' : 'zh';
  elements.languageButtons.forEach((button) => {
    const active = button.dataset.language === state.language;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  translateDocument();
  setMode(state.mode);
  renderSidebars();
  renderProjects();
  renderSessions();
  renderProposals();
  renderArtifacts();
  updateRoutePreview();
  setTheme(state.theme);
  renderHealth();
  window.webkit?.messageHandlers?.aiCouncil?.postMessage({ action: 'setLanguage', language: state.language });
  if (persist) void persistUISettings();
}

function setTheme(theme, persist = false) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.body.dataset.theme = state.theme;
  const label = t(state.theme === 'dark' ? 'switchLight' : 'switchDark');
  elements.themeToggle.setAttribute('aria-label', label);
  elements.themeToggle.title = label;
  elements.themeToggle.setAttribute('aria-pressed', String(state.theme === 'dark'));
  window.webkit?.messageHandlers?.aiCouncil?.postMessage({ action: 'setTheme', theme: state.theme });
  if (persist) void persistUISettings();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes > 10240 ? 0 : 1)} KB`;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return t('seconds', { value: (milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0) });
}

function parseMentionOrder(message) {
  const order = [];
  const expression = /@(claude|codex|gemini)\b/giu;
  let match;
  while ((match = expression.exec(String(message)))) {
    const key = match[1].toLowerCase();
    order.push(key);
  }
  return order;
}

function routeFor(message, target = elements.target.value) {
  if (state.routeSequence.length) {
    return { keys: [...state.routeSequence], sequential: true, source: 'queue' };
  }
  // The server rejects longer mention routes, so clamp here and show the same
  // preview it will actually run instead of failing after the user hits send.
  const mentions = parseMentionOrder(message).slice(0, MAX_ROUTE_TURNS);
  if (mentions.length) return { keys: mentions, sequential: true, source: 'mentions' };
  return {
    keys: target === 'group' ? ['claude', 'codex', 'gemini'] : [target],
    sequential: false,
    source: 'target',
  };
}

function updateRoutePreview() {
  const route = routeFor(elements.message.value);
  const visibleRoute = route.sequential ? route.keys : [];
  elements.mentionChips.forEach((chip) => {
    const key = chip.dataset.mention.toLowerCase();
    const count = visibleRoute.filter((agent) => agent === key).length;
    chip.classList.toggle('active', count > 0);
    chip.setAttribute('aria-pressed', String(count > 0));
    chip.setAttribute('aria-label', t(count ? 'addTurnCount' : 'addTurn', { agent: agentLabels[key], count }));
    if (count) chip.dataset.count = String(count);
    else delete chip.dataset.count;
  });

  elements.routePreview.hidden = !route.sequential;
  if (!route.sequential) {
    elements.routePreview.replaceChildren();
    elements.routePreview.removeAttribute('aria-label');
    return;
  }

  const fragment = document.createDocumentFragment();
  route.keys.forEach((key, index) => {
    if (index) {
      const arrow = document.createElement('span');
      arrow.className = 'route-arrow';
      arrow.textContent = '→';
      fragment.append(arrow);
    }
    const node = document.createElement(route.source === 'queue' ? 'button' : 'span');
    node.className = 'route-node';
    node.dataset.order = String(index + 1);
    if (route.source === 'queue') {
      node.type = 'button';
      node.classList.add('removable');
      node.title = t('removeTurn', { position: index + 1, agent: agentLabels[key] });
      node.setAttribute('aria-label', node.title);
      node.addEventListener('click', () => removeRouteStep(index));
    } else {
      node.title = agentLabels[key];
    }
    const logo = document.createElement('img');
    logo.src = agentLogos[key];
    logo.alt = '';
    node.append(logo);
    fragment.append(node);
  });
  elements.routePreview.setAttribute('aria-label', t('routeOrder', {
    route: route.keys.map((key) => agentLabels[key]).join(state.language === 'en' ? ', ' : '，'),
  }));
  elements.routePreview.replaceChildren(fragment);
}

function setMode(mode, persist = false) {
  state.mode = mode === 'code' ? 'code' : 'chat';
  document.body.dataset.mode = state.mode;
  elements.modeButtons.forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  elements.composer.setAttribute('aria-label', t(state.mode === 'code' ? 'codeComposer' : 'chatComposer'));
  if (persist) void persistUISettings();
}

function renderSidebars() {
  elements.sidebarPanels.forEach((panel) => {
    panel.classList.toggle('sidebar-collapsed', Boolean(state.sidebars[panel.dataset.sidebarPanel]));
  });
  elements.sidebarToggles.forEach((button) => {
    const key = button.dataset.sidebarToggle;
    const collapsed = Boolean(state.sidebars[key]);
    const side = button.dataset.sidebarSide;
    button.textContent = collapsed
      ? (side === 'right' ? '‹' : '›')
      : (side === 'right' ? '›' : '‹');
    const sidebar = key === 'projects' ? 'Projects' : t('artifactsSidebar');
    const label = t(collapsed ? 'expandSidebar' : 'collapseSidebar', { sidebar });
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-expanded', String(!collapsed));
    document.body.dataset[`sidebar${key[0].toUpperCase()}${key.slice(1)}`] = collapsed ? 'collapsed' : 'expanded';
  });
}

async function persistUISettings() {
  try {
    const data = await api('/api/ui', {
      method: 'POST',
      body: JSON.stringify({
        mode: state.mode,
        language: state.language,
        theme: state.theme,
        sidebars: state.sidebars,
      }),
    });
    state.mode = data.ui.mode;
    state.language = data.ui.language;
    state.theme = data.ui.theme;
    state.sidebars = data.ui.sidebars;
    setMode(state.mode);
    renderSidebars();
  } catch (error) {
    showToast(error.message, true);
  }
}

function toggleSidebar(key) {
  if (!(key in state.sidebars)) return;
  state.sidebars[key] = !state.sidebars[key];
  renderSidebars();
  void persistUISettings();
}

async function requestProjectFolders() {
  if (state.desktop === 'windows') {
    try {
      const data = await api('/api/desktop/project', { method: 'POST', body: '{}' });
      state.projects = data.projects;
      renderProjects();
    } catch (error) { showToast(error.message, true); }
    return;
  }
  const handler = window.webkit?.messageHandlers?.aiCouncil;
  if (!handler) {
    showToast(t('addFolderInApp'), true);
    return;
  }
  handler.postMessage({ action: 'addProjects' });
}

function projectEnvironmentLabel(project) {
  if (project.environment === 'mixed') return state.language === 'en' ? 'Mixed' : '混合环境';
  if (project.environment === 'other') return state.language === 'en' ? 'Other' : '其他';
  return project.environmentLabel;
}

function renderActiveProject() {
  elements.activeProject.replaceChildren();
  if (!state.activeProject) return;
  const dot = document.createElement('span');
  dot.className = 'project-dot';
  const name = document.createElement('span');
  name.className = 'active-project-name';
  name.textContent = state.activeProject.name;
  elements.activeProject.dataset.environment = state.activeProject.environment;
  elements.activeProject.title = `${state.activeProject.name} · ${projectEnvironmentLabel(state.activeProject)}`;
  elements.activeProject.append(dot, name);
}

function renderProjects() {
  elements.projectCount.textContent = String(state.projects.length);
  const groups = new Map();
  state.projects.forEach((project) => {
    const label = projectEnvironmentLabel(project);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(project);
  });

  const fragment = document.createDocumentFragment();
  groups.forEach((projects, label) => {
    const section = document.createElement('section');
    section.className = 'project-group';
    const heading = document.createElement('h3');
    heading.className = 'project-group-label';
    heading.textContent = label;
    const list = document.createElement('div');
    list.className = 'project-list';
    projects.forEach((project) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'project-button';
      button.classList.toggle('active', project.id === state.activeProject?.id);
      button.dataset.environment = project.environment;
      button.setAttribute('aria-pressed', String(project.id === state.activeProject?.id));
      button.title = `${project.name} · ${projectEnvironmentLabel(project)}`;
      const dot = document.createElement('span');
      dot.className = 'project-dot';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'project-name';
      name.textContent = project.name;
      const git = document.createElement('span');
      git.className = 'git-mark';
      git.textContent = project.git ? '◇' : '';
      git.setAttribute('aria-hidden', 'true');
      button.append(dot, name, git);
      button.addEventListener('click', () => selectProject(project.id));
      list.append(button);
    });
    section.append(heading, list);
    fragment.append(section);
  });
  elements.projectGroups.replaceChildren(fragment);
  renderActiveProject();
}

function renderTranscript(items) {
  elements.messages.replaceChildren();
  elements.messages.classList.remove('active');
  elements.emptyState.hidden = false;
  const fragment = document.createDocumentFragment();
  items.forEach((item) => addMessage(
    { ...item, key: item.key || item.agent?.toLowerCase() },
    { container: fragment, scroll: false },
  ));
  elements.messages.append(fragment);
  window.requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  });
}

function applyProjectState(data) {
  state.projects = data.projects || state.projects;
  state.activeProject = data.activeProject || state.activeProject;
  state.sessions = data.sessions || state.sessions;
  state.activeSessionId = data.activeSessionId || state.activeSessionId;
  state.artifacts = data.artifacts || [];
  state.proposals = data.proposals || [];
  renderProjects();
  renderSessions();
  renderArtifacts();
  renderProposals();
  renderTranscript(data.transcript || []);
  rememberLocation();
}

function busy() {
  if (!state.sending && !state.navigating) return false;
  showToast(t('finishBeforeSessionSwitch'), true);
  return true;
}

async function selectProject(projectId) {
  if (!projectId || projectId === state.activeProject?.id) return;
  if (state.sending || state.navigating) {
    showToast(t('finishBeforeProjectSwitch'), true);
    return;
  }
  state.navigating = true;
  elements.projectGroups.classList.add('loading');
  try {
    applyProjectState(await api('/api/projects/select', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }));
    closeSessionMenu();
    showToast(state.activeProject.name);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.navigating = false;
    elements.projectGroups.classList.remove('loading');
  }
}

function sessionLabel(session) {
  return session?.title || t('untitledSession');
}

function renderSessions() {
  const active = state.sessions.find((session) => session.id === state.activeSessionId);
  elements.sessionTitle.textContent = sessionLabel(active);
  elements.sessionMenuButton.title = sessionLabel(active);
  elements.sessionCount.textContent = String(state.sessions.length);

  if (!state.sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'session-empty';
    empty.textContent = t('emptySession');
    elements.sessionList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.sessions.forEach((session) => {
    const row = document.createElement('div');
    row.className = 'session-row';
    row.classList.toggle('active', session.id === state.activeSessionId);
    row.setAttribute('role', 'none');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'session-open';
    open.setAttribute('role', 'menuitem');
    open.setAttribute('aria-current', String(session.id === state.activeSessionId));
    open.title = t('switchSession', { title: sessionLabel(session) });
    const name = document.createElement('span');
    name.className = 'session-name';
    name.textContent = sessionLabel(session);
    const meta = document.createElement('span');
    meta.className = 'session-meta';
    const stamp = session.updatedAt ? new Date(session.updatedAt) : null;
    const when = stamp && !Number.isNaN(stamp.valueOf())
      ? stamp.toLocaleString(state.language === 'en' ? 'en' : 'zh-CN')
      : '';
    meta.textContent = [t('sessionMessages', { count: session.messages }), when].filter(Boolean).join(' · ');
    open.append(name, meta);
    open.addEventListener('click', () => selectSession(session.id));

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'session-action';
    rename.textContent = '✎';
    rename.title = t('renameSession');
    rename.setAttribute('aria-label', rename.title);
    rename.addEventListener('click', () => renameSession(session));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'session-action danger';
    remove.textContent = '×';
    remove.title = t('deleteSession');
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => deleteSession(session));

    row.append(open, rename, remove);
    fragment.append(row);
  });
  elements.sessionList.replaceChildren(fragment);
}

function closeSessionMenu() {
  state.sessionMenuOpen = false;
  elements.sessionMenu.hidden = true;
  elements.sessionMenuButton.setAttribute('aria-expanded', 'false');
}

function toggleSessionMenu() {
  if (state.sessionMenuOpen) {
    closeSessionMenu();
    return;
  }
  state.sessionMenuOpen = true;
  elements.sessionMenu.hidden = false;
  elements.sessionMenuButton.setAttribute('aria-expanded', 'true');
  renderSessions();
}

async function selectSession(sessionId) {
  closeSessionMenu();
  if (!sessionId || sessionId === state.activeSessionId || busy()) return;
  state.navigating = true;
  try {
    const query = new URLSearchParams({ project: state.activeProject?.id || '', session: sessionId });
    applyProjectState(await api(`/api/session?${query}`));
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.navigating = false;
  }
}

async function createSession() {
  closeSessionMenu();
  if (busy()) return;
  state.navigating = true;
  try {
    applyProjectState(await api('/api/sessions/create', {
      method: 'POST',
      body: JSON.stringify({ projectId: state.activeProject?.id }),
    }));
    showToast(t('sessionCreated'));
    elements.message.focus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.navigating = false;
  }
}

async function renameSession(session) {
  if (state.navigating) return;
  const projectId = state.activeProject?.id;
  const title = window.prompt(t('renameSession'), sessionLabel(session));
  if (title === null) return;
  try {
    const data = await api('/api/sessions/rename', {
      method: 'POST',
      body: JSON.stringify({ projectId, sessionId: session.id, title }),
    });
    if (state.activeProject?.id !== projectId) return;
    state.sessions = data.sessions;
    renderSessions();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteSession(session) {
  if (state.navigating || (session.id === state.activeSessionId && busy())) return;
  const projectId = state.activeProject?.id;
  if (!window.confirm(t('deleteSessionConfirm', { title: sessionLabel(session) }))) return;
  state.navigating = true;
  try {
    const data = await api('/api/sessions/delete', {
      method: 'POST',
      body: JSON.stringify({ projectId, sessionId: session.id }),
    });
    state.sessions = data.sessions;
    if (session.id === state.activeSessionId) {
      applyProjectState(await api(`/api/session?${new URLSearchParams({ project: projectId })}`));
    } else {
      renderSessions();
    }
    showToast(t('sessionDeleted'));
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.navigating = false;
  }
}

// A second window is the same local server with a different pinned session, so
// the native shell and a plain browser tab can both honour it.
function openSessionWindow({ sessionId = '', fresh = true } = {}) {
  closeSessionMenu();
  const query = new URLSearchParams();
  if (state.activeProject?.id) query.set('project', state.activeProject.id);
  if (sessionId) query.set('session', sessionId);
  else if (fresh) query.set('new', '1');

  const handler = window.webkit?.messageHandlers?.aiCouncil;
  if (handler) {
    handler.postMessage({
      action: 'openWindow',
      project: state.activeProject?.id || '',
      session: sessionId,
      fresh: Boolean(fresh && !sessionId),
    });
    return;
  }
  const url = `${window.location.pathname}?${query}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  if (!window.open(url, '_blank', 'noopener')) showToast(t('newWindowBlocked'), true);
}

function setSettingsAgent(key) {
  if (!agentLabels[key]) return;
  state.settingsAgent = key;
  elements.settingsTabs.forEach((tab) => {
    const active = tab.dataset.settingsTab === key;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  elements.settingsPanels.forEach((panel) => {
    const active = panel.dataset.settingsPanel === key;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

function renderSettings() {
  elements.modelInputs.forEach((input) => {
    input.value = state.settings.agents[input.dataset.model]?.model || '';
  });
  elements.promptInputs.forEach((input) => {
    input.value = state.settings.agents[input.dataset.prompt]?.prompt || '';
  });
  elements.settingsTabs.forEach((tab) => {
    const configured = state.settings.agents[tab.dataset.settingsTab];
    tab.classList.toggle('configured', Boolean(configured?.model || configured?.prompt));
  });
}

function renderModelOptions() {
  Object.entries(elements.modelLists).forEach(([key, list]) => {
    const fragment = document.createDocumentFragment();
    (state.modelOptions[key] || []).forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      fragment.append(option);
    });
    list.replaceChildren(fragment);
  });
}

function settingsFromForm() {
  const settings = { agents: {} };
  Object.keys(agentLabels).forEach((key) => {
    settings.agents[key] = {
      model: elements.modelInputs.find((input) => input.dataset.model === key)?.value.trim() || '',
      prompt: elements.promptInputs.find((input) => input.dataset.prompt === key)?.value.trim() || '',
    };
  });
  return settings;
}

async function saveSettings(event) {
  event.preventDefault();
  const submit = elements.settingsForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const data = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settingsFromForm()),
    });
    state.settings = data.settings;
    renderSettings();
    elements.settingsDialog.close();
    showToast(t('settingsSaved'));
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

async function requestReauthentication(key) {
  if (state.desktop === 'windows' && agentLabels[key]) {
    try {
      await api('/api/desktop/login', { method: 'POST', body: JSON.stringify({ agent: key }) });
      showToast(t('signInWindowOpened', { agent: agentLabels[key] }));
    } catch (error) { showToast(error.message, true); }
    return;
  }
  const handler = window.webkit?.messageHandlers?.aiCouncil;
  if (!handler || !agentLabels[key]) {
    showToast(t('signInFromMacApp'), true);
    return;
  }
  handler.postMessage({ action: 'reauthenticate', agent: key });
  showToast(t('signInWindowOpened', { agent: agentLabels[key] }));
  window.setTimeout(() => refreshHealth(0), 4_000);
}

function addRouteStep(name) {
  if (state.routeSequence.length >= MAX_ROUTE_TURNS) {
    showToast(t('maxTurns', { count: MAX_ROUTE_TURNS }), true);
    return;
  }
  const key = String(name).toLowerCase();
  if (!agentLabels[key]) return;
  state.routeSequence.push(key);
  updateRoutePreview();
  elements.message.focus();
}

function removeRouteStep(index) {
  state.routeSequence.splice(index, 1);
  updateRoutePreview();
  elements.message.focus();
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || pre.parentElement?.classList.contains('code-block')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.dataset.i18n = 'copy';
    button.textContent = t('copy');
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || '');
        button.textContent = t('copied');
        window.setTimeout(() => { button.textContent = t('copy'); }, 1400);
      } catch {
        showToast(t('clipboardDenied'), true);
      }
    });
    pre.replaceWith(wrapper);
    wrapper.append(pre, button);
  });
}

function renderMarkdown(container, value) {
  container.innerHTML = markdown.render(String(value || ''));
  enhanceCodeBlocks(container);
}

function createAvatar(key, label) {
  const wrapper = document.createElement('span');
  wrapper.className = `agent-avatar ${key}`;
  if (agentLogos[key]) {
    const image = document.createElement('img');
    image.src = agentLogos[key];
    image.alt = `${label} logo`;
    wrapper.append(image);
  } else {
    wrapper.textContent = '!';
  }
  return wrapper;
}

function addMessage(item, { container = elements.messages, scroll = true } = {}) {
  elements.emptyState.hidden = true;
  elements.messages.classList.add('active');

  const article = document.createElement('article');
  const key = (item.key || '').toLowerCase();
  article.className = `message ${item.role === 'user' ? 'user' : key}${item.error ? ' error' : ''}`;
  if (item.id) article.dataset.messageId = item.id;

  const stack = document.createElement('div');
  stack.className = 'message-stack';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const label = document.createElement('span');
  const labelKey = item.role === 'user' ? 'you' : (item.agentKey || (!item.agent ? 'genericModel' : ''));
  if (labelKey) label.dataset.i18n = labelKey;
  label.textContent = labelKey ? t(labelKey) : item.agent;
  meta.append(label);

  if (item.role === 'user') {
    const context = document.createElement('span');
    context.className = 'message-context';
    const mode = item.mode === 'code' ? 'Code' : 'Chat';
    const route = Array.isArray(item.route) ? item.route.map((agent) => agentLabels[agent] || agent).join(' → ') : '';
    const project = item.mode === 'code' ? item.project?.name : '';
    context.textContent = [project, mode, route].filter(Boolean).join(' · ');
    meta.append(context);
  } else if (item.model) {
    const model = document.createElement('span');
    model.className = 'message-context';
    model.textContent = item.model;
    meta.append(model);
  }
  stack.append(meta);

  if (item.reasoning) {
    const details = document.createElement('details');
    details.className = 'reasoning-block';
    details.open = true;
    const summary = document.createElement('summary');
    const summaryLabel = document.createElement('span');
    summaryLabel.dataset.i18n = 'reasoningSummary';
    summaryLabel.textContent = t('reasoningSummary');
    const duration = document.createElement('span');
    duration.className = 'reasoning-duration';
    if (Number.isFinite(item.durationMs)) duration.dataset.durationMs = String(item.durationMs);
    duration.textContent = formatDuration(item.durationMs);
    summary.append(summaryLabel, duration);
    const reasoning = document.createElement('div');
    reasoning.className = 'reasoning-content markdown-body';
    renderMarkdown(reasoning, item.reasoning);
    details.append(summary, reasoning);
    stack.append(details);
  }

  const body = document.createElement('div');
  body.className = 'message-body markdown-body';
  renderMarkdown(body, item.error || item.content);
  stack.append(body);

  if (item.files?.length) {
    const files = document.createElement('div');
    files.className = 'message-files';
    files.textContent = `▱ ${item.files.length}`;
    files.dataset.i18nAria = 'attachedFiles';
    files.dataset.i18nValues = JSON.stringify({ count: item.files.length });
    files.setAttribute('aria-label', t('attachedFiles', { count: item.files.length }));
    stack.append(files);
  }

  if (item.role !== 'user') article.append(createAvatar(key, labelKey ? t(labelKey) : item.agent));
  article.append(stack);
  container.append(article);
  if (scroll) elements.messages.scrollTop = elements.messages.scrollHeight;
  return article;
}

// A Code-mode turn can run for over a minute. The placeholder therefore shows
// what the model is touching and streams its reasoning summary in, rather than
// sitting on the word "thinking" until the whole answer lands.
function createPendingTurn(key, statusKey) {
  const label = agentLabels[key];
  const node = addMessage({ role: 'assistant', key, agent: label, content: '' });
  node.classList.add('thinking');

  const meta = node.querySelector('.message-meta');
  const elapsed = document.createElement('span');
  elapsed.className = 'message-context live-elapsed';
  meta.append(elapsed);

  const stack = node.querySelector('.message-stack');
  const body = node.querySelector('.message-body');
  body.replaceChildren();
  const status = document.createElement('span');
  status.className = 'thinking-dots';
  status.dataset.i18n = statusKey;
  status.textContent = t(statusKey);
  body.append(status);

  const startedAt = Date.now();
  const tick = () => { elapsed.textContent = formatDuration(Date.now() - startedAt); };
  tick();
  const timer = window.setInterval(tick, 1000);

  let activity = null;
  let reasoning = null;

  const setStatus = (nextKey, values) => {
    status.dataset.i18n = nextKey;
    if (values) status.dataset.i18nValues = JSON.stringify(values);
    else delete status.dataset.i18nValues;
    status.textContent = t(nextKey, values || {});
  };

  return {
    key,
    node,
    resolved: false,
    update(event) {
      if (event.phase === 'tool') {
        if (!activity) {
          activity = document.createElement('div');
          activity.className = 'live-activity';
          const tool = document.createElement('span');
          tool.className = 'live-tool';
          const detail = document.createElement('span');
          detail.className = 'live-detail';
          activity.append(tool, detail);
          stack.insertBefore(activity, body);
        }
        activity.querySelector('.live-tool').textContent = event.tool || '';
        activity.querySelector('.live-detail').textContent = event.detail || '';
        setStatus('usingTool', { tool: event.tool || '' });
        return;
      }
      if (event.phase === 'reasoning' || event.phase === 'answering') {
        if (event.reasoning) {
          if (!reasoning) {
            const details = document.createElement('details');
            details.className = 'reasoning-block';
            details.open = true;
            const summary = document.createElement('summary');
            const summaryLabel = document.createElement('span');
            summaryLabel.dataset.i18n = 'reasoningSummary';
            summaryLabel.textContent = t('reasoningSummary');
            summary.append(summaryLabel);
            reasoning = document.createElement('div');
            reasoning.className = 'reasoning-content markdown-body';
            details.append(summary, reasoning);
            stack.insertBefore(details, activity || body);
          }
          // Plain text while it streams; the settled message renders Markdown.
          reasoning.textContent = event.reasoning;
        }
        setStatus(event.phase === 'answering' ? 'writingAnswer' : 'thinking');
        return;
      }
      setStatus('thinking');
    },
    stop() {
      window.clearInterval(timer);
    },
  };
}

function addThinking(route) {
  return route.keys.map((key, index) => createPendingTurn(
    key,
    route.sequential && index > 0 ? 'waitingPrevious' : 'thinking',
  ));
}

function renderProposals() {
  elements.proposalCount.textContent = String(state.proposals.length);
  elements.proposalEmpty.hidden = state.proposals.length > 0;
  const fragment = document.createDocumentFragment();
  state.proposals.forEach((proposal, index) => {
    const card = document.createElement('article');
    card.className = 'proposal-card';
    const path = document.createElement('strong');
    path.className = 'proposal-path';
    path.textContent = proposal.path;
    const meta = document.createElement('p');
    meta.className = 'proposal-meta';
    meta.textContent = proposal.rejected
      ? `${proposal.agent} · ${t('blocked', { reason: proposal.reason })}`
      : `${proposal.agent} · ${formatBytes(new Blob([proposal.content]).size)} · ${t(proposal.operation === 'update' ? 'updated' : 'created')}`;
    const actions = document.createElement('div');
    actions.className = 'proposal-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = t('view');
    view.addEventListener('click', () => {
      elements.previewTitle.textContent = t('pending', { path: proposal.path });
      elements.previewContent.textContent = proposal.content;
      elements.previewDialog.showModal();
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'apply-button';
    apply.textContent = t(proposal.rejected ? 'blockedShort' : 'apply');
    apply.disabled = Boolean(proposal.rejected || proposal.applying);
    if (!proposal.rejected) apply.addEventListener('click', () => applyProposal(index, apply));
    actions.append(view, apply);
    card.append(path, meta, actions);
    fragment.append(card);
  });
  elements.proposals.replaceChildren(fragment);
}

function renderArtifacts() {
  if (!state.artifacts.length) {
    const empty = document.createElement('div');
    empty.className = 'artifact-empty';
    empty.setAttribute('aria-label', t('noCreatedFiles'));
    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '◇';
    empty.append(mark);
    elements.artifactList.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  state.artifacts.forEach((artifact) => {
    const row = document.createElement('div');
    row.className = 'managed-item';
    const path = document.createElement('strong');
    path.textContent = artifact.path;
    const meta = document.createElement('span');
    meta.textContent = `${formatBytes(artifact.size)} · ${new Date(artifact.updatedAt).toLocaleString(state.language === 'en' ? 'en' : 'zh-CN')}`;
    row.append(path, meta);
    fragment.append(row);
  });
  elements.artifactList.replaceChildren(fragment);
}

async function applyProposal(index, button) {
  const proposal = state.proposals[index];
  if (!proposal || proposal.applying) return;
  const projectId = state.activeProject?.id;
  const sessionId = state.activeSessionId;
  proposal.applying = true;
  button.disabled = true;
  button.textContent = t('applying');
  try {
    const data = await api('/api/artifacts/apply', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        sessionId,
        proposalId: proposal.id,
      }),
    });
    if (state.activeProject?.id !== projectId || state.activeSessionId !== sessionId) return;
    state.artifacts = data.artifacts;
    state.proposals = state.proposals.filter((item) => item.id !== proposal.id);
    renderProposals();
    renderArtifacts();
    showToast(t(data.artifact.operation === 'created' ? 'artifactCreated' : 'artifactUpdated', {
      path: data.artifact.path,
    }));
  } catch (error) {
    proposal.applying = false;
    button.disabled = false;
    button.textContent = t('apply');
    showToast(error.message, true);
  }
}

async function refreshArtifacts() {
  try {
    const data = await api(`/api/artifacts?project=${encodeURIComponent(state.activeProject?.id || '')}`);
    state.artifacts = data.artifacts;
    renderArtifacts();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.sending || state.navigating) return;
  const message = elements.message.value.trim();
  if (!message) return;

  state.sending = true;
  elements.send.disabled = true;
  const target = elements.target.value;
  const route = routeFor(message, target);
  const configuredRoute = route.source === 'queue' ? [...route.keys] : [];
  addMessage({ role: 'user', content: message, mode: state.mode, route: route.keys, project: state.activeProject });
  elements.message.value = '';
  state.routeSequence = [];
  updateRoutePreview();
  const pending = addThinking(route);

  // The first unsettled placeholder for this agent -- a route may name the same
  // agent twice, and progress events only carry the agent key.
  const nextPending = (key) => pending.find((turn) => turn.key === key && !turn.resolved) || null;

  const settle = (response) => {
    const turn = nextPending(response.key);
    if (turn) {
      turn.resolved = true;
      turn.stop();
      turn.node.remove();
    }
    addMessage({ role: 'assistant', ...response });
    (response.proposals || []).forEach((proposal) => {
      state.proposals.push({ ...proposal, agent: response.agent });
    });
    renderProposals();
    if (response.proposals?.length) {
      state.sidebars.artifacts = false;
      renderSidebars();
    }
  };

  try {
    await streamChat({
      projectId: state.activeProject?.id,
      sessionId: state.activeSessionId,
      message,
      target,
      mode: state.mode,
      language: state.language,
      route: configuredRoute,
    }, (event) => {
      if (event.type === 'progress') nextPending(event.key)?.update(event);
      else if (event.type === 'response') settle(event.response);
      else if (event.type === 'done') {
        state.sessions = event.sessions || state.sessions;
        renderSessions();
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    });
  } catch (error) {
    addMessage({ role: 'assistant', agentKey: 'localService', key: 'error', error: error.message });
    showToast(error.message, true);
  } finally {
    pending.forEach((turn) => {
      turn.stop();
      if (!turn.resolved) turn.node.remove();
    });
    state.sending = false;
    elements.send.disabled = false;
    elements.message.focus();
  }
}

async function bootstrap() {
  if (!token) {
    elements.status.textContent = '!';
    elements.status.classList.add('error');
    elements.topbarStatus.dataset.i18nAria = 'missingToken';
    elements.topbarStatus.setAttribute('aria-label', t('missingToken'));
    elements.modelHealth.classList.add('error');
    elements.send.disabled = true;
    return;
  }
  try {
    const query = new URLSearchParams();
    if (pinned.projectId) query.set('project', pinned.projectId);
    if (pinned.sessionId) query.set('session', pinned.sessionId);
    if (pinned.fresh) query.set('new', '1');
    const data = await api(`/api/bootstrap${query.toString() ? `?${query}` : ''}`);
    state.desktop = data.desktop || null;
    state.language = data.ui?.language || 'zh';
    state.theme = data.ui?.theme || 'light';
    setTheme(state.theme);
    setLanguage(state.language);
    applyProjectState(data);
    state.sidebars = {
      ...state.sidebars,
      ...(data.ui?.sidebars || {}),
    };
    renderSidebars();
    setMode(data.ui?.mode || 'chat');
    state.settings = data.settings || state.settings;
    state.modelOptions = data.modelOptions || state.modelOptions;
    state.health = { ...state.health, ...(data.health || {}) };
    renderModelOptions();
    renderSettings();
    renderHealth();
    void refreshHealth(0);
  } catch (error) {
    elements.status.textContent = '!';
    elements.status.classList.add('error');
    elements.topbarStatus.setAttribute('aria-label', error.message);
    elements.topbarStatus.title = error.message;
    delete elements.topbarStatus.dataset.i18nAria;
    delete elements.topbarStatus.dataset.i18nTitle;
    delete elements.topbarStatus.dataset.i18nValues;
    elements.modelHealth.classList.add('error');
    elements.send.disabled = true;
  }
}

window.addEventListener('focus', refreshHealthOnReturn);
document.addEventListener('visibilitychange', refreshHealthOnReturn);

elements.addProjects.addEventListener('click', requestProjectFolders);
elements.sessionMenuButton.addEventListener('click', toggleSessionMenu);
elements.sessionMenuNew.addEventListener('click', createSession);
elements.newSession.addEventListener('click', createSession);
elements.newWindow.addEventListener('click', () => openSessionWindow({ fresh: true }));
document.addEventListener('click', (event) => {
  if (state.sessionMenuOpen && !elements.sessionControl.contains(event.target)) closeSessionMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.sessionMenuOpen) closeSessionMenu();
});
elements.sidebarToggles.forEach((button) => button.addEventListener('click', () => toggleSidebar(button.dataset.sidebarToggle)));
elements.composer.addEventListener('submit', sendMessage);
elements.message.addEventListener('input', updateRoutePreview);
elements.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) elements.composer.requestSubmit();
});
elements.target.addEventListener('change', updateRoutePreview);
elements.modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode, true)));
elements.languageButtons.forEach((button) => button.addEventListener('click', () => setLanguage(button.dataset.language, true)));
elements.themeToggle.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark', true));
elements.mentionChips.forEach((button) => button.addEventListener('click', () => addRouteStep(button.dataset.mention)));
elements.refreshArtifacts.addEventListener('click', refreshArtifacts);
elements.closePreview.addEventListener('click', () => elements.previewDialog.close());
elements.previewDialog.addEventListener('click', (event) => {
  if (event.target === elements.previewDialog) elements.previewDialog.close();
});
elements.openSettings.addEventListener('click', async () => {
  renderSettings();
  setSettingsAgent(state.settingsAgent);
  elements.settingsDialog.showModal();
  try {
    const data = await api('/api/models');
    state.modelOptions = data.modelOptions || state.modelOptions;
    renderModelOptions();
  } catch {
    // Model names remain editable even when background discovery is unavailable.
  }
});
elements.closeSettings.addEventListener('click', () => elements.settingsDialog.close());
elements.settingsForm.addEventListener('submit', saveSettings);
elements.settingsTabs.forEach((tab) => tab.addEventListener('click', () => setSettingsAgent(tab.dataset.settingsTab)));
elements.reauthButtons.forEach((button) => button.addEventListener('click', () => requestReauthentication(button.dataset.reauth)));
elements.clearAgentSettings.addEventListener('click', () => {
  const model = elements.modelInputs.find((input) => input.dataset.model === state.settingsAgent);
  const prompt = elements.promptInputs.find((input) => input.dataset.prompt === state.settingsAgent);
  if (model) model.value = '';
  if (prompt) prompt.value = '';
  model?.focus();
});
elements.settingsDialog.addEventListener('click', (event) => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close();
});

// The macOS menu bar drives the same code paths the toolbar buttons do.
window.aiCouncil = {
  newSession: () => { void createSession(); },
  newWindow: () => openSessionWindow({ fresh: true }),
};

setTheme('light');
setLanguage('zh');
bootstrap();
