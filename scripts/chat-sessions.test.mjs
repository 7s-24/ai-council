import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveSessionTitle,
  isSessionId,
  makeSessionId,
  normalizeSessionIndex,
  normalizeSessionTitle,
  publicSession,
  sortSessions,
  summarizeTranscript,
} from './chat-sessions.mjs';

test('session ids accept legacy rooms and stay unique for new sessions', () => {
  assert.ok(isSessionId('20260901073724'));
  assert.ok(isSessionId('20260901073724-a1b2'));
  assert.ok(!isSessionId('2026090107372'));
  assert.ok(!isSessionId('../escape'));
  assert.ok(!isSessionId('20260901073724-A1B2'));
  assert.ok(!isSessionId(''));

  const date = new Date('2026-09-01T07:37:24.000Z');
  assert.equal(makeSessionId(date, 'a1b2'), '20260901073724-a1b2');
  assert.notEqual(makeSessionId(date), makeSessionId(date));
  assert.ok(isSessionId(makeSessionId()));
});

test('session titles collapse whitespace and stay bounded', () => {
  assert.equal(normalizeSessionTitle('  review   the\nplan '), 'review the plan');
  assert.equal(normalizeSessionTitle('   ', 'fallback'), 'fallback');
  assert.equal(normalizeSessionTitle(42, 'fallback'), 'fallback');
  assert.equal([...normalizeSessionTitle('好'.repeat(200))].length, 80);
});

test('a session is named after the first human turn', () => {
  const transcript = [
    { role: 'assistant', agent: 'Claude', content: 'ready', createdAt: '2026-09-01T00:00:00.000Z' },
    { role: 'user', content: '审阅这个计划', createdAt: '2026-09-01T00:01:00.000Z' },
    { role: 'assistant', agent: 'Claude', content: 'done', createdAt: '2026-09-01T00:02:00.000Z' },
  ];
  assert.equal(deriveSessionTitle(transcript), '审阅这个计划');
  assert.deepEqual(summarizeTranscript(transcript), {
    title: '审阅这个计划',
    messages: 3,
    updatedAt: '2026-09-01T00:02:00.000Z',
  });
  assert.deepEqual(summarizeTranscript([]), { title: '', messages: 0, updatedAt: null });
  assert.deepEqual(summarizeTranscript('not an array'), { title: '', messages: 0, updatedAt: null });
});

test('a stored index drops malformed entries and marks unsummarized ones', () => {
  const entries = normalizeSessionIndex({
    sessions: [
      { id: '20260901073724', title: 'first', messages: 4, createdAt: 'a', updatedAt: 'b' },
      { id: 'not-a-session', title: 'bad' },
      { id: '20260901073725-aaaa' },
      null,
    ],
  });
  assert.deepEqual([...entries.keys()], ['20260901073724', '20260901073725-aaaa']);
  assert.equal(entries.get('20260901073725-aaaa').title, null);
  assert.equal(entries.get('20260901073725-aaaa').messages, null);
  assert.deepEqual([...normalizeSessionIndex({}).keys()], []);
});

test('sessions list newest activity first', () => {
  const order = sortSessions([
    { id: '20260901073724', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: '20260901073726', updatedAt: '2026-09-03T00:00:00.000Z' },
    { id: '20260901073725', updatedAt: '2026-09-02T00:00:00.000Z' },
  ]).map((session) => session.id);
  assert.deepEqual(order, ['20260901073726', '20260901073725', '20260901073724']);
});

test('the public shape never leaks the hydration sentinels', () => {
  assert.deepEqual(
    publicSession({ id: '20260901073724', title: null, messages: null, createdAt: 'a', updatedAt: null }),
    { id: '20260901073724', title: '', messages: 0, createdAt: 'a', updatedAt: 'a' },
  );
});
