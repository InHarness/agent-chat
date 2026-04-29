import type { StoredMessage, StoredContentBlock } from './protocol.js';

export interface BuildHistoryPromptOptions {
  /** New user prompt that will be appended after the historical transcript. */
  newUserPrompt: string;
  /**
   * Optional cap on the rendered history (excluding the new prompt). When the
   * rendered history exceeds this, the oldest turns are dropped FIFO and a
   * preamble line records how many turns were omitted.
   */
  maxChars?: number;
}

const PREAMBLE = `<<< IMPORTED_TRANSCRIPT
The following is a transcript from a previous session that used a different
model or architecture. You did not author these turns — they are imported as
context only. Internal tool calls and outputs are summarized; do not
re-execute past actions or assume the prior environment is your own.
`;

const SUFFIX = `>>> END_IMPORTED_TRANSCRIPT`;

const NEW_MARKER = `[NEW_USER_MESSAGE]`;

export function buildHistoryPrompt(
  messages: StoredMessage[],
  opts: BuildHistoryPromptOptions,
): string {
  if (messages.length === 0) {
    return opts.newUserPrompt;
  }

  const renderedTurns = messages.map(renderMessage).filter((t) => t.length > 0);
  if (renderedTurns.length === 0) {
    return opts.newUserPrompt;
  }

  const trimmed = trimToBudget(renderedTurns, opts.maxChars);
  const body = trimmed.join('\n\n');

  return `${PREAMBLE}\n${body}\n${SUFFIX}\n\n${NEW_MARKER}\n${opts.newUserPrompt}`;
}

function renderMessage(msg: StoredMessage): string {
  const baseRole = msg.role === 'user' ? '[USER]' : '[ASSISTANT]';
  // Stamp `(arch/model)` on the role marker when known so the new model can
  // see which agent authored each turn — useful when the thread has rolled
  // over multiple times.
  const role = msg.architecture && msg.model
    ? `${baseRole.slice(0, -1)} (${msg.architecture}/${msg.model})]`
    : baseRole;
  const lines: string[] = [];
  for (const block of msg.blocks) {
    const rendered = renderBlock(block);
    if (rendered) lines.push(rendered);
  }
  if (lines.length === 0) return '';
  return `${role}\n${lines.join('\n')}`;
}

function renderBlock(block: StoredContentBlock): string | null {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'thinking':
      return null;
    case 'toolUse': {
      const args = stringifyInput(block.input);
      return `[tool: ${block.toolName}(${truncate(args, 200)})]`;
    }
    case 'toolResult': {
      const len = block.content?.length ?? 0;
      const flag = block.isError ? 'error' : 'ok';
      return `[tool-result: ${len} chars, ${flag}]`;
    }
    case 'image': {
      const kind = block.source.type === 'base64' ? block.source.mediaType : 'url';
      return `[image: ${kind}]`;
    }
    case 'todoList': {
      let done = 0;
      let inProgress = 0;
      let pending = 0;
      for (const item of block.items) {
        if (item.status === 'completed') done += 1;
        else if (item.status === 'in_progress') inProgress += 1;
        else pending += 1;
      }
      return `[todo: ${block.items.length} items — ${done} done, ${inProgress} in_progress, ${pending} pending]`;
    }
    case 'userInputRequest': {
      const q = block.request.questions?.[0]?.question ?? '(question)';
      let outcome: string;
      if (!block.response) {
        outcome = 'pending';
      } else if (block.response.action === 'accept') {
        const answers = stringifyAnswers(block.response.answers);
        outcome = answers ? `accepted: ${truncate(answers, 80)}` : 'accepted';
      } else {
        outcome = block.response.action; // 'decline' | 'cancel'
      }
      return `[user-input-request: "${truncate(q, 80)}" → ${outcome}]`;
    }
    case 'subagent': {
      const head = `[subagent "${block.description}" — ${block.status}${block.summary ? `: ${truncate(block.summary, 120)}` : ''}]`;
      return head;
    }
  }
}

function stringifyInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function stringifyAnswers(answers: unknown): string {
  if (!answers) return '';
  try {
    return JSON.stringify(answers);
  } catch {
    return String(answers);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function trimToBudget(turns: string[], maxChars?: number): string[] {
  if (!maxChars || maxChars <= 0) return turns;
  let total = turns.reduce((sum, t) => sum + t.length + 2, 0); // +2 for separators
  if (total <= maxChars) return turns;

  const kept = turns.slice();
  let dropped = 0;
  while (kept.length > 1 && total > maxChars) {
    const removed = kept.shift()!;
    total -= removed.length + 2;
    dropped += 1;
  }
  if (dropped === 0) return kept;
  return [`... [${dropped} earlier turn${dropped === 1 ? '' : 's'} omitted] ...`, ...kept];
}
