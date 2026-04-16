import React, { useState } from 'react';

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
  defaultCollapsed?: boolean;
}

export function ThinkingBlock({ text, isStreaming, defaultCollapsed = false }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div data-ac="thinking" data-collapsed={collapsed || undefined} data-streaming={isStreaming || undefined}>
      <button
        data-ac="thinking-toggle"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <span data-ac="thinking-icon">{collapsed ? '▸' : '▾'}</span>
        <span data-ac="thinking-label">
          {isStreaming ? 'Thinking...' : 'Thinking'}
        </span>
      </button>
      {!collapsed && (
        <div data-ac="thinking-content">
          {text}
          {isStreaming && <span data-ac="cursor" />}
        </div>
      )}
    </div>
  );
}
