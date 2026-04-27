import React, { useMemo } from 'react';
import type { UIContentBlock } from '../types.js';
import type { UserInputResponse } from '@inharness-ai/agent-adapters';
import { TextBlock } from './TextBlock.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolUseBlock } from './ToolUseBlock.js';
import { ToolResultBlock } from './ToolResultBlock.js';
import { ToolBatchBlock } from './ToolBatchBlock.js';
import { TodoListBlock } from './TodoListBlock.js';
import { ImageBlock } from './ImageBlock.js';
import { SubagentPanel } from './SubagentPanel.js';
import { UserInputRequestBlock } from './UserInputRequestBlock.js';
import { useUserInputResponder } from './UserInputResponderContext.js';
import { batchToolBlocks } from '../utils/batchToolBlocks.js';

interface AssistantContentProps {
  blocks: UIContentBlock[];
  batchTools?: boolean;
}

export function AssistantContent({ blocks, batchTools }: AssistantContentProps) {
  const respond = useUserInputResponder();
  const renderBlocks = useMemo(
    () => (batchTools ? batchToolBlocks(blocks) : blocks),
    [blocks, batchTools],
  );

  // Build maps for pairing toolUse ↔ toolResult ↔ subagent by toolUseId
  const resultByToolUseId = new Map<string, { content: string; isError: boolean; collapsed: boolean }>();
  const subagentByToolUseId = new Map<string, UIContentBlock & { type: 'subagent' }>();
  const pairedToolUseIds = new Set<string>();

  for (const block of renderBlocks) {
    if (block.type === 'toolResult') {
      resultByToolUseId.set(block.toolUseId, { content: block.content, isError: block.isError, collapsed: block.collapsed });
    }
    if (block.type === 'subagent' && block.toolUseId) {
      subagentByToolUseId.set(block.toolUseId, block);
    }
  }

  // Mark which toolUseIds have a matching toolUse block (for skipping standalone renders)
  for (const block of renderBlocks) {
    if (block.type === 'toolUse') {
      if (resultByToolUseId.has(block.toolUseId)) pairedToolUseIds.add(block.toolUseId);
      if (subagentByToolUseId.has(block.toolUseId)) pairedToolUseIds.add(block.toolUseId);
    }
  }

  return (
    <div data-ac="assistant-content">
      {renderBlocks.map((block, i) => {
        const key = blockKey(block, i);
        switch (block.type) {
          case 'text':
            return <TextBlock key={key} text={block.text} isStreaming={block.isStreaming} />;
          case 'thinking':
            return <ThinkingBlock key={key} text={block.text} isStreaming={block.isStreaming} defaultCollapsed={block.collapsed} />;
          case 'toolUse': {
            const result = resultByToolUseId.get(block.toolUseId);
            const subagentBlock = subagentByToolUseId.get(block.toolUseId);
            const subagent = subagentBlock
              ? {
                  description: subagentBlock.description,
                  status: subagentBlock.status,
                  summary: subagentBlock.summary,
                  messages: subagentBlock.messages,
                  usage: subagentBlock.usage,
                }
              : undefined;
            return <ToolUseBlock key={key} toolName={block.toolName} toolUseId={block.toolUseId} input={block.input} defaultCollapsed={block.collapsed} result={result} subagent={subagent} />;
          }
          case 'toolResult':
            if (pairedToolUseIds.has(block.toolUseId)) return null;
            return <ToolResultBlock key={key} toolUseId={block.toolUseId} content={block.content} isError={block.isError} defaultCollapsed={block.collapsed} />;
          case 'toolBatch':
            return <ToolBatchBlock key={key} category={block.category} items={block.items} />;
          case 'todoList':
            return <TodoListBlock key={key} items={block.items} />;
          case 'image':
            return <ImageBlock key={key} source={block.source} />;
          case 'subagent':
            // Skip if paired with a toolUse block
            if (block.toolUseId && pairedToolUseIds.has(block.toolUseId)) return null;
            return <SubagentPanel key={key} taskId={block.taskId} description={block.description} status={block.status} summary={block.summary} messages={block.messages} />;
          case 'userInputRequest':
            return (
              <UserInputRequestBlock
                key={key}
                request={block.request}
                response={block.response}
                onRespond={respond ?? undefined}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function blockKey(block: UIContentBlock, index: number): string {
  switch (block.type) {
    case 'toolUse': return `tu-${block.toolUseId}`;
    case 'toolResult': return `tr-${block.toolUseId}`;
    case 'subagent': return `sa-${block.taskId}`;
    case 'toolBatch': return `tb-${block.items.map(i => i.toolUseId).join('-')}`;
    case 'todoList': return `tl-${index}`;
    case 'userInputRequest': return `ui-${block.requestId}`;
    default: return `${block.type}-${index}`;
  }
}
