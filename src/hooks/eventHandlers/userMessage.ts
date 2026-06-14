import type { ChatState, ChatMessage } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { finalizeActiveMessage } from './_shared.js';

type UserMessageEvent = Extract<WireEvent, { type: 'user_message' }>;

/**
 * A queued user message was injected into the live session mid-turn (R1: the
 * Claude Agent SDK delivers it between tool calls, within the same turn). Mirror
 * the delivery order in the UI:
 *   1. finalize the currently-streaming assistant message,
 *   2. append the user message,
 *   3. open a FRESH streaming assistant message and point
 *      `activeAssistantMessageId` at it — the next `text_delta` needs an active
 *      target, since a root-frame delta with no active assistant is a no-op
 *      (see core/frame.ts). This is also why we re-open the assistant block here
 *      rather than relying on `turn_start`, which does not fire for a mid-turn
 *      push.
 */
export function handleUserMessage(state: ChatState, event: UserMessageEvent): ChatState {
  const finalized = finalizeActiveMessage(state.messages, state.activeAssistantMessageId);
  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    blocks: [{ type: 'text', text: event.text, isStreaming: false }],
    timestamp: event.timestamp,
    isStreaming: false,
  };
  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    blocks: [],
    timestamp: event.timestamp,
    isStreaming: true,
  };
  return {
    ...state,
    messages: [...finalized, userMsg, assistantMsg],
    activeAssistantMessageId: assistantMsg.id,
    isStreaming: true,
    error: null,
  };
}
