export const CHAT_AGENT_KEYS = ['claude', 'codex', 'gemini'];

export const emptyChatSettings = () => ({
  agents: Object.fromEntries(CHAT_AGENT_KEYS.map((key) => [key, { model: '', prompt: '' }])),
});

export function normalizeChatSettings(value) {
  const source = value && typeof value === 'object' ? value.agents : null;
  const settings = emptyChatSettings();

  for (const key of CHAT_AGENT_KEYS) {
    const candidate = source?.[key];
    if (!candidate || typeof candidate !== 'object') continue;

    const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
    const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
    if (model.length > 120) throw new Error(`${key} model name is too long.`);
    if (model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) {
      throw new Error(`${key} model name contains unsupported characters.`);
    }
    if (prompt.length > 12000) throw new Error(`${key} preset prompt is too long.`);
    settings.agents[key] = { model, prompt };
  }

  return settings;
}

export function resolveAgyModel(model, availableModels) {
  if (!model || !availableModels.length) return model;
  if (availableModels.includes(model)) return model;
  if (availableModels.includes(`${model}-high`)) return `${model}-high`;

  if (model === 'gemini-3.5-flash') {
    const currentFlash = availableModels.find((value) => /^gemini-[\d.]+-flash-high$/.test(value));
    if (currentFlash) return currentFlash;
  }

  throw new Error(`Gemini 模型不可用：${model}`);
}

export function parseAgyModelOutput(value) {
  return [...new Set(String(value || '')
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((model) => /^gemini-[A-Za-z0-9.-]+$/.test(model)))];
}

export function normalizeUISettings(value) {
  return {
    mode: value?.mode === 'code' ? 'code' : 'chat',
    language: value?.language === 'en' ? 'en' : 'zh',
    theme: value?.theme === 'dark' ? 'dark' : 'light',
    sidebars: {
      projects: value?.sidebars?.projects === true,
      artifacts: value?.sidebars?.artifacts === true,
    },
  };
}
