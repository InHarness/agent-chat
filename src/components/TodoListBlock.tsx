import React from 'react';
import type { TodoItem } from '../types.js';

interface TodoListBlockProps {
  items: TodoItem[];
  variant?: 'inline' | 'sticky';
}

function statusGlyph(status: string): string {
  switch (status) {
    case 'pending':
      return '○'; // ○
    case 'in_progress':
      return '▶'; // ▶
    case 'completed':
      return '✓'; // ✓
    case 'cancelled':
      return '✕'; // ✕
    default:
      return '·'; // ·
  }
}

function labelFor(item: TodoItem): string {
  const activeForm = item.activeForm?.trim();
  if (item.status === 'in_progress' && activeForm) return activeForm;
  return item.content;
}

export function TodoListBlock({ items, variant = 'inline' }: TodoListBlockProps) {
  if (!items || items.length === 0) return null;

  return (
    <ul data-ac="todo-list" data-ac-variant={variant} aria-live="polite">
      {items.map(item => (
        <li key={item.id} data-ac="todo-item" data-ac-status={item.status}>
          <span data-ac="todo-status-glyph" aria-hidden="true">
            {statusGlyph(item.status)}
          </span>
          <span data-ac="todo-label">{labelFor(item)}</span>
          {item.priority != null && (
            <span data-ac="todo-priority" data-ac-level={item.priority}>
              {item.priority}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
