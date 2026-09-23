import type { ChatState, UIContentBlock } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { updateActiveMessage } from './_shared.js';

type SubagentStartedEvent = Extract<WireEvent, { type: 'subagent_started' }>;
type SubagentProgressEvent = Extract<WireEvent, { type: 'subagent_progress' }>;
type SubagentCompletedEvent = Extract<WireEvent, { type: 'subagent_completed' }>;
type SubagentBlock = Extract<UIContentBlock, { type: 'subagent' }>;

export function handleSubagentStarted(state: ChatState, event: SubagentStartedEvent): ChatState {
  // Re-entry (agent-adapters ≥0.9.12): a subagent resumed via `SendMessage` opens
  // another lifecycle cycle under the SAME `taskId`. Its panel is the one already in
  // the active message — flip it back to 'running' instead of appending a second
  // block. The block keeps its ORIGINAL `toolUseId`, so the panel stays paired with
  // the tool card that spawned the agent, and its ORIGINAL description (a re-entry's is
  // the SendMessage text) and summary — a later completion replaces the summary only
  // when it brings one. Matching is scoped to the active message:
  // a re-entry in a later turn has no block here and opens a fresh panel.
  const active = state.messages.find(m => m.id === state.activeAssistantMessageId);
  const existingIdx = active ? lastSubagentIndex(active.blocks, event.taskId) : -1;
  const existing = existingIdx >= 0 ? active!.blocks[existingIdx] as SubagentBlock : undefined;

  const newSubagents = new Map(state.activeSubagents);
  newSubagents.set(event.taskId, {
    taskId: event.taskId,
    description: existing ? existing.description : event.description,
    toolUseId: existing ? existing.toolUseId : event.toolUseId,
    status: 'running',
  });

  if (existing) {
    return updateActiveMessage(
      { ...state, activeSubagents: newSubagents },
      (blocks) => blocks.map((b, i) =>
        i === existingIdx
          ? { ...existing, status: 'running' }
          : b
      ),
    );
  }

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => [...blocks, {
      type: 'subagent' as const,
      taskId: event.taskId,
      toolUseId: event.toolUseId,
      description: event.description,
      status: 'running',
      messages: [],
    }],
  );
}

/** Index of the LAST subagent block for `taskId` (-1 when none). */
function lastSubagentIndex(blocks: UIContentBlock[], taskId: string): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'subagent' && b.taskId === taskId) return i;
  }
  return -1;
}

export function handleSubagentProgress(state: ChatState, event: SubagentProgressEvent): ChatState {
  const sub = state.activeSubagents.get(event.taskId);
  if (!sub) return state;

  const newSubagents = new Map(state.activeSubagents);
  newSubagents.set(event.taskId, { ...sub, description: event.description, lastToolName: event.lastToolName });

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => blocks.map(b =>
      b.type === 'subagent' && b.taskId === event.taskId
        ? { ...b, description: event.description }
        : b
    ),
  );
}

export function handleSubagentCompleted(state: ChatState, event: SubagentCompletedEvent): ChatState {
  // The registry entry SURVIVES completion, flipped out of 'running'. The adapter's
  // content channel (tool_use/tool_result) and lifecycle channel (subagent_completed)
  // are unordered, so a subagent's results can still arrive after it reports done —
  // deleting the entry here made those late events either vanish or land in another
  // subagent's panel via the `getActiveSubagent` fallback. `result.ts` clears the whole
  // map at end of turn, so it can't grow unbounded.
  const sub = state.activeSubagents.get(event.taskId);
  const newSubagents = new Map(state.activeSubagents);
  if (sub) {
    newSubagents.set(event.taskId, {
      ...sub,
      // Wire `status` is an open string (agent-adapters declares 'completed' |
      // 'failed' | 'aborted' | 'stopped'); SubagentState's is a narrower union.
      // Anything that isn't an explicit failure counts as completed here — what
      // matters is that it is no longer 'running', so the fallback keeps
      // excluding it. The block itself keeps the raw status for rendering.
      status: event.status === 'failed' ? 'failed' : 'completed',
      summary: event.summary ?? sub.summary,
    });
  }

  // A re-entered subagent closes each cycle separately; the block is shared across
  // cycles, so every completion overwrites it and the LAST one is what stays.
  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => {
      const idx = lastSubagentIndex(blocks, event.taskId);
      return blocks.map((b, i) =>
        i === idx && b.type === 'subagent'
          ? { ...b, status: event.status, summary: event.summary ?? b.summary, usage: event.usage }
          : b
      );
    },
  );
}
