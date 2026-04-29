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

export function finalizeActiveMessage(
  messages: ChatMessage[],
  activeId: string | null,
  usage?: UsageStats,
): ChatMessage[] {
  if (!activeId) return messages;
  return messages.map(msg => {
    if (msg.id !== activeId) return msg;
    return {
      ...msg,
      isStreaming: false,
      ...(usage ? { usage } : {}),
      blocks: msg.blocks.map(b => {
        if ((b.type === 'text' || b.type === 'thinking') && b.isStreaming) {
          return { ...b, isStreaming: false };
        }
        return b;
      }),
    };
  });
}
