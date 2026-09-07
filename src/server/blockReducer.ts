import type { UnifiedEvent, UserInputRequest } from '@inharness-ai/agent-adapters';
import type { StoredContentBlock } from './protocol.js';

type SubagentBlock = StoredContentBlock & { type: 'subagent' };

function findActiveSubagentBlock(blocks: StoredContentBlock[]): SubagentBlock | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'subagent' && b.status === 'running') return b as SubagentBlock;
  }
  return undefined;
}

/**
 * Mirrors `resolveSubagent` in `src/core/frame.ts` — the two reducers MUST agree,
 * or the transcript rendered live and the one rehydrated after a refresh diverge.
 *
 * An explicit `subagentTaskId` is never guessed: when the event names a subagent
 * we have no block for, we drop it rather than attribute it to whichever panel
 * happens to be running. The `findActiveSubagentBlock` fallback exists only for
 * events with NO `subagentTaskId`, which agent-adapters emits as documented
 * graceful degradation (`isSubagent: true` deltas that arrive before the
 * corresponding `subagent_started`).
 */
function resolveSubagentBlock(
  blocks: StoredContentBlock[],
  subagentTaskId: string | undefined,
): SubagentBlock | undefined {
  if (subagentTaskId) {
    return blocks.find(b => b.type === 'subagent' && b.taskId === subagentTaskId) as
      | SubagentBlock
      | undefined;
  }
  return findActiveSubagentBlock(blocks);
}

function appendToSubagentMessages(
  sub: SubagentBlock,
  block: StoredContentBlock,
  upsertLastIfType?: StoredContentBlock['type'],
): void {
  const lastMsg = sub.messages[sub.messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    if (upsertLastIfType) {
      const lastBlock = lastMsg.blocks[lastMsg.blocks.length - 1];
      if (lastBlock && lastBlock.type === upsertLastIfType) {
        lastMsg.blocks[lastMsg.blocks.length - 1] = block;
        return;
      }
    }
    lastMsg.blocks.push(block);
  } else {
    sub.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      blocks: [block],
      timestamp: new Date().toISOString(),
      subagentTaskId: sub.taskId,
    });
  }
}

/**
 * Apply a single streaming event to the persisted block list, mutating in
 * place. Used by the chat handler to build up `assistantBlocks` for thread
 * persistence as events flow through the SSE broadcast loop.
 *
 * Subagent events (`isSubagent: true` or lifecycle events) are routed into the
 * matching subagent block's nested `messages`. When no matching subagent is
 * active, the event is dropped silently — matches behaviour of the previous
 * inlined `collectBlock` implementation.
 */
export function applyEventToStoredBlocks(
  blocks: StoredContentBlock[],
  event: UnifiedEvent,
): void {
  switch (event.type) {
    case 'text_delta': {
      if (event.isSubagent) {
        const sub = resolveSubagentBlock(blocks, event.subagentTaskId);
        if (!sub) return;
        const lastMsg = sub.messages[sub.messages.length - 1];
        const lastBlock = lastMsg?.blocks[lastMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += event.text;
        } else {
          appendToSubagentMessages(sub, { type: 'text', text: event.text });
        }
        return;
      }
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'text') {
        last.text += event.text;
      } else {
        blocks.push({ type: 'text', text: event.text });
      }
      return;
    }
    case 'thinking': {
      if (event.isSubagent) {
        const sub = resolveSubagentBlock(blocks, event.subagentTaskId);
        if (!sub) return;
        const lastMsg = sub.messages[sub.messages.length - 1];
        const lastBlock = lastMsg?.blocks[lastMsg.blocks.length - 1];
        if (!event.replace && lastBlock && lastBlock.type === 'thinking') {
          lastBlock.text += event.text;
        } else {
          appendToSubagentMessages(sub, { type: 'thinking', text: event.text });
        }
        return;
      }
      const last = blocks[blocks.length - 1];
      if (!event.replace && last && last.type === 'thinking') {
        last.text += event.text;
      } else {
        blocks.push({ type: 'thinking', text: event.text });
      }
      return;
    }
    case 'tool_use': {
      if (event.isSubagent) {
        const sub = resolveSubagentBlock(blocks, event.subagentTaskId);
        if (sub) appendToSubagentMessages(sub, { type: 'toolUse', toolUseId: event.toolUseId, toolName: event.toolName, input: event.input });
        return;
      }
      blocks.push({ type: 'toolUse', toolUseId: event.toolUseId, toolName: event.toolName, input: event.input });
      return;
    }
    case 'tool_result': {
      if (event.isSubagent) {
        const sub = resolveSubagentBlock(blocks, event.subagentTaskId);
        if (sub) appendToSubagentMessages(sub, { type: 'toolResult', toolUseId: event.toolUseId, content: event.summary, isError: event.isError ?? false });
        return;
      }
      blocks.push({ type: 'toolResult', toolUseId: event.toolUseId, content: event.summary, isError: event.isError ?? false });
      return;
    }
    case 'subagent_started': {
      blocks.push({ type: 'subagent', taskId: event.taskId, toolUseId: event.toolUseId ?? '', description: event.description, status: 'running', messages: [] });
      return;
    }
    case 'subagent_completed': {
      const sub = blocks.find(b => b.type === 'subagent' && b.taskId === event.taskId) as SubagentBlock | undefined;
      if (sub) {
        sub.status = event.status;
        sub.summary = event.summary;
        if (event.usage) sub.usage = event.usage;
      }
      return;
    }
    case 'todo_list_updated': {
      if (event.isSubagent) {
        const sub = resolveSubagentBlock(blocks, event.subagentTaskId);
        if (sub) appendToSubagentMessages(sub, { type: 'todoList', items: event.items }, 'todoList');
        return;
      }
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'todoList') {
        last.items = event.items;
      } else {
        blocks.push({ type: 'todoList', items: event.items });
      }
      return;
    }
    case 'user_input_request': {
      const { native: _native, ...cleanReq } = event.request as unknown as Record<string, unknown>;
      blocks.push({
        type: 'userInputRequest',
        requestId: event.request.requestId,
        request: cleanReq as unknown as UserInputRequest,
      });
      return;
    }
  }
}
