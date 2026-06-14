import React, { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import type { QueuedMessage } from '../server/protocol.js';

interface InputAreaProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  planMode?: boolean;
  onPlanModeChange?: (v: boolean) => void;
  /** Messages waiting in the thread's queue, rendered as chips above the composer. */
  queuedMessages?: QueuedMessage[];
  /** Cancel a single queued message (chip ×). */
  onCancelQueued?: (id: string) => void;
  /**
   * Text to restore into the composer (decision D4 — Stop/abort returns the
   * cleared queue's texts). Applied whenever `restoreNonce` changes, so repeated
   * restores of the same text still fire.
   */
  restoreText?: string;
  restoreNonce?: number;
}

export function InputArea({
  onSend,
  onAbort,
  isStreaming,
  disabled,
  planMode,
  onPlanModeChange,
  queuedMessages,
  onCancelQueued,
  restoreText,
  restoreNonce,
}: InputAreaProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // D4: restore cleared queue texts into the composer (append to whatever the
  // user may have already typed). Keyed on `restoreNonce` so identical texts
  // restore again on a later Stop.
  useEffect(() => {
    if (!restoreText) return;
    setText(prev => (prev.trim() ? `${prev}\n\n${restoreText}` : restoreText));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreNonce]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  return (
    <div data-ac="input-area">
      {queuedMessages && queuedMessages.length > 0 && (
        <div data-ac="queue-chips">
          {queuedMessages.map(q => (
            <span data-ac="queue-chip" key={q.id} title={q.text}>
              <span data-ac="queue-chip-text">{q.text}</span>
              {onCancelQueued && (
                <button
                  data-ac="queue-chip-cancel"
                  onClick={() => onCancelQueued(q.id)}
                  type="button"
                  aria-label="Cancel queued message"
                >
                  {'×'}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div data-ac="input-row">
        <textarea
          ref={textareaRef}
          data-ac="input-textarea"
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Queue a message…' : 'Type a message...'}
          rows={1}
          disabled={disabled}
        />
        {/* Composer stays unlocked during a turn: Send (queues) and a separate
            Stop are shown side by side rather than swapped. */}
        <button
          data-ac={isStreaming ? 'queue-button' : 'send-button'}
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          type="button"
        >
          Send
        </button>
        {isStreaming && (
          <button data-ac="abort-button" onClick={onAbort} type="button">
            Stop
          </button>
        )}
      </div>
      {onPlanModeChange && (
        <label data-ac="plan-mode-check" data-ac-active={planMode ? 'true' : 'false'}>
          <input
            type="checkbox"
            checked={!!planMode}
            onChange={e => onPlanModeChange(e.target.checked)}
            disabled={disabled || isStreaming}
          />
          <span>Plan mode (read-only)</span>
        </label>
      )}
    </div>
  );
}
