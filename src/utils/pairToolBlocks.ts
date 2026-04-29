import type { UIContentBlock } from '../types.js';

export type SubagentBlock = Extract<UIContentBlock, { type: 'subagent' }>;

export interface ToolPairing {
  /** `toolResult` blocks indexed by their `toolUseId`. */
  resultByToolUseId: Map<string, { content: string; isError: boolean; collapsed: boolean }>;
  /** `subagent` blocks indexed by the `toolUseId` they were spawned from. */
  subagentByToolUseId: Map<string, SubagentBlock>;
  /**
   * `toolUseId`s whose `toolUse` block is paired with either a `toolResult`
   * or a `subagent` block. Renderers use this set to suppress the standalone
   * partner block (the `toolUse` block already renders the pair inline).
   */
  pairedToolUseIds: Set<string>;
}

/**
 * Build the lookup tables a renderer needs to fold `toolUse`/`toolResult`/
 * `subagent` triples into a single rendered card. Pure, dependency-free; used
 * inside `useMemo` in `AssistantContent` and unit-tested in isolation.
 */
export function pairToolBlocks(blocks: UIContentBlock[]): ToolPairing {
  const resultByToolUseId = new Map<string, { content: string; isError: boolean; collapsed: boolean }>();
  const subagentByToolUseId = new Map<string, SubagentBlock>();
  const pairedToolUseIds = new Set<string>();

  for (const block of blocks) {
    if (block.type === 'toolResult') {
      resultByToolUseId.set(block.toolUseId, {
        content: block.content,
        isError: block.isError,
        collapsed: block.collapsed,
      });
    } else if (block.type === 'subagent' && block.toolUseId) {
      subagentByToolUseId.set(block.toolUseId, block);
    }
  }

  for (const block of blocks) {
    if (block.type === 'toolUse') {
      if (resultByToolUseId.has(block.toolUseId)) pairedToolUseIds.add(block.toolUseId);
      if (subagentByToolUseId.has(block.toolUseId)) pairedToolUseIds.add(block.toolUseId);
    }
  }

  return { resultByToolUseId, subagentByToolUseId, pairedToolUseIds };
}
