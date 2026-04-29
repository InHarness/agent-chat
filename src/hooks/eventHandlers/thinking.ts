import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { withFrame, withActiveBlocks } from '../../core/frame.js';

type ThinkingEvent = Extract<WireEvent, { type: 'thinking' }>;

export function handleThinking(state: ChatState, event: ThinkingEvent): ChatState {
  return withFrame(state, event.isSubagent, event.subagentTaskId, frame =>
    withActiveBlocks(frame, blocks => {
      const last = blocks[blocks.length - 1];
      if (!event.replace && last && last.type === 'thinking' && last.isStreaming) {
        return [...blocks.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      const finalized = event.replace && last && last.type === 'thinking' && last.isStreaming
        ? [...blocks.slice(0, -1), { ...last, isStreaming: false }]
        : blocks;
      return [...finalized, { type: 'thinking' as const, text: event.text, isStreaming: true, collapsed: false }];
    }),
  );
}
