import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractFinalAnswer,
  extractReasoningSummary,
  MAX_ROUTE_TURNS,
  normalizeRoute,
  parseMentionOrder,
  stripArtifactBlocks,
} from './chat-protocol.mjs';

test('mentions preserve appearance order including repeated agents', () => {
  assert.deepEqual(parseMentionOrder('@Gemini 先看，@Claude 接着，最后 @Codex。'), ['gemini', 'claude', 'codex']);
  assert.deepEqual(parseMentionOrder('@Claude @claude @Gemini'), ['claude', 'claude', 'gemini']);
  assert.deepEqual(parseMentionOrder('no mentions'), []);
});

test('explicit routes preserve repeats and reject invalid or oversized queues', () => {
  assert.deepEqual(normalizeRoute(['Claude', 'claude', 'Gemini', 'CODEX']), [
    'claude',
    'claude',
    'gemini',
    'codex',
  ]);
  assert.throws(() => normalizeRoute(['unknown']), /Unknown route agent/);
  assert.throws(() => normalizeRoute(Array(MAX_ROUTE_TURNS + 1).fill('claude')), /at most 8 turns/);
});

test('reasoning summaries are separated from the Markdown answer', () => {
  const parsed = extractReasoningSummary(
    '<reasoning_summary>- Checked constraints\n- Compared options</reasoning_summary>\n\n## Answer\nUse option A.',
  );
  assert.equal(parsed.reasoning, '- Checked constraints\n- Compared options');
  assert.equal(parsed.content, '## Answer\nUse option A.');
  assert.deepEqual(extractReasoningSummary('Plain answer'), { reasoning: '', content: 'Plain answer' });
});

test('artifact envelopes are removed from the visible answer', () => {
  const output = 'Draft ready.\n\n<artifact path="artifacts/plan.md"># Plan</artifact>\n\nPlease review it.';
  assert.equal(stripArtifactBlocks(output), 'Draft ready.\n\n\n\nPlease review it.');
});

test('working notes between tool calls are kept out of the visible answer', () => {
  const output = [
    '<reasoning_summary>I will look at the files first.</reasoning_summary>',
    "I'll look at the working directory first.",
    'Reading the profile now.',
    '<final_answer>能看到。`profile/` 下有 5 份主档。</final_answer>',
  ].join('\n');
  assert.deepEqual(extractReasoningSummary(output), {
    reasoning: 'I will look at the files first.',
    content: '能看到。`profile/` 下有 5 份主档。',
  });
});

test('an answer with no final_answer marker is passed through whole', () => {
  assert.equal(extractFinalAnswer('plain single-turn reply'), 'plain single-turn reply');
  assert.deepEqual(
    extractReasoningSummary('<reasoning_summary>why</reasoning_summary>\n\nplain reply'),
    { reasoning: 'why', content: 'plain reply' },
  );
});

test('a restated final answer keeps the last version', () => {
  assert.equal(
    extractFinalAnswer('<final_answer>draft</final_answer> more work <final_answer>corrected</final_answer>'),
    'corrected',
  );
});

test('file drafts survive inside a marked final answer', () => {
  const content = extractFinalAnswer(
    '<final_answer>Here is the note.\n\n<artifact path="artifacts/note.md">body</artifact></final_answer>',
  );
  assert.match(content, /<artifact path="artifacts\/note\.md">body<\/artifact>/);
  assert.equal(stripArtifactBlocks(content), 'Here is the note.');
});
