import React from 'react';
import type { UsageStats } from '../types.js';

interface UsageDisplayProps {
  usage: UsageStats;
  contextWindow?: number;
}

export function totalContextTokens(usage: UsageStats): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    (usage.cacheReadInputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0)
  );
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

export function UsageDisplay({ usage, contextWindow }: UsageDisplayProps) {
  const total = totalContextTokens(usage);
  const cacheTotal = (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
  const hasWindow = contextWindow !== undefined && contextWindow > 0;
  const pct = hasWindow ? Math.min(100, (total / contextWindow!) * 100) : 0;
  const level = hasWindow ? contextLevel(pct) : 'low';

  return (
    <div data-ac="usage">
      {hasWindow && (
        <div data-ac="usage-bar-row">
          <span data-ac="usage-label">Context</span>
          <div data-ac="usage-bar" data-level={level}>
            <div data-ac="usage-bar-fill" style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
          <span data-ac="usage-pct" data-level={level}>{pct.toFixed(1)}%</span>
          <span data-ac="usage-total">
            {formatTokens(total)} / {formatTokens(contextWindow!)}
          </span>
        </div>
      )}
      <div data-ac="usage-breakdown">
        <span data-ac="usage-item">In: {usage.inputTokens.toLocaleString()}</span>
        <span data-ac="usage-separator">·</span>
        <span data-ac="usage-item">Out: {usage.outputTokens.toLocaleString()}</span>
        {cacheTotal > 0 && (
          <>
            <span data-ac="usage-separator">·</span>
            <span data-ac="usage-item">Cache: {cacheTotal.toLocaleString()}</span>
          </>
        )}
      </div>
    </div>
  );
}
