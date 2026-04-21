import type { UIContentBlock, ToolBatchItem } from '../types.js';
import { toolCategory, groupingKey } from './toolCategory.js';

type ToolUseBlock = Extract<UIContentBlock, { type: 'toolUse' }>;
type ToolResultBlock = Extract<UIContentBlock, { type: 'toolResult' }>;

/**
 * Pure transformation: groups runs of consecutive tool calls that share a
 * grouping key into a single `toolBatch` block. Runs of length 1 are left
 * untouched (render as today's standalone toolUse + toolResult). Subagent-
 * linked tool calls are never batched (they render with their subagent panel).
 *
 * Safe to call multiple times — already-batched blocks pass through unchanged.
 */
export function batchToolBlocks(blocks: UIContentBlock[]): UIContentBlock[] {
  const subagentToolUseIds = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'subagent' && block.toolUseId) {
      subagentToolUseIds.add(block.toolUseId);
    }
  }

  const out: UIContentBlock[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === 'subagent') {
      out.push({
        ...block,
        messages: block.messages.map(msg => ({
          ...msg,
          blocks: batchToolBlocks(msg.blocks),
        })),
      });
      i++;
      continue;
    }

    // Non-toolUse blocks (text, thinking, image, toolBatch, todoList) pass through untouched.
    if (block.type !== 'toolUse' || subagentToolUseIds.has(block.toolUseId)) {
      out.push(block);
      i++;
      continue;
    }

    const firstKey = groupingKey(block.toolName);
    const run: Array<{ toolUse: ToolUseBlock; result?: ToolResultBlock }> = [];
    let j = i;

    while (j < blocks.length) {
      const b = blocks[j];
      if (b.type !== 'toolUse') break;
      if (subagentToolUseIds.has(b.toolUseId)) break;
      if (groupingKey(b.toolName) !== firstKey) break;

      let nextJ = j + 1;
      let resultBlock: ToolResultBlock | undefined;
      if (nextJ < blocks.length) {
        const candidate = blocks[nextJ];
        if (candidate.type === 'toolResult' && candidate.toolUseId === b.toolUseId) {
          resultBlock = candidate;
          nextJ++;
        }
      }

      run.push({ toolUse: b, result: resultBlock });
      j = nextJ;
    }

    if (run.length >= 2) {
      const items: ToolBatchItem[] = run.map(r => ({
        toolUseId: r.toolUse.toolUseId,
        toolName: r.toolUse.toolName,
        input: r.toolUse.input,
        result: r.result ? { content: r.result.content, isError: r.result.isError } : undefined,
      }));
      out.push({
        type: 'toolBatch',
        category: toolCategory(run[0].toolUse.toolName),
        items,
      });
    } else {
      out.push(run[0].toolUse);
      if (run[0].result) out.push(run[0].result);
    }

    i = j;
  }

  return out;
}
