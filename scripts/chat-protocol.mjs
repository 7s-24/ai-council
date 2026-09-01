const agentAliases = new Map([
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['gemini', 'gemini'],
]);

export function parseMentionOrder(message) {
  const order = [];
  const seen = new Set();
  const expression = /@(claude|codex|gemini)\b/giu;
  let match;
  while ((match = expression.exec(String(message)))) {
    const key = agentAliases.get(match[1].toLowerCase());
    if (key && !seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

export function extractReasoningSummary(output) {
  const raw = String(output).trim();
  const match = raw.match(/<reasoning_summary>\s*([\s\S]*?)\s*<\/reasoning_summary>/i);
  if (!match) return { reasoning: '', content: raw };
  return {
    reasoning: match[1].trim(),
    content: raw.replace(match[0], '').trim(),
  };
}

export function stripArtifactBlocks(output) {
  return String(output)
    .replace(/<artifact\s+path="[^"]+">\s*[\s\S]*?\s*<\/artifact>/gi, '')
    .trim();
}
