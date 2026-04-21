import React from 'react';
import type { ArchOption } from '@inharness-ai/agent-adapters';

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
  model?: string;
  disabled?: boolean;
  open: boolean;
  onClose: () => void;
}

function resolveOption(
  opt: ArchOption,
  config: Record<string, unknown>,
  model: string | undefined,
): ArchOption | null {
  if (opt.visibleWhen) {
    const cur = config[opt.visibleWhen.key];
    const target = opt.visibleWhen.equals;
    const visible = Array.isArray(target) ? target.includes(cur) : cur === target;
    if (!visible) return null;
  }
  if (opt.modelOverrides && model && opt.modelOverrides[model]) {
    return { ...opt, ...opt.modelOverrides[model] };
  }
  return opt;
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
  model,
  disabled,
  open,
  onClose,
}: AdvancedOptionsProps) {
  const cwdReadOnly = activeCwd !== null;

  const globalOpts = options.filter(o => o.scope === 'global');
  const archOpts = options.filter(o => o.scope === 'architecture');

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
    <aside
      data-ac="advanced-drawer"
      data-ac-open={open ? 'true' : 'false'}
      aria-hidden={!open}
      aria-label="Advanced options"
    >
      <div data-ac="advanced-drawer-header">
        <span data-ac="advanced-drawer-title">Advanced options</span>
        <button
          data-ac="advanced-drawer-close"
          onClick={onClose}
          type="button"
          aria-label="Close advanced options"
          tabIndex={open ? 0 : -1}
        >
          &#10005;
        </button>
      </div>
      <div data-ac="advanced-drawer-body">
        <section data-ac="advanced-section">
          <h3 data-ac="advanced-section-title">Built-in</h3>
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
              tabIndex={open ? 0 : -1}
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
              rows={4}
              tabIndex={open ? 0 : -1}
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
              tabIndex={open ? 0 : -1}
            />
          </div>
          {globalOpts.map(opt => {
            const resolved = resolveOption(opt, architectureConfig, model);
            if (!resolved) return null;
            return (
              <ArchOptionField
                key={resolved.key}
                option={resolved}
                value={architectureConfig[resolved.key]}
                onChange={v => updateOption(resolved.key, v)}
                disabled={disabled}
                tabIndex={open ? 0 : -1}
              />
            );
          })}
        </section>
        {archOpts.length > 0 && (
          <section data-ac="advanced-section">
            <h3 data-ac="advanced-section-title">Architecture</h3>
            {archOpts.map(opt => {
              const resolved = resolveOption(opt, architectureConfig, model);
              if (!resolved) return null;
              return (
                <ArchOptionField
                  key={resolved.key}
                  option={resolved}
                  value={architectureConfig[resolved.key]}
                  onChange={v => updateOption(resolved.key, v)}
                  disabled={disabled}
                  tabIndex={open ? 0 : -1}
                />
              );
            })}
          </section>
        )}
      </div>
    </aside>
  );
}

interface ArchOptionFieldProps {
  option: ArchOption;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  tabIndex?: number;
}

function ArchOptionField({ option, value, onChange, disabled, tabIndex }: ArchOptionFieldProps) {
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
            tabIndex={tabIndex}
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
          tabIndex={tabIndex}
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
          tabIndex={tabIndex}
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
        tabIndex={tabIndex}
      />
      {option.description && <small data-ac="advanced-help">{option.description}</small>}
    </div>
  );
}
