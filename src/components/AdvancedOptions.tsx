import React, { useState } from 'react';
import type { ArchOption } from '@inharness/agent-adapters';

interface AdvancedOptionsProps {
  cwd: string;
  onCwdChange: (cwd: string) => void;
  defaultCwd: string;
  activeCwd: string | null;
  systemPrompt: string;
  onSystemPromptChange: (sp: string) => void;
  maxTurns: number | undefined;
  onMaxTurnsChange: (mt: number | undefined) => void;
  options: ArchOption[];
  architectureConfig: Record<string, unknown>;
  onArchitectureConfigChange: (cfg: Record<string, unknown>) => void;
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
  options,
  architectureConfig,
  onArchitectureConfigChange,
  disabled,
}: AdvancedOptionsProps) {
  const [expanded, setExpanded] = useState(false);

  const cwdReadOnly = activeCwd !== null;

  const updateOption = (key: string, value: unknown) => {
    const next = { ...architectureConfig };
    if (value === undefined || value === '' || value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onArchitectureConfigChange(next);
  };

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
          {options.map(opt => (
            <ArchOptionField
              key={opt.key}
              option={opt}
              value={architectureConfig[opt.key]}
              onChange={v => updateOption(opt.key, v)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ArchOptionFieldProps {
  option: ArchOption;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}

function ArchOptionField({ option, value, onChange, disabled }: ArchOptionFieldProps) {
  const fieldId = `ac-opt-${option.key}`;

  if (option.type === 'boolean') {
    return (
      <div data-ac="advanced-field">
        <label data-ac="advanced-label" htmlFor={fieldId}>
          <input
            id={fieldId}
            data-ac="advanced-checkbox"
            type="checkbox"
            checked={value === true}
            onChange={e => onChange(e.target.checked ? true : undefined)}
            disabled={disabled}
          />
          {' '}{option.label}
        </label>
        {option.description && <small data-ac="advanced-help">{option.description}</small>}
      </div>
    );
  }

  if (option.type === 'select') {
    return (
      <div data-ac="advanced-field">
        <label data-ac="advanced-label" htmlFor={fieldId}>{option.label}</label>
        <select
          id={fieldId}
          data-ac="advanced-select"
          value={(value as string | undefined) ?? ''}
          onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
          disabled={disabled}
        >
          <option value="">{option.default != null ? `Default (${option.default})` : '—'}</option>
          {option.values?.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        {option.description && <small data-ac="advanced-help">{option.description}</small>}
      </div>
    );
  }

  if (option.type === 'number') {
    return (
      <div data-ac="advanced-field">
        <label data-ac="advanced-label" htmlFor={fieldId}>{option.label}</label>
        <input
          id={fieldId}
          data-ac="advanced-input"
          type="number"
          min={option.min}
          max={option.max}
          step={option.step}
          value={(value as number | undefined) ?? ''}
          onChange={e => {
            const s = e.target.value;
            if (s === '') return onChange(undefined);
            const n = Number(s);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
          placeholder={option.placeholder ?? (option.default != null ? String(option.default) : '')}
          disabled={disabled}
        />
        {option.description && <small data-ac="advanced-help">{option.description}</small>}
      </div>
    );
  }

  // 'string'
  return (
    <div data-ac="advanced-field">
      <label data-ac="advanced-label" htmlFor={fieldId}>{option.label}</label>
      <input
        id={fieldId}
        data-ac="advanced-input"
        type="text"
        value={(value as string | undefined) ?? ''}
        onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
        placeholder={option.placeholder ?? (option.default != null ? String(option.default) : '')}
        disabled={disabled}
      />
      {option.description && <small data-ac="advanced-help">{option.description}</small>}
    </div>
  );
}
