import React, { useState, useCallback } from 'react';
import type { ThreadMeta } from '../server/protocol.js';

interface ThreadItemProps {
  thread: ThreadMeta;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

export function ThreadItem({ thread, isActive, onSelect, onDelete, onRename }: ThreadItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(thread.title);

  const handleRename = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== thread.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editTitle, thread.title, onRename]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  }, [onDelete]);

  const handleEditClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(thread.title);
    setIsEditing(true);
  }, [thread.title]);

  const timeAgo = formatTimeAgo(thread.updatedAt);

  return (
    <div data-ac="thread-item" data-active={isActive || undefined} onClick={onSelect}>
      <div data-ac="thread-item-content">
        {isEditing ? (
          <input
            data-ac="thread-item-edit"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <>
            <span data-ac="thread-item-title">{thread.title}</span>
            <span data-ac="thread-item-meta">
              {thread.architecture} &middot; {timeAgo}
            </span>
          </>
        )}
      </div>
      <div data-ac="thread-item-actions">
        <button data-ac="thread-item-edit-btn" onClick={handleEditClick} type="button" title="Rename">
          &#9998;
        </button>
        <button data-ac="thread-item-delete-btn" onClick={handleDelete} type="button" title="Delete">
          &times;
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
