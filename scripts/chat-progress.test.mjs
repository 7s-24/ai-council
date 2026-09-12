import assert from 'node:assert/strict';
import test from 'node:test';
import { createTurnProgress, describeToolEvent, shortenCommand } from './chat-progress.mjs';

test('Claude tool events name the file or command being touched', () => {
  assert.deepEqual(
    describeToolEvent({ type: 'tool_use', tool: { name: 'Read', input: { file_path: '/a/b/chat-prompt.mjs' } } }),
    { tool: 'Read', detail: '/a/b/chat-prompt.mjs' },
  );
  assert.deepEqual(
    describeToolEvent({ type: 'tool_use', tool: { name: 'Bash', input: { command: 'ls -la scripts/' } } }),
    { tool: 'Bash', detail: 'ls -la scripts/' },
  );
  // The first event of a pair arrives before the input is filled in.
  assert.deepEqual(
    describeToolEvent({ type: 'tool_use', tool: { name: 'Read', input: {} } }),
    { tool: 'Read', detail: '' },
  );
});

test('Codex command items are recognised through their shell wrapper', () => {
  assert.deepEqual(
    describeToolEvent({
      type: 'item.completed',
      item: { type: 'command_execution', command: '/bin/zsh -lc "sed -n \'1,220p\' .ai-team/TASK.md"' },
    }),
    { tool: 'Bash', detail: "sed -n '1,220p' .ai-team/TASK.md" },
  );
});

test('non-tool events are ignored', () => {
  assert.equal(describeToolEvent({ type: 'text', result: 'hello' }), null);
  assert.equal(describeToolEvent(null), null);
  assert.equal(describeToolEvent('nonsense'), null);
  assert.equal(describeToolEvent({ item: { type: 'other' } }), null);
});

test('long commands and paths are shortened for a one-line status', () => {
  const long = shortenCommand(`/bin/zsh -lc "${'echo '.repeat(60)}"`);
  assert.ok(long.length <= 97, long.length);
  assert.ok(long.endsWith('…'));
  assert.equal(shortenCommand('  ls    -la\n  scripts/  '), 'ls -la scripts/');
});

test('the reasoning summary is revealed as it streams in', () => {
  const progress = createTurnProgress();
  assert.deepEqual(progress.addChunk('<re'), { phase: 'starting', reasoning: '' });
  assert.deepEqual(progress.addChunk('asoning_summary>\nLooked at '), { phase: 'reasoning', reasoning: 'Looked at ' });
  assert.deepEqual(progress.addChunk('the scripts folder'), { phase: 'reasoning', reasoning: 'Looked at the scripts folder' });
  assert.deepEqual(
    progress.addChunk('.\n</reasoning_summary>\n\nHere is the answer'),
    { phase: 'answering', reasoning: 'Looked at the scripts folder.' },
  );
});

test('tool output in the stream is never shown as reasoning', () => {
  const progress = createTurnProgress();
  progress.addChunk('<reasoning_summary>Reading files.</reasoning_summary>\n');
  progress.addChunk('total 216\ndrwxr-xr-x  20 reinyu  staff   640 scripts\n');
  assert.deepEqual(progress.snapshot(), { phase: 'answering', reasoning: 'Reading files.' });
});
