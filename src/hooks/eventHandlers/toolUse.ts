import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { withFrame, withActiveBlocks } from '../../core/frame.js';

type ToolUseEvent = Extract<WireEvent, { type: 'tool_use' }>;

export function handleToolUse(state: ChatState, event: ToolUseEvent): ChatState {
  return withFrame(state, event.isSubagent, event.subagentTaskId, frame =>
    withActiveBlocks(frame, blocks => {
      // Finalize any streaming text/thinking blocks before appending the tool use.
      const finalized = blocks.map(b =>
        (b.type === 'text' || b.type === 'thinking') && b.isStreaming
          ? { ...b, isStreaming: false }
          : b,
      );
      return [...finalized, {
        type: 'toolUse' as const,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input,
        collapsed: true,
      }];
    }),
  );
}
