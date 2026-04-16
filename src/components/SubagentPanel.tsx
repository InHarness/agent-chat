import React, { useState } from 'react';
import type { ChatMessage } from '../types.js';
import { AssistantContent } from './AssistantContent.js';

interface SubagentPanelProps {
  taskId: string;
  description: string;
  status: string;
  summary?: string;
  messages: ChatMessage[];
}

export function SubagentPanel({ description, status, summary, messages }: SubagentPanelProps) {
  const [collapsed, setCollapsed] = useState(status !== 'running');

  return (
    <div data-ac="subagent" data-status={status}>
      <button
        data-ac="subagent-toggle"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <span data-ac="subagent-status">
          {status === 'running' ? '⟳' : status === 'completed' ? '✓' : '✕'}
        </span>
        <span data-ac="subagent-description">{description}</span>
        <span data-ac="toggle-arrow">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div data-ac="subagent-content">
          {messages.map(msg => (
            msg.role === 'assistant' && (
              <AssistantContent key={msg.id} blocks={msg.blocks} />
            )
          ))}
          {summary && <div data-ac="subagent-summary">{summary}</div>}
        </div>
      )}
    </div>
  );
}
