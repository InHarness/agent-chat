import React, { useState } from 'react';

interface ToolResultBlockProps {
  toolUseId: string;
  content: string;
  isError: boolean;
  defaultCollapsed?: boolean;
}

export function ToolResultBlock({ content, isError, defaultCollapsed = true }: ToolResultBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div data-ac="tool-result" data-error={isError || undefined} data-collapsed={collapsed || undefined}>
      <button
        data-ac="tool-result-toggle"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <span data-ac="tool-result-icon">{isError ? '✕' : '✓'}</span>
        <span data-ac="tool-result-label">
          {isError ? 'Error' : 'Result'}
        </span>
        <span data-ac="toggle-arrow">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <pre data-ac="tool-result-content">{content}</pre>
      )}
    </div>
  );
}
