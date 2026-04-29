import type { ChatState, ChatMessage, UIContentBlock, SubagentState } from '../types.js';

/**
 * Frame: a logical view over a slice of ChatState that handlers can mutate
 * uniformly, regardless of whether the slice is the root chat or a subagent's
 * nested chat. Eliminates the need for parallel "route block to subagent" code paths.
 *
 * For root: backed by `state.messages` + `state.activeAssistantMessageId`.
 * For subagent: backed by `subagentBlock.messages` + the id of the last
 * streaming assistant message (or null when none exists).
 *
 * `canSpawnAssistant` differentiates the two: subagents may create a new
 * streaming assistant message in response to a block-emitting event when
 * none is active. Root frames may not — top-level events without a prior
 * `turn_start` are no-ops.
 */
export interface Frame {
  readonly messages: ChatMessage[];
  readonly activeAssistantMessageId: string | null;
  readonly canSpawnAssistant: boolean;
}

function getRootFrame(state: ChatState): Frame {
  return {
    messages: state.messages,
    activeAssistantMessageId: state.activeAssistantMessageId,
    canSpawnAssistant: false,
  };
}

function getSubagentFrame(messages: ChatMessage[]): Frame {
  const last = messages[messages.length - 1];
  const activeId = last && last.role === 'assistant' && last.isStreaming ? last.id : null;
  return {
    messages,
    activeAssistantMessageId: activeId,
    canSpawnAssistant: true,
  };
}

function getActiveSubagent(state: ChatState): SubagentState | null {
  const running = Array.from(state.activeSubagents.values()).filter(s => s.status === 'running');
  return running.length > 0 ? running[running.length - 1] : null;
}

function resolveSubagent(state: ChatState, subagentTaskId?: string): SubagentState | null {
  if (subagentTaskId) {
    const byId = state.activeSubagents.get(subagentTaskId);
    if (byId) return byId;
  }
  return getActiveSubagent(state);
}

/**
 * Apply `fn` to the frame appropriate for the event:
 *   - if `isSubagent`, find the active subagent block and run on its `Frame`;
 *   - otherwise run on the root `Frame`.
 *
 * If the target frame can't be resolved (no active subagent, or root has no
 * active assistant message), the state is returned unchanged.
 */
export function withFrame(
  state: ChatState,
  isSubagent: boolean,
  subagentTaskId: string | undefined,
  fn: (frame: Frame) => Frame,
): ChatState {
  if (!isSubagent) {
    if (state.activeAssistantMessageId === null) return state;
    const out = fn(getRootFrame(state));
    if (out.messages === state.messages && out.activeAssistantMessageId === state.activeAssistantMessageId) {
      return state;
    }
    return {
      ...state,
      messages: out.messages,
      activeAssistantMessageId: out.activeAssistantMessageId,
    };
  }

  const sub = resolveSubagent(state, subagentTaskId);
  if (!sub) return state;
  if (state.activeAssistantMessageId === null) return state;

  return {
    ...state,
    messages: state.messages.map(msg => {
      if (msg.id !== state.activeAssistantMessageId) return msg;
      const blocks = msg.blocks.map(b => {
        if (b.type !== 'subagent' || b.taskId !== sub.taskId) return b;
        const out = fn(getSubagentFrame(b.messages));
        if (out.messages === b.messages) return b;
        return { ...b, messages: out.messages };
      });
      return blocks === msg.blocks ? msg : { ...msg, blocks };
    }),
  };
}

/**
 * Apply `updater` to the blocks of the active message in the frame. If no
 * active message exists and the frame allows spawning, create a new streaming
 * assistant message holding `updater([])`. Otherwise return the frame unchanged.
 */
export function withActiveBlocks(
  frame: Frame,
  updater: (blocks: UIContentBlock[]) => UIContentBlock[],
): Frame {
  if (frame.activeAssistantMessageId !== null) {
    return {
      ...frame,
      messages: frame.messages.map(msg =>
        msg.id === frame.activeAssistantMessageId
          ? { ...msg, blocks: updater(msg.blocks) }
          : msg,
      ),
    };
  }
  if (!frame.canSpawnAssistant) return frame;

  const newId = crypto.randomUUID();
  const newMsg: ChatMessage = {
    id: newId,
    role: 'assistant',
    blocks: updater([]),
    timestamp: new Date().toISOString(),
    isStreaming: true,
  };
  return {
    ...frame,
    messages: [...frame.messages, newMsg],
    activeAssistantMessageId: newId,
  };
}
