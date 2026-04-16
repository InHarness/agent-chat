import React from 'react';
import type { UIContentBlock } from '../types.js';
import { TextBlock } from './TextBlock.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolUseBlock } from './ToolUseBlock.js';
import { ToolResultBlock } from './ToolResultBlock.js';
import { ImageBlock } from './ImageBlock.js';
import { SubagentPanel } from './SubagentPanel.js';

interface AssistantContentProps {
  blocks: UIContentBlock[];
}

export function AssistantContent({ blocks }: AssistantContentProps) {
  return (
    <div data-ac="assistant-content">
      {blocks.map((block, i) => {
        const key = blockKey(block, i);
        switch (block.type) {
          case 'text':
            return <TextBlock key={key} text={block.text} isStreaming={block.isStreaming} />;
          case 'thinking':
            return <ThinkingBlock key={key} text={block.text} isStreaming={block.isStreaming} defaultCollapsed={block.collapsed} />;
          case 'toolUse':
            return <ToolUseBlock key={key} toolName={block.toolName} toolUseId={block.toolUseId} input={block.input} defaultCollapsed={block.collapsed} />;
          case 'toolResult':
            return <ToolResultBlock key={key} toolUseId={block.toolUseId} content={block.content} isError={block.isError} defaultCollapsed={block.collapsed} />;
          case 'image':
            return <ImageBlock key={key} source={block.source} />;
          case 'subagent':
            return <SubagentPanel key={key} taskId={block.taskId} description={block.description} status={block.status} summary={block.summary} messages={block.messages} />;
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
    default: return `${block.type}-${index}`;
  }
}
