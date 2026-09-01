const params = new URLSearchParams(window.location.search);
const token = params.get('token') || sessionStorage.getItem('plan-review-token') || '';
if (token) {
  sessionStorage.setItem('plan-review-token', token);
  history.replaceState(null, '', window.location.pathname);
}

const agentLabels = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const agentLogos = {
  claude: '/logos/claude.svg',
  codex: '/logos/codex.svg',
  gemini: '/logos/gemini.svg',
};

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
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || '图片');

const state = {
  files: [],
  selected: new Set(),
  artifacts: [],
  proposals: [],
  sending: false,
  mode: 'chat',
};

const elements = {
  status: document.querySelector('#room-status'),
  statusDot: document.querySelector('.status-dot'),
  fileSearch: document.querySelector('#file-search'),
  fileList: document.querySelector('#file-list'),
  selectedCount: document.querySelector('#selected-count'),
  messages: document.querySelector('#messages'),
  emptyState: document.querySelector('#empty-state'),
  composer: document.querySelector('#composer'),
  target: document.querySelector('#target'),
  message: document.querySelector('#message'),
  send: document.querySelector('#send'),
  modeButtons: [...document.querySelectorAll('.mode-button')],
  modeDescription: document.querySelector('#mode-description'),
  composerMode: document.querySelector('#composer-mode'),
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
    throw new Error(`本地服务返回了无法解析的响应（${response.status}）`);
  }
  if (!response.ok) throw new Error(value.error || `请求失败（${response.status}）`);
  return value;
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes > 10240 ? 0 : 1)} KB`;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)} 秒`;
}

