import React from 'react';
import type { ThreadMeta } from '../server/protocol.js';
import { ThreadItem } from './ThreadItem.js';

interface ThreadListProps {
  threads: ThreadMeta[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onNewThread: () => void;
  onClose?: () => void;
  collapsed?: boolean;
}

export function ThreadList({ threads, activeThreadId, onSelect, onDelete, onRename, onNewThread, onClose, collapsed }: ThreadListProps) {
  return (
    <div data-ac="thread-list" data-ac-collapsed={collapsed ? 'true' : undefined} aria-hidden={collapsed ? 'true' : undefined}>
      <div data-ac="thread-list-header">
        {onClose && (
          <button
            data-ac="thread-list-close"
            onClick={onClose}
            type="button"
            aria-label="Hide conversations"
            title="Hide conversations"
          >
            {'\u2715'}
          </button>
        )}
        <span data-ac="thread-list-title">Conversations</span>
        <button data-ac="new-thread-button" onClick={onNewThread} type="button">
          + New
        </button>
      </div>
      <div data-ac="thread-list-items">
        {threads.length === 0 ? (
          <div data-ac="thread-list-empty">No conversations yet</div>
        ) : (
          threads.map(thread => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onSelect={() => onSelect(thread.id)}
              onDelete={() => onDelete(thread.id)}
              onRename={(title) => onRename(thread.id, title)}
            />
          ))
        )}
      </div>
    </div>
  );
}
