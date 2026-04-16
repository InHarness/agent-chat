import React, { useState } from 'react';

interface ToolUseBlockProps {
  toolName: string;
  toolUseId: string;
  input: unknown;
  defaultCollapsed?: boolean;
}

export function ToolUseBlock({ toolName, input, defaultCollapsed = false }: ToolUseBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div data-ac="tool-use" data-collapsed={collapsed || undefined}>
      <button
        data-ac="tool-use-toggle"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <span data-ac="tool-use-icon">&#9881;</span>
        <span data-ac="tool-use-name">{toolName}</span>
        <span data-ac="toggle-arrow">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <pre data-ac="tool-use-input">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}
