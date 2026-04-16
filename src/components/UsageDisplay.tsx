import React from 'react';
import type { UsageStats } from '../types.js';

interface UsageDisplayProps {
  usage: UsageStats;
}

export function UsageDisplay({ usage }: UsageDisplayProps) {
  return (
    <div data-ac="usage">
      <span data-ac="usage-item">
        In: {usage.inputTokens.toLocaleString()}
      </span>
      <span data-ac="usage-separator">/</span>
      <span data-ac="usage-item">
        Out: {usage.outputTokens.toLocaleString()}
      </span>
    </div>
  );
}
