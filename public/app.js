const params = new URLSearchParams(window.location.search);
const token = params.get('token') || sessionStorage.getItem('plan-review-token') || '';
if (token) {
  sessionStorage.setItem('plan-review-token', token);
  history.replaceState(null, '', window.location.pathname);
}

const state = {
  files: [],
  selected: new Set(),
  artifacts: [],
  proposals: [],
  sending: false,
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
  allowArtifacts: document.querySelector('#allow-artifacts'),
  message: document.querySelector('#message'),
  send: document.querySelector('#send'),
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

function addMessage(item) {
  elements.emptyState.hidden = true;
  elements.messages.classList.add('active');

  const article = document.createElement('article');
  const key = (item.key || '').toLowerCase();
  article.className = `message ${item.role === 'user' ? 'user' : key}${item.error ? ' error' : ''}`;
  if (item.id) article.dataset.messageId = item.id;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  if (item.role !== 'user') {
    const dot = document.createElement('span');
    dot.className = 'agent-dot';
    meta.append(dot);
  }
  const label = document.createElement('span');
  label.textContent = item.role === 'user' ? '你' : (item.agent || '模型');
  meta.append(label);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = item.error || item.content;
  article.append(meta, body);

  if (item.files?.length) {
    const files = document.createElement('div');
    files.className = 'message-files';
    files.textContent = `附带 ${item.files.length} 个文件`;
    article.append(files);
  }
  elements.messages.append(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return article;
}

function addThinking(target) {
  const labels = target === 'group' ? ['Claude', 'Codex', 'Gemini'] : [target[0].toUpperCase() + target.slice(1)];
  return labels.map((label) => {
    const node = addMessage({ role: 'assistant', key: label.toLowerCase(), agent: label, content: '' });
    node.classList.add('thinking');
    node.querySelector('.message-body').innerHTML = '<span class="thinking-dots">正在审阅</span>';
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
  addMessage({ role: 'user', content: message, files });
  elements.message.value = '';
  const pending = addThinking(target);

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        target,
        files,
        allowArtifacts: elements.allowArtifacts.checked,
      }),
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
    data.transcript.forEach((item) => addMessage({ ...item, key: item.agent?.toLowerCase() }));
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
elements.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) elements.composer.requestSubmit();
});
elements.refreshArtifacts.addEventListener('click', refreshArtifacts);
elements.closePreview.addEventListener('click', () => elements.previewDialog.close());
elements.previewDialog.addEventListener('click', (event) => {
  if (event.target === elements.previewDialog) elements.previewDialog.close();
});

bootstrap();
