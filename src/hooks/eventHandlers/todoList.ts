import type { ChatState, UIContentBlock } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { withFrame, withActiveBlocks } from '../../core/frame.js';

type TodoListEvent = Extract<WireEvent, { type: 'todo_list_updated' }>;

export function handleTodoListUpdated(state: ChatState, event: TodoListEvent): ChatState {
  const updated = withFrame(state, event.isSubagent, event.subagentTaskId, frame =>
    withActiveBlocks(frame, blocks => {
      const last = blocks[blocks.length - 1];
      const newBlock: UIContentBlock = { type: 'todoList', items: event.items };
      if (last && last.type === 'todoList') {
        // Upsert: replace the trailing todoList in place.
        return [...blocks.slice(0, -1), newBlock];
      }
      // Append: finalize any streaming text/thinking before appending.
      const finalized = blocks.map(b =>
        (b.type === 'text' || b.type === 'thinking') && b.isStreaming
          ? { ...b, isStreaming: false }
          : b,
      );
      return [...finalized, newBlock];
    }),
  );

  return { ...updated, currentTodoItems: event.items };
}
