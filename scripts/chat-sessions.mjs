import crypto from 'node:crypto';

export const MAX_SESSIONS_PER_PROJECT = 60;
export const SESSION_TITLE_LIMIT = 80;

// Legacy rooms are bare 14-digit stamps; new sessions add a random suffix so two
// windows created in the same second cannot collide.
const SESSION_ID_PATTERN = /^\d{14}(?:-[a-z0-9]{4})?$/;

export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function makeSessionId(date = new Date(), suffix = crypto.randomBytes(2).toString('hex')) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-${suffix}`;
}

export function normalizeSessionTitle(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text) return fallback;
  return [...text].slice(0, SESSION_TITLE_LIMIT).join('');
}

// A session inherits its name from the first thing the human said in it, so the
// list reads like a conversation history instead of a wall of timestamps.
export function deriveSessionTitle(transcript) {
  const items = Array.isArray(transcript) ? transcript : [];
  const first = items.find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim());
  return first ? normalizeSessionTitle(first.content) : '';
}

export function summarizeTranscript(transcript) {
  const items = Array.isArray(transcript) ? transcript : [];
  const last = items[items.length - 1];
  return {
    title: deriveSessionTitle(items),
    messages: items.length,
    updatedAt: last?.createdAt || null,
  };
}

// `null` on title/messages/updatedAt means "not summarized yet"; the caller
// hydrates those entries from their transcript and writes the index back.
export function normalizeSessionEntry(value) {
  if (!value || typeof value !== 'object' || !isSessionId(value.id)) return null;
  const messages = Number.isInteger(value.messages) && value.messages >= 0 ? value.messages : null;
  return {
    id: value.id,
    title: typeof value.title === 'string' ? normalizeSessionTitle(value.title) : null,
    messages,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

export function normalizeSessionIndex(value) {
  const source = Array.isArray(value?.sessions) ? value.sessions : [];
  const entries = new Map();
  for (const item of source) {
    const entry = normalizeSessionEntry(item);
    if (entry) entries.set(entry.id, entry);
  }
  return entries;
}

export function sortSessions(sessions) {
  return [...sessions].sort((left, right) => (
    String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''))
      || String(right.id).localeCompare(String(left.id))
  ));
}

export function publicSession(entry) {
  return {
    id: entry.id,
    title: entry.title || '',
    messages: entry.messages || 0,
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || entry.createdAt || null,
  };
}
