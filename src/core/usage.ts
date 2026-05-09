import type { UsageStats } from '../types.js';

// Local mirror of `addUsage`/`sumUsage` from `@inharness-ai/agent-adapters`.
// Inlined here so client code does not pull the library's runtime entry into
// the Vite bundle (it re-exports node-only adapters like gemini-cli-core that
// fail to bundle for the browser).

const ZERO: UsageStats = { inputTokens: 0, outputTokens: 0 };

export function addUsage(a: UsageStats, b: UsageStats): UsageStats {
  const out: UsageStats = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (a.cacheReadInputTokens !== undefined || b.cacheReadInputTokens !== undefined) {
    out.cacheReadInputTokens = (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0);
  }
  if (a.cacheCreationInputTokens !== undefined || b.cacheCreationInputTokens !== undefined) {
    out.cacheCreationInputTokens = (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0);
  }
  return out;
}

export function sumUsage(...stats: UsageStats[]): UsageStats {
  return stats.reduce<UsageStats>((acc, s) => addUsage(acc, s), { ...ZERO });
}

/**
 * Total tokens occupying the model's context window after a turn. Mirror of
 * `contextSize()` from `@inharness-ai/agent-adapters` — inlined here for the
 * same reason as `addUsage`/`sumUsage` (browser bundle avoids the runtime
 * entry of the adapters package). Use the LAST turn's value, never sum across
 * turns. See agent-adapters/src/usage.ts and types.ts for the rationale.
 */
export function contextSizeOf(usage: UsageStats): number {
  return usage.inputTokens + usage.outputTokens;
}
