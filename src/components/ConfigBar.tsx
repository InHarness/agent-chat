import React, { useEffect, useState } from 'react';
import type { ServerConfig } from '../server/protocol.js';

interface ConfigBarProps {
  config: ServerConfig | null;
  architecture: string;
  model: string;
  onArchitectureChange: (arch: string) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
}

const CUSTOM_SENTINEL = '__custom__';

export function ConfigBar({ config, architecture, model, onArchitectureChange, onModelChange, disabled }: ConfigBarProps) {
  const architectures = config ? Object.keys(config.architectures) : [];
  const currentArchConfig = config?.architectures[architecture];
  const models = currentArchConfig?.models ?? [];

  const modelInList = models.includes(model);
  // Custom mode is sticky once chosen, OR derived when the current model isn't in the list.
  const [customMode, setCustomMode] = useState(!!model && !modelInList);

  // When the architecture changes and the new list contains the current model,
  // drop back to select mode automatically.
  useEffect(() => {
    if (modelInList) setCustomMode(false);
  }, [architecture, modelInList]);

  if (!config) return null;

  const showCustom = customMode || (!!model && !modelInList);
  // Value the <select> renders. If the current model isn't in the list and we're
  // in custom mode, show the sentinel so the "Inny…" option is highlighted.
  const selectValue = modelInList ? model : CUSTOM_SENTINEL;

  const handleSelectChange = (value: string) => {
    if (value === CUSTOM_SENTINEL) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    onModelChange(value);
  };

  const handleBackToList = () => {
    setCustomMode(false);
    if (!modelInList && models.length > 0) onModelChange(models[0]);
  };

  return (
    <div data-ac="config-bar">
      <div data-ac="config-field">
        <label data-ac="config-label" htmlFor="ac-architecture">Architecture</label>
        <select
          id="ac-architecture"
          data-ac="config-select"
          value={architecture}
          onChange={e => onArchitectureChange(e.target.value)}
          disabled={disabled}
        >
          {architectures.map(arch => (
            <option key={arch} value={arch}>{arch}</option>
          ))}
        </select>
      </div>
      <div data-ac="config-field">
        <label data-ac="config-label" htmlFor="ac-model">Model</label>
        {showCustom ? (
          <>
            <input
              id="ac-model"
              data-ac="config-input"
              value={model}
              onChange={e => onModelChange(e.target.value)}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              placeholder="np. provider/model-name"
              autoFocus
            />
            <button
              type="button"
              data-ac="config-back"
              onClick={handleBackToList}
              disabled={disabled}
              title="Wybierz z listy"
              aria-label="Wybierz z listy"
            >
              ×
            </button>
          </>
        ) : (
          <select
            id="ac-model"
            data-ac="config-select"
            value={selectValue}
            onChange={e => handleSelectChange(e.target.value)}
            disabled={disabled}
          >
            {models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value={CUSTOM_SENTINEL}>Inny…</option>
          </select>
        )}
      </div>
    </div>
  );
}
