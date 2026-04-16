import React from 'react';
import type { ServerConfig } from '../server/protocol.js';

interface ConfigBarProps {
  config: ServerConfig | null;
  architecture: string;
  model: string;
  onArchitectureChange: (arch: string) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
}

export function ConfigBar({ config, architecture, model, onArchitectureChange, onModelChange, disabled }: ConfigBarProps) {
  if (!config) return null;

  const architectures = Object.keys(config.architectures);
  const currentArchConfig = config.architectures[architecture];
  const models = currentArchConfig?.models ?? [];

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
        <select
          id="ac-model"
          data-ac="config-select"
          value={model}
          onChange={e => onModelChange(e.target.value)}
          disabled={disabled}
        >
          {models.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
