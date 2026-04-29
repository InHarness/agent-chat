import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { withFrame, withActiveBlocks } from '../../core/frame.js';

type ToolResultEvent = Extract<WireEvent, { type: 'tool_result' }>;

export function handleToolResult(state: ChatState, event: ToolResultEvent): ChatState {
  return withFrame(state, event.isSubagent, event.subagentTaskId, frame =>
    withActiveBlocks(frame, blocks => {
      // Collapse the matching toolUse block (no-op when it's already collapsed).
      const updated = blocks.map(b =>
        b.type === 'toolUse' && b.toolUseId === event.toolUseId
          ? { ...b, collapsed: true }
          : b,
      );
      return [...updated, {
        type: 'toolResult' as const,
        toolUseId: event.toolUseId,
        content: event.summary,
        isError: false,
        collapsed: true,
      }];
    }),
  );
}
