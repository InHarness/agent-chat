import React, { useState, useCallback, useRef, type KeyboardEvent } from 'react';

interface InputAreaProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  planMode?: boolean;
  onPlanModeChange?: (v: boolean) => void;
}

export function InputArea({ onSend, onAbort, isStreaming, disabled, planMode, onPlanModeChange }: InputAreaProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isStreaming, onSend]);

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
      <div data-ac="input-row">
        <textarea
          ref={textareaRef}
          data-ac="input-textarea"
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={disabled || isStreaming}
        />
        {isStreaming ? (
          <button data-ac="abort-button" onClick={onAbort} type="button">
            Stop
          </button>
        ) : (
          <button
            data-ac="send-button"
            onClick={handleSend}
            disabled={!text.trim() || disabled}
            type="button"
          >
            Send
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
