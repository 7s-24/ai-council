const agentAliases = new Map([
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['gemini', 'gemini'],
]);

export const MAX_ROUTE_TURNS = 8;

export function parseMentionOrder(message) {
  const order = [];
  const expression = /@(claude|codex|gemini)\b/giu;
  let match;
  while ((match = expression.exec(String(message)))) {
    const key = agentAliases.get(match[1].toLowerCase());
    if (key) order.push(key);
  }
  return order;
}

export function normalizeRoute(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Route must be an array.');
  if (value.length > MAX_ROUTE_TURNS) {
    throw new Error(`Route supports at most ${MAX_ROUTE_TURNS} turns.`);
  }

  return value.map((rawAgent) => {
    const key = agentAliases.get(String(rawAgent).toLowerCase());
    if (!key) throw new Error(`Unknown route agent: ${rawAgent}`);
    return key;
  });
}

// In Code mode an engine streams back every assistant turn it took, so the
// "let me look at the files first" notes arrive glued to the real answer. When
// the model marks its answer, keep only that; otherwise fall back to the whole
// remainder, which is what a single-turn Chat reply looks like.
export function extractFinalAnswer(output) {
  const matches = [...String(output).matchAll(/<final_answer>\s*([\s\S]*?)\s*<\/final_answer>/gi)];
  if (!matches.length) return String(output).trim();
  return matches[matches.length - 1][1].trim();
}

export function extractReasoningSummary(output) {
  const raw = String(output).trim();
  const match = raw.match(/<reasoning_summary>\s*([\s\S]*?)\s*<\/reasoning_summary>/i);
  if (!match) return { reasoning: '', content: extractFinalAnswer(raw) };
  return {
    reasoning: match[1].trim(),
    content: extractFinalAnswer(raw.replace(match[0], '').trim()),
  };
}

export function stripArtifactBlocks(output) {
  return String(output)
    .replace(/<artifact\s+path="[^"]+">\s*[\s\S]*?\s*<\/artifact>/gi, '')
    .trim();
}
