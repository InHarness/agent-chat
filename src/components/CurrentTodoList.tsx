import React, { useState } from 'react';
import type { TodoItem } from '../types.js';
import { TodoListBlock } from './TodoListBlock.js';

interface CurrentTodoListProps {
  items: TodoItem[] | null;
}

function summarize(items: TodoItem[]): { done: number; total: number; active: TodoItem | null } {
  let done = 0;
  let active: TodoItem | null = null;
  for (const it of items) {
    if (it.status === 'completed' || it.status === 'cancelled') done++;
    if (!active && it.status === 'in_progress') active = it;
  }
  if (!active) {
    active = items.find(i => i.status === 'pending') ?? null;
  }
  return { done, total: items.length, active };
}

export function CurrentTodoList({ items }: CurrentTodoListProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!items || items.length === 0) return null;

  const { done, total, active } = summarize(items);
  const allDone = done === total;

  return (
    <div
      data-ac="current-todo-list"
      data-ac-collapsed={collapsed || undefined}
      data-ac-all-done={allDone || undefined}
    >
      <button
        type="button"
        data-ac="current-todo-toggle"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
      >
        <span data-ac="current-todo-progress">
          {done}/{total}
        </span>
        <span data-ac="current-todo-active">
          {allDone
            ? 'All tasks complete'
            : active
              ? (active.activeForm?.trim() && active.status === 'in_progress'
                  ? active.activeForm
                  : active.content)
              : 'Planning'}
        </span>
        <span data-ac="toggle-arrow">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div data-ac="current-todo-body">
          <TodoListBlock items={items} variant="sticky" />
        </div>
      )}
    </div>
  );
}
