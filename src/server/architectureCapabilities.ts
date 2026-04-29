/**
 * Per-architecture capability registry.
 *
 * `modelChangeRequiresReplay` answers: when a thread switches model inside the
 * same architecture (e.g. claude-code: opus → sonnet), is it safe to keep
 * resuming the existing adapter session, or does the adapter need a fresh
 * session (and we replay history through the prompt)?
 *
 * Default is `true` (safe choice — replay). Architectures verified to accept
 * a model swap inside a resumed session opt into `false`.
 *
 * Architecture changes always require replay; this flag is only consulted when
 * `architecture` is unchanged but `model` differs.
 *
 * TODO(adapters): hoist this into `RuntimeArchitecture.capabilities` in
 * @inharness-ai/agent-adapters so adapters declare it themselves.
 */
const MODEL_CHANGE_REQUIRES_REPLAY: Record<string, boolean> = {
  'claude-code': false,
};

export function modelChangeRequiresReplay(architecture: string): boolean {
  return MODEL_CHANGE_REQUIRES_REPLAY[architecture] ?? true;
}
