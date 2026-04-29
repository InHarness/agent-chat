import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { withFrame, withActiveBlocks } from '../../core/frame.js';

type TextDeltaEvent = Extract<WireEvent, { type: 'text_delta' }>;

export function handleTextDelta(state: ChatState, event: TextDeltaEvent): ChatState {
  return withFrame(state, event.isSubagent, event.subagentTaskId, frame =>
    withActiveBlocks(frame, blocks => {
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'text' && last.isStreaming) {
        return [...blocks.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...blocks, { type: 'text' as const, text: event.text, isStreaming: true }];
    }),
  );
}
