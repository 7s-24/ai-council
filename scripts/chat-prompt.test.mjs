import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentPrompt } from './chat-prompt.mjs';

const relay = (position, relayTurns) => buildAgentPrompt({
  message: '选哪个方案？',
  roomHistory: 'Human: 旧话题\n\nGemini: 旧回答',
  relayTurns,
  turn: { agent: 'Claude', delivery: 'sequential', position, participants: ['Claude', 'Codex', 'Claude'] },
});

test('a later relay turn is told to answer the turns before it', () => {
  const prompt = relay(3, [
    { agent: 'Claude', content: '方案 A。', self: true },
    { agent: 'Codex', content: '方案 B 迁移成本更低。', self: false },
  ]);
  assert.match(prompt, /<relay_so_far>/);
  assert.match(prompt, /\[2\] Codex: 方案 B 迁移成本更低。/);
  assert.match(prompt, /You are turn 3 of 3 in a relay/);
  assert.match(prompt, /Do not answer as though you were the first to speak/);
});

test('a repeated speaker can tell its own earlier turn apart', () => {
  const prompt = relay(3, [
    { agent: 'Claude', content: '方案 A。', self: true },
    { agent: 'Codex', content: '方案 B。', self: false },
  ]);
  assert.match(prompt, /\[1\] Claude \(you, earlier\): 方案 A。/);
  assert.match(prompt, /Advance it instead of repeating it/);
});

test('a relay turn with no self-repeat is not told to advance itself', () => {
  const prompt = relay(2, [{ agent: 'Codex', content: '方案 B。', self: false }]);
  assert.match(prompt, /You are turn 2 of 3 in a relay/);
  assert.doesNotMatch(prompt, /Advance it instead/);
  assert.doesNotMatch(prompt, /\(you, earlier\)/);
});

test('the first speaker gets no relay history but knows others follow', () => {
  const prompt = relay(1, []);
  assert.doesNotMatch(prompt, /<relay_so_far>/);
  assert.match(prompt, /You speak first of 3 in a relay/);
});

test('the room history stays separate from this message’s relay turns', () => {
  const prompt = relay(2, [{ agent: 'Codex', content: '方案 B。', self: false }]);
  const history = prompt.slice(prompt.indexOf('<shared_history>'), prompt.indexOf('</shared_history>'));
  assert.match(history, /Gemini: 旧回答/);
  assert.doesNotMatch(history, /方案 B。/);
});

test('a parallel turn is given no relay instructions', () => {
  const prompt = buildAgentPrompt({
    message: '选哪个方案？',
    turn: { agent: 'Claude', delivery: 'parallel', position: 1, participants: ['Claude', 'Codex', 'Gemini'] },
  });
  assert.doesNotMatch(prompt, /relay/i);
});

test('a single-agent turn is not framed as a relay', () => {
  const prompt = buildAgentPrompt({
    message: '选哪个方案？',
    turn: { agent: 'Claude', delivery: 'sequential', position: 1, participants: ['Claude'] },
  });
  assert.doesNotMatch(prompt, /relay/i);
});
