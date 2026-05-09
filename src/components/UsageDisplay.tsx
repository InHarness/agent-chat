import React from 'react';

interface UsageDisplayProps {
  /** Last turn's `result.contextSize` (post-turn context window utilization). */
  contextSize: number | null;
  contextWindow?: number;
}

export function contextLevel(pct: number): 'low' | 'med' | 'high' {
  if (pct >= 80) return 'high';
  if (pct >= 60) return 'med';
  return 'low';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function UsageDisplay({ contextSize, contextWindow }: UsageDisplayProps) {
  if (contextSize === null || contextWindow === undefined || contextWindow <= 0) return null;

  const pct = Math.min(100, (contextSize / contextWindow) * 100);
  const level = contextLevel(pct);

  return (
    <div data-ac="usage">
      <div data-ac="usage-bar-row">
        <span data-ac="usage-label">Context</span>
        <div data-ac="usage-bar" data-level={level}>
          <div data-ac="usage-bar-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        </div>
        <span data-ac="usage-pct" data-level={level}>{pct.toFixed(1)}%</span>
        <span data-ac="usage-total">
          {formatTokens(contextSize)} / {formatTokens(contextWindow)}
        </span>
      </div>
    </div>
  );
}
