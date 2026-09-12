import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentPrompt } from './chat-prompt.mjs';
import {
  emptyChatSettings,
  normalizeChatSettings,
  normalizeUISettings,
  parseAgyModelOutput,
  resolveAgyModel,
} from './chat-settings.mjs';

test('chat settings start with no model override or preset prompt', () => {
  assert.deepEqual(normalizeChatSettings({}), emptyChatSettings());
});

test('chat settings preserve independent agent model and prompt values', () => {
  const settings = normalizeChatSettings({
    agents: {
      claude: { model: 'sonnet', prompt: 'Focus on product risks.' },
      codex: { model: 'gpt-5.5', prompt: 'Review implementation details.' },
    },
  });
  assert.deepEqual(settings.agents.claude, { model: 'sonnet', prompt: 'Focus on product risks.' });
  assert.deepEqual(settings.agents.codex, { model: 'gpt-5.5', prompt: 'Review implementation details.' });
  assert.deepEqual(settings.agents.gemini, { model: '', prompt: '' });
});

test('default agent prompt has no persona or review instructions', () => {
  const prompt = buildAgentPrompt({
    message: 'Hello',
    files: [],
    turn: {
      agent: 'Claude',
      delivery: 'sequential',
      position: 1,
      participants: ['Claude', 'Codex', 'Gemini'],
    },
  });
  assert.doesNotMatch(prompt, /You are|plan-review|identify risks|compare alternatives/i);
  assert.doesNotMatch(prompt, /<user_preset>/i);
  assert.match(prompt, /routing="server-managed"/);
  assert.match(prompt, /participants="Claude, Codex, Gemini"/);
  assert.match(prompt, /<current_message>\nHello/);
});

test('preset prompt is injected only when configured', () => {
  const prompt = buildAgentPrompt({ message: 'Hello', presetPrompt: 'Be concise.' });
  assert.match(prompt, /<user_preset>\nBe concise\.\n<\/user_preset>/);
});

test('Antigravity model selection uses a supported effort-qualified slug', () => {
  const available = [
    'gemini-3.7-flash-high',
    'gemini-3.7-flash-medium',
    'gemini-3.1-pro-high',
  ];
  assert.equal(resolveAgyModel('gemini-3.7-flash-high', available), 'gemini-3.7-flash-high');
  assert.equal(resolveAgyModel('gemini-3.1-pro', available), 'gemini-3.1-pro-high');
  assert.equal(resolveAgyModel('gemini-3.5-flash', available), 'gemini-3.7-flash-high');
  assert.throws(() => resolveAgyModel('gemini-does-not-exist', available), /不可用/);
});

test('Antigravity model output ignores progress text and de-duplicates models', () => {
  assert.deepEqual(parseAgyModelOutput(`Fetching available models...\ngemini-3.7-flash-high extra\ngemini-3.7-flash-high\ngpt-5.5`), [
    'gemini-3.7-flash-high',
  ]);
});

test('UI settings persist language, theme, active mode, and visible sidebars', () => {
  assert.deepEqual(normalizeUISettings({
    mode: 'code',
    language: 'en',
    theme: 'dark',
    sidebars: { projects: true, files: true, artifacts: false },
  }), {
    mode: 'code',
    language: 'en',
    theme: 'dark',
    sidebars: { projects: true, artifacts: false },
  });
  assert.deepEqual(normalizeUISettings({ mode: 'invalid' }), {
    mode: 'chat',
    language: 'zh',
    theme: 'light',
    sidebars: { projects: false, artifacts: false },
  });
});
