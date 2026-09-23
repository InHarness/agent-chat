import { accumulateUsage } from '../../core/usage.js';
import type { ChatState, ChatMessage, UIContentBlock, UsageStats } from '../../types.js';

export function updateActiveMessage(
  state: ChatState,
  updater: (blocks: UIContentBlock[]) => UIContentBlock[],
): ChatState {
  if (!state.activeAssistantMessageId) return state;

  return {
    ...state,
    messages: state.messages.map(msg =>
      msg.id === state.activeAssistantMessageId
        ? { ...msg, blocks: updater(msg.blocks) }
        : msg
    ),
  };
}

function closeOpenBlocks(blocks: UIContentBlock[]): UIContentBlock[] {
  return blocks.map(b => {
    if ((b.type === 'text' || b.type === 'thinking') && b.isStreaming) {
      return { ...b, isStreaming: false };
    }
    return b;
  });
}

function mapActiveMessage(
  messages: ChatMessage[],
  activeId: string | null,
  fn: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
  if (!activeId) return messages;
  return messages.map(msg => (msg.id === activeId ? fn(msg) : msg));
}

/**
 * `result` closed a block, not the turn: close the active message's open
 * text/thinking blocks, add the block's `usage` (a message's usage is the sum
 * over every `result` it received), overwrite `contextSize`. The message
 * itself keeps streaming — more content may follow.
 */
export function closeBlockOnActiveMessage(
  messages: ChatMessage[],
  activeId: string | null,
  usage?: UsageStats,
  contextSize?: number,
): ChatMessage[] {
  return mapActiveMessage(messages, activeId, msg => {
    const nextUsage = accumulateUsage(msg.usage, usage);
    return {
      ...msg,
      ...(nextUsage ? { usage: nextUsage } : {}),
      ...(contextSize !== undefined ? { contextSize } : {}),
      blocks: closeOpenBlocks(msg.blocks),
    };
  });
}

/** The active message is done: stop streaming it and close its open blocks. */
export function finalizeActiveMessage(messages: ChatMessage[], activeId: string | null): ChatMessage[] {
  return mapActiveMessage(messages, activeId, msg => ({
    ...msg,
    isStreaming: false,
    blocks: closeOpenBlocks(msg.blocks),
  }));
}

/** True once the stream was torn down — `done` / `error` are idempotent. */
export function isStreamTornDown(state: ChatState): boolean {
  return !state.isStreaming && state.activeAssistantMessageId === null;
}

/**
 * End of stream (`done` or a terminal `error`): finalize the active message
 * and disarm the stream. Subagent entries survive `subagent_completed` and
 * `result` (see `subagentLifecycle.ts`), so this is the only place they are
 * cleared — including on Stop, which dispatches `error` / `ABORTED`; otherwise
 * an aborted stream's subagents leak into every stream that follows.
 */
export function teardownStream(state: ChatState): ChatState {
  return {
    ...state,
    isStreaming: false,
    messages: finalizeActiveMessage(state.messages, state.activeAssistantMessageId),
    activeAssistantMessageId: null,
    optimisticAssistantMessageId: null,
    activeSubagents: new Map(),
  };
}
