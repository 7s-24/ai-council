import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReasoningSummary, parseMentionOrder, stripArtifactBlocks } from './chat-protocol.mjs';

test('mentions preserve first appearance order and de-duplicate agents', () => {
  assert.deepEqual(parseMentionOrder('@Gemini 先看，@Claude 接着，最后 @Codex。'), ['gemini', 'claude', 'codex']);
  assert.deepEqual(parseMentionOrder('@Claude @claude @Gemini'), ['claude', 'gemini']);
  assert.deepEqual(parseMentionOrder('no mentions'), []);
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
