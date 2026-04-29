import type { ChatState, UIContentBlock } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import type { UserInputResponse } from '@inharness-ai/agent-adapters';
import { updateActiveMessage } from './_shared.js';

type UserInputRequestEvent = Extract<WireEvent, { type: 'user_input_request' }>;
type UserInputResponseEvent = Extract<WireEvent, { type: 'user_input_response' }>;

export function handleUserInputRequest(state: ChatState, event: UserInputRequestEvent): ChatState {
  return updateActiveMessage(state, (blocks) => {
    const finalized = blocks.map(b =>
      (b.type === 'text' || b.type === 'thinking') && b.isStreaming
        ? { ...b, isStreaming: false }
        : b
    );
    return [...finalized, { type: 'userInputRequest' as const, requestId: event.request.requestId, request: event.request }];
  });
}

function updateUserInputRequestBlocks(
  blocks: UIContentBlock[],
  requestId: string,
  response: UserInputResponse,
): { blocks: UIContentBlock[]; updated: boolean } {
  let updated = false;
  const next = blocks.map(b => {
    if (b.type === 'userInputRequest' && b.requestId === requestId) {
      updated = true;
      return { ...b, response };
    }
    if (b.type === 'subagent') {
      const nestedMessages = b.messages.map(msg => {
        const res = updateUserInputRequestBlocks(msg.blocks, requestId, response);
        if (res.updated) updated = true;
        return res.updated ? { ...msg, blocks: res.blocks } : msg;
      });
      return { ...b, messages: nestedMessages };
    }
    return b;
  });
  return { blocks: next, updated };
}

export function handleUserInputResponse(state: ChatState, event: UserInputResponseEvent): ChatState {
  return {
    ...state,
    messages: state.messages.map(msg => {
      const res = updateUserInputRequestBlocks(msg.blocks, event.requestId, event.response);
      return res.updated ? { ...msg, blocks: res.blocks } : msg;
    }),
  };
}