function parseMentionOrder(message) {
  const order = [];
  const seen = new Set();
  const expression = /@(claude|codex|gemini)\b/giu;
  let match;
  while ((match = expression.exec(String(message)))) {
    const key = match[1].toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

function routeFor(message, target = elements.target.value) {
  const mentions = parseMentionOrder(message);
  if (mentions.length) return { keys: mentions, sequential: true };
  return {
    keys: target === 'group' ? ['claude', 'codex', 'gemini'] : [target],
    sequential: false,
  };
}

function updateRoutePreview() {
  const route = routeFor(elements.message.value);
  const labels = route.keys.map((key) => agentLabels[key]).join(' → ');
  elements.routePreview.textContent = route.sequential
    ? `回复顺序：${labels}`
    : (elements.target.value === 'group' ? '未指定 @：三者并行' : `未指定 @：仅 ${labels}`);
  elements.routePreview.classList.toggle('sequential', route.sequential);
}

function setMode(mode) {
  state.mode = mode === 'code' ? 'code' : 'chat';
  document.body.dataset.mode = state.mode;
  elements.modeButtons.forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (state.mode === 'code') {
    elements.modeDescription.textContent = '生成受控文件草案；写入前仍需你确认';
    elements.composerMode.textContent = 'Code · 草案需确认';
    elements.message.placeholder = '例如：@Codex @Claude 请先设计，再复核，并生成 artifacts/implementation-plan.md 草案。';
  } else {
    elements.modeDescription.textContent = '讨论、分析和审阅，不生成文件草案';
    elements.composerMode.textContent = 'Chat 模式';
    elements.message.placeholder = '例如：@Gemini @Claude @Codex 请按顺序审阅这个计划。';
  }
}

function insertMention(name) {
  const textarea = elements.message;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  const insertion = `${prefix}@${name} `;
  textarea.value = `${before}${insertion}${after}`;
  const cursor = start + insertion.length;
  textarea.setSelectionRange(cursor, cursor);
  textarea.focus();
  updateRoutePreview();
}

function renderFiles() {
  const query = elements.fileSearch.value.trim().toLowerCase();
  const fragment = document.createDocumentFragment();
  const matches = state.files.filter((file) => file.path.toLowerCase().includes(query));
  for (const file of matches) {
    const row = document.createElement('label');
    row.className = 'file-row';
    row.title = `${file.path} · ${formatBytes(file.size)}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(file.path);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && state.selected.size >= 12) {
        checkbox.checked = false;
        showToast('每轮最多选择 12 个文件', true);
        return;
      }
      if (checkbox.checked) state.selected.add(file.path);
      else state.selected.delete(file.path);
      elements.selectedCount.textContent = `${state.selected.size} / 12`;
    });

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.path;

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'preview-button';
    preview.textContent = '预览';
    preview.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      previewFile(file.path);
    });

    row.append(checkbox, name, preview);
    fragment.append(row);
  }
  elements.fileList.replaceChildren(fragment);
}

async function previewFile(filePath) {
  try {
    const data = await api('/api/files/read', {
      method: 'POST',
      body: JSON.stringify({ files: [filePath] }),
    });
    elements.previewTitle.textContent = filePath;
    elements.previewContent.textContent = data.files[0]?.content || '(空文件)';
    elements.previewDialog.showModal();
  } catch (error) {
    showToast(error.message, true);
  }
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
    button.textContent = '复制';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || '');
        button.textContent = '已复制';
        window.setTimeout(() => { button.textContent = '复制'; }, 1400);
      } catch {
        showToast('无法访问剪贴板', true);
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

function addMessage(item) {
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
  label.textContent = item.role === 'user' ? '你' : (item.agent || '模型');
  meta.append(label);

  if (item.role === 'user') {
    const context = document.createElement('span');
    context.className = 'message-context';
    const mode = item.mode === 'code' ? 'Code' : 'Chat';
    const route = Array.isArray(item.route) ? item.route.map((agent) => agentLabels[agent] || agent).join(' → ') : '';
    context.textContent = [mode, route].filter(Boolean).join(' · ');
    meta.append(context);
  }
  stack.append(meta);

  if (item.reasoning) {
    const details = document.createElement('details');
    details.className = 'reasoning-block';
    details.open = true;
    const summary = document.createElement('summary');
    const summaryLabel = document.createElement('span');
    summaryLabel.textContent = '思考摘要';
    const duration = document.createElement('span');
    duration.className = 'reasoning-duration';
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
    files.textContent = `附带 ${item.files.length} 个文件`;
    stack.append(files);
  }

  if (item.role !== 'user') article.append(createAvatar(key, item.agent || '模型'));
  article.append(stack);
  elements.messages.append(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return article;
}

function addThinking(route) {
  return route.keys.map((key, index) => {
    const label = agentLabels[key];
    const text = route.sequential && index > 0 ? '等待前序回复' : '正在思考';
    const node = addMessage({ role: 'assistant', key, agent: label, content: text });
    node.classList.add('thinking');
    const body = node.querySelector('.message-body');
    body.replaceChildren();
    const indicator = document.createElement('span');
    indicator.className = 'thinking-dots';
    indicator.textContent = text;
    body.append(indicator);
    return node;
  });
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
      ? `${proposal.agent} · 已拦截：${proposal.reason}`
      : `${proposal.agent} · ${formatBytes(new Blob([proposal.content]).size)} · ${proposal.operation === 'update' ? '更新' : '新建'}`;
    const actions = document.createElement('div');
    actions.className = 'proposal-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = '查看';
    view.addEventListener('click', () => {
      elements.previewTitle.textContent = `${proposal.path}（待确认）`;
      elements.previewContent.textContent = proposal.content;
      elements.previewDialog.showModal();
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'apply-button';
    apply.textContent = proposal.rejected ? '已拦截' : '应用';
    apply.disabled = Boolean(proposal.rejected);
    if (!proposal.rejected) apply.addEventListener('click', () => applyProposal(index, apply));
    actions.append(view, apply);
    card.append(path, meta, actions);
    fragment.append(card);
  });
  elements.proposals.replaceChildren(fragment);
}

function renderArtifacts() {
  if (!state.artifacts.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '还没有由聊天室创建的文件。';
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
    meta.textContent = `${formatBytes(artifact.size)} · ${new Date(artifact.updatedAt).toLocaleString()}`;
    row.append(path, meta);
    fragment.append(row);
  });
  elements.artifactList.replaceChildren(fragment);
}

async function applyProposal(index, button) {
  const proposal = state.proposals[index];
  if (!proposal) return;
  button.disabled = true;
  button.textContent = '应用中…';
  try {
    const data = await api('/api/artifacts/apply', {
      method: 'POST',
      body: JSON.stringify({
        path: proposal.path,
        content: proposal.content,
        baseHash: proposal.baseHash,
        agent: proposal.agent,
      }),
    });
    state.artifacts = data.artifacts;
    state.proposals.splice(index, 1);
    renderProposals();
    renderArtifacts();
    showToast(`${data.artifact.path} 已${data.artifact.operation === 'created' ? '创建' : '更新'}`);
  } catch (error) {
    button.disabled = false;
    button.textContent = '应用';
    showToast(error.message, true);
  }
}

async function refreshArtifacts() {
  try {
    const data = await api('/api/artifacts');
    state.artifacts = data.artifacts;
    renderArtifacts();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.sending) return;
  const message = elements.message.value.trim();
  if (!message) return;

  state.sending = true;
  elements.send.disabled = true;
  const target = elements.target.value;
  const files = [...state.selected];
  const route = routeFor(message, target);
  addMessage({ role: 'user', content: message, files, mode: state.mode, route: route.keys });
  elements.message.value = '';
  updateRoutePreview();
  const pending = addThinking(route);

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, target, files, mode: state.mode }),
    });
    pending.forEach((node) => node.remove());
    data.responses.forEach((response) => {
      addMessage({ role: 'assistant', ...response });
      (response.proposals || []).forEach((proposal) => {
        state.proposals.push({ ...proposal, agent: response.agent });
      });
    });
    renderProposals();
  } catch (error) {
    pending.forEach((node) => node.remove());
    addMessage({ role: 'assistant', agent: '本地服务', key: 'error', error: error.message });
    showToast(error.message, true);
  } finally {
    state.sending = false;
    elements.send.disabled = false;
    elements.message.focus();
  }
}

async function bootstrap() {
  if (!token) {
    elements.status.textContent = '缺少访问令牌，请从终端输出的完整地址进入';
    elements.statusDot.classList.add('error');
    elements.send.disabled = true;
    return;
  }
  try {
    const data = await api('/api/bootstrap');
    state.files = data.files;
    state.artifacts = data.artifacts;
    renderFiles();
    renderArtifacts();
    data.transcript.forEach((item) => addMessage({ ...item, key: item.key || item.agent?.toLowerCase() }));
    elements.status.textContent = `房间 ${data.roomId} · Claude / Codex / Gemini 已就绪`;
    elements.statusDot.classList.add('ready');
  } catch (error) {
    elements.status.textContent = error.message;
    elements.statusDot.classList.add('error');
    elements.send.disabled = true;
  }
}

elements.fileSearch.addEventListener('input', renderFiles);
elements.composer.addEventListener('submit', sendMessage);
elements.message.addEventListener('input', updateRoutePreview);
elements.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) elements.composer.requestSubmit();
});
elements.target.addEventListener('change', updateRoutePreview);
elements.modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
elements.mentionChips.forEach((button) => button.addEventListener('click', () => insertMention(button.dataset.mention)));
elements.refreshArtifacts.addEventListener('click', refreshArtifacts);
elements.closePreview.addEventListener('click', () => elements.previewDialog.close());
elements.previewDialog.addEventListener('click', (event) => {
  if (event.target === elements.previewDialog) elements.previewDialog.close();
});

setMode('chat');
updateRoutePreview();
bootstrap();
