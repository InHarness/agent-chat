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

// agent-adapters' `subagent_completed.status` vocabulary: `'aborted'` (closed by a
// run-level termination) and `'stopped'` (ended on its own while the run went on)
// are not failures, so they don't get the failure mark.
function statusIcon(status: string): string {
  switch (status) {
    case 'running': return '⟳';
    case 'completed': return '✓';
    case 'aborted':
    case 'stopped': return '⊘';
    default: return '✕';
  }
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
          {statusIcon(status)}
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
