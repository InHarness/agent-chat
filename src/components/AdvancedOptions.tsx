import React, { useState } from 'react';

interface AdvancedOptionsProps {
  cwd: string;
  onCwdChange: (cwd: string) => void;
  defaultCwd: string;
  activeCwd: string | null;
  systemPrompt: string;
  onSystemPromptChange: (sp: string) => void;
  maxTurns: number | undefined;
  onMaxTurnsChange: (mt: number | undefined) => void;
  disabled?: boolean;
}

export function AdvancedOptions({
  cwd,
  onCwdChange,
  defaultCwd,
  activeCwd,
  systemPrompt,
  onSystemPromptChange,
  maxTurns,
  onMaxTurnsChange,
  disabled,
}: AdvancedOptionsProps) {
  const [expanded, setExpanded] = useState(false);

  const cwdReadOnly = activeCwd !== null;

  return (
    <div data-ac="advanced-options">
      <button
        data-ac="advanced-toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span data-ac="advanced-chevron" data-expanded={expanded}>&#9656;</span>
        Advanced options
      </button>
      {expanded && (
        <div data-ac="advanced-panel">
          <div data-ac="advanced-field">
            <label data-ac="advanced-label" htmlFor="ac-cwd">Working directory</label>
            <input
              id="ac-cwd"
              data-ac="advanced-input"
              data-ac-mono="true"
              type="text"
              value={cwdReadOnly ? activeCwd : cwd}
              onChange={e => onCwdChange(e.target.value)}
              placeholder={defaultCwd}
              disabled={disabled || cwdReadOnly}
              readOnly={cwdReadOnly}
            />
          </div>
          <div data-ac="advanced-field">
            <label data-ac="advanced-label" htmlFor="ac-system-prompt">System prompt</label>
            <textarea
              id="ac-system-prompt"
              data-ac="advanced-textarea"
              value={systemPrompt}
              onChange={e => onSystemPromptChange(e.target.value)}
              placeholder="Override default system prompt..."
              disabled={disabled}
              rows={3}
            />
          </div>
          <div data-ac="advanced-field">
            <label data-ac="advanced-label" htmlFor="ac-max-turns">Max turns</label>
            <input
              id="ac-max-turns"
              data-ac="advanced-input"
              type="number"
              min={1}
              value={maxTurns ?? ''}
              onChange={e => {
                const val = e.target.value;
                onMaxTurnsChange(val === '' ? undefined : parseInt(val, 10));
              }}
              placeholder="Unlimited"
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
