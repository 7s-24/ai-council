// Turning an engine's raw stream into the two things a waiting human wants to
// see: what the model is touching right now, and the reasoning summary as it is
// written. A Code-mode turn runs for a minute or more, and "正在思考" alone for
// that long is indistinguishable from a hang.

const MAX_DETAIL = 96;

function collapse(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function truncate(value) {
  const text = collapse(value);
  return text.length > MAX_DETAIL ? `${[...text].slice(0, MAX_DETAIL).join('')}…` : text;
}

// Codex routes everything through a login shell, so the interesting part is
// inside the quoted -c argument rather than the wrapper.
export function shortenCommand(command) {
  const text = collapse(command);
  const shell = text.match(/^\S*(?:sh|zsh|bash)\s+-[a-z]*c\s+(.*)$/i);
  const inner = shell ? shell[1] : text;
  const unquoted = inner.replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
  return truncate(unquoted);
}

/** `{ tool, detail }` for a stream event that represents tool activity, else null. */
export function describeToolEvent(event) {
  if (!event || typeof event !== 'object') return null;

  // Claude: { type: 'tool_use', tool: { name, input } }
  const name = event.tool?.name;
  if (typeof name === 'string' && name) {
    const input = event.tool.input && typeof event.tool.input === 'object' ? event.tool.input : {};
    if (typeof input.command === 'string' && input.command) {
      return { tool: name, detail: shortenCommand(input.command) };
    }
    const target = input.file_path || input.path || input.pattern || input.query;
    return { tool: name, detail: typeof target === 'string' ? truncate(target) : '' };
  }

  // Codex: { type: 'item.started' | 'item.completed', item: { type, command } }
  const item = event.item;
  if (item && typeof item === 'object' && item.type === 'command_execution' && typeof item.command === 'string') {
    return { tool: 'Bash', detail: shortenCommand(item.command) };
  }

  return null;
}

/**
 * Accumulates streamed text and reports the reasoning summary as it grows.
 * The stream also carries tool output and the final answer, so only the part
 * inside <reasoning_summary> is ever surfaced as reasoning.
 */
export function createTurnProgress() {
  let buffer = '';
  return {
    addChunk(chunk) {
      buffer += String(chunk ?? '');
      return this.snapshot();
    },
    snapshot() {
      const open = buffer.indexOf('<reasoning_summary>');
      if (open === -1) return { phase: 'starting', reasoning: '' };
      const after = buffer.slice(open + '<reasoning_summary>'.length);
      const close = after.indexOf('</reasoning_summary>');
      if (close === -1) return { phase: 'reasoning', reasoning: after.trimStart() };
      return { phase: 'answering', reasoning: after.slice(0, close).trim() };
    },
  };
}
