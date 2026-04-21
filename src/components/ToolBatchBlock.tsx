import React, { useState } from 'react';
import type { ToolBatchItem } from '../types.js';
import type { ToolCategory } from '../utils/toolCategory.js';
import { categoryLabel } from '../utils/toolCategory.js';
import { ToolUseBlock } from './ToolUseBlock.js';

interface ToolBatchBlockProps {
  category: ToolCategory;
  items: ToolBatchItem[];
  defaultCollapsed?: boolean;
}

export function ToolBatchBlock({ category, items, defaultCollapsed = true }: ToolBatchBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const anyError = items.some(i => i.result?.isError);
  const anyPending = items.some(i => !i.result);
  const icon = anyError ? '✕' : anyPending ? '⟳' : '✓';

  const label = categoryLabel(category, items.length, items[0]?.toolName);

  return (
    <div data-ac="tool-batch" data-collapsed={collapsed || undefined} data-category={category}>
      <button
        data-ac="tool-batch-toggle"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <span data-ac="tool-batch-icon">{icon}</span>
        <span data-ac="tool-batch-label">{label}</span>
        <span data-ac="toggle-arrow">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div data-ac="tool-batch-body">
          {items.map(item => (
            <ToolUseBlock
              key={item.toolUseId}
              toolName={item.toolName}
              toolUseId={item.toolUseId}
              input={item.input}
              defaultCollapsed={true}
              result={item.result ? { ...item.result, collapsed: true } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
