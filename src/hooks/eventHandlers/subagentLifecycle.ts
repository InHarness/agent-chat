import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { updateActiveMessage } from './_shared.js';

type SubagentStartedEvent = Extract<WireEvent, { type: 'subagent_started' }>;
type SubagentProgressEvent = Extract<WireEvent, { type: 'subagent_progress' }>;
type SubagentCompletedEvent = Extract<WireEvent, { type: 'subagent_completed' }>;

export function handleSubagentStarted(state: ChatState, event: SubagentStartedEvent): ChatState {
  const newSubagents = new Map(state.activeSubagents);
  newSubagents.set(event.taskId, {
    taskId: event.taskId,
    description: event.description,
    toolUseId: event.toolUseId,
    status: 'running',
  });

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
      // Wire `status` is an open string; SubagentState's is a union. Anything that
      // isn't an explicit failure counts as completed — what matters is that it is
      // no longer 'running', so the fallback keeps excluding it.
      status: event.status === 'failed' ? 'failed' : 'completed',
      summary: event.summary,
    });
  }

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => blocks.map(b =>
      b.type === 'subagent' && b.taskId === event.taskId
        ? { ...b, status: event.status, summary: event.summary, usage: event.usage }
        : b
    ),
  );
}
