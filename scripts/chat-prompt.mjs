function block(name, value, closingName = name) {
  return `<${name}>\n${value}\n</${closingName}>`;
}

function attribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

// The turns already taken for THIS message, kept apart from the room's older
// history. Numbering them makes a repeated speaker unambiguous -- in a
// Claude -> Codex -> Claude relay the last agent otherwise sees two entries
// labelled "Claude" and cannot tell which one is its own.
function relayBlock(relayTurns) {
  return block('relay_so_far', relayTurns.map((entry, index) => {
    const label = entry.self ? `${entry.agent} (you, earlier)` : entry.agent;
    return `[${index + 1}] ${label}: ${entry.content}`;
  }).join('\n\n'));
}

function relayContract(turn, relayTurns) {
  const total = turn.participants.length;
  if (turn.delivery !== 'sequential' || total < 2) return [];
  if (!relayTurns.length) {
    return [`You speak first of ${total} in a relay on this message; the other agents answer after you, so leave them something to build on.`];
  }

  const lines = [
    `You are turn ${turn.position} of ${total} in a relay on this message. <relay_so_far> holds the turns that already happened.`,
    'Respond to what those turns actually said: agree, disagree, correct a mistake, or add what they missed. Do not answer as though you were the first to speak, and do not restate their content.',
  ];
  if (relayTurns.some((entry) => entry.self)) {
    lines.push('One of those turns is your own earlier answer. Advance it instead of repeating it.');
  }
  return lines;
}

export function buildAgentPrompt({
  message,
  files = [],
  mode = 'chat',
  roomHistory = '',
  presetPrompt = '',
  turn = null,
  project = null,
  relayTurns = [],
}) {
  const sections = [];

  if (presetPrompt) sections.push(block('user_preset', presetPrompt));
  if (project) sections.push(`<project name="${attribute(project.name)}" environment="${attribute(project.environmentLabel)}" />`);
  if (turn) {
    const participants = turn.participants.join(', ');
    sections.push(`<room_turn agent="${turn.agent}" mode="${mode}" routing="server-managed" delivery="${turn.delivery}" position="${turn.position}/${turn.participants.length}" participants="${participants}" />`);
  }
  if (roomHistory) sections.push(block('shared_history', roomHistory));
  if (relayTurns.length) sections.push(relayBlock(relayTurns));
  if (files.length) {
    sections.push(files.map((file) => block(`file path="${file.path}"`, file.content, 'file')).join('\n\n'));
  }
  sections.push(block('current_message', message));

  const outputContract = [
    'Begin with <reasoning_summary> and </reasoning_summary> containing a concise, user-facing rationale summary, not hidden chain-of-thought.',
    'After the closing tag, answer the current message in Markdown.',
    'Wrap that answer in <final_answer> and </final_answer>. Notes you write while still working stay outside those tags and are not shown.',
  ];
  if (turn) outputContract.push(...relayContract(turn, relayTurns));
  if (mode === 'code') {
    outputContract.push(
      'A requested file draft may be returned as <artifact path="artifacts/name.md">TEXT</artifact>. Use at most four artifacts and only .md, .txt, .json, .yaml, .yml, or .csv paths beneath artifacts/.',
    );
  }
  sections.push(block('output_contract', outputContract.join('\n')));

  return sections.join('\n\n');
}
