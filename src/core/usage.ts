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

/**
 * Add one `result` frame's `usage` to a running total that may not exist yet.
 * `usage` on a `result` covers that block alone, so a message's (and a
 * stream's) usage is the sum over every `result` — used live by the reducer
 * and on persistence by the server, so the two never drift apart.
 */
export function accumulateUsage(current: UsageStats | undefined, delta: UsageStats | undefined): UsageStats | undefined {
  if (!delta) return current;
  return current ? addUsage(current, delta) : delta;
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
