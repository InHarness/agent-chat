# Changelog

All notable changes to `@inharness-ai/agent-chat` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.3.2] — 2026-09-04

### Fixed
- Subagent events arriving **after** `subagent_completed` are no longer lost or mis-attributed. `@inharness-ai/agent-adapters` emits the content channel (`tool_use` / `tool_result`) and the lifecycle channel (`subagent_completed`) without ordering between them, so a subagent can report completion while its results are still streaming. The reducer used to delete the registry entry on completion, which left late `tool_result`s either dropped (the tool card in the panel spun forever until an `F5` rehydrated it from the DB) or routed into a *different* running subagent's panel. The entry now survives completion with its status flipped to `completed` / `failed`, so late events still resolve to the right panel; the registry is still cleared wholesale at end of turn.
- An event carrying an **unknown** explicit `subagentTaskId` is now dropped instead of falling back to "the last running subagent". The fallback applies only to events with no `subagentTaskId` at all (the adapter's documented graceful degradation for deltas that precede their `task_started`).
- Tool errors render red live instead of only after a refresh: `WireEvent`'s `tool_result` variant now declares `isError?: boolean` and the handler forwards it rather than hardcoding `false`.
- Tool errors also survive a refresh. The server-side block reducer built `toolResult` blocks without `isError`, so a failed tool was persisted as a success: after `F5` its card rendered green, and `historyBuilder` replayed it to the model as `[tool-result: N chars, ok]`. Both the root and the nested-subagent paths now write the flag.
- The server-side block reducer applies the same "never guess an unknown `subagentTaskId`" rule as the client reducer. The two disagreeing meant a mis-addressed event was dropped live but filed under whichever subagent happened to be running when persisted — so a refresh could add a tool card to a panel that never showed one.
- A turn ending in `error` (including Stop/abort, which dispatches `{ type: 'error', code: 'ABORTED' }`) now clears `activeSubagents`. Only `result` did, and registry entries outlive completion as of this release, so an aborted turn's subagents leaked into every turn that followed.
- `withFrame` preserves referential equality of `state.messages` when a subagent event changes nothing. The previous guards compared arrays produced by `.map`, which never match, so they could never fire. No current handler returns an unchanged frame, so this is an invariant for future ones rather than a live fix.
- Adapter errors that arrive as plain objects rather than `Error` instances no longer serialize to `"[object Object]"`; `serialize.ts` falls back to `name` before stringifying.

## [0.3.1] — 2026-06-14

### Added
- Message queueing + mid-turn injection: the composer now stays unlocked during a live turn. Messages typed while the agent is working are queued and delivered either **mid-turn** (pushed into the live Claude Agent SDK session) or **after-turn** (merged into a single follow-up turn). Adds `user_message` / `queue_updated` / `queue_cleared` wire events, the `QueuedMessage` type, queue endpoints, an in-memory queue store on the reference server, queue chips in the UI, and Send-to-queue + Stop controls.

### Changed
- Bumped `@inharness-ai/agent-adapters` dependency from `^0.6.1` to `^0.8.0`.
- Updated README with the new model names and defaults for the `claude-code` architecture; added `CHANGES-0.1.1.md` documenting the per-turn `contextSize` rollout.

### Fixed
- Picked up the `agent-adapters@0.8.0` fix where importing the package no longer eagerly loads the optional `@anthropic-ai/claude-agent-sdk` peer — the SDK is now imported lazily, so consumers (and servers) that don't use the `claude-code` architecture no longer need that package installed to import the adapters.

## [0.3.0] — 2026-05-28

### Changed
- Bumped `@inharness-ai/agent-adapters` dependency from `^0.4.0` to `^0.6.1`, picking up the latest adapter capabilities and fixes.

## [0.2.0] — 2026-05-13

### Added
- Per-turn `contextSize` propagated end-to-end (`WireEvent.result`, `ChatMessage`, `ChatState`, `StoredMessage`) so consumers can render an accurate "X / 200k" utilization bar instead of summing billing tokens. Exposed `contextSize` on `useAgentChat`'s return value and on the `useMessageReducer` state. New public helper `contextSizeOf(usage)` for computing the metric from a raw `UsageStats`.
- Architecture-rollover support: change architecture/model mid-thread while preserving messages, `sessionId`, and cumulative usage. New server modules backing this: `executionPlan` (session resumption decisions), `historyBuilder` (cross-architecture history assembly), `persistence` (message auditing & rollover-aware storage), `blockReducer` (UI content-block stream reduction), and `architectureCapabilities` (per-architecture feature surface).
- Pluggable `logger` interface in public types; `useAgentChat` and related hooks now accept and propagate it.
- `pairToolBlocks` utility for cleaner tool-block rendering inside `AssistantContent`.
- Comprehensive usage docs covering installation, backend setup, drop-in vs. hooks integration modes, theming, advanced features, and custom tool renderers.

### Changed
- Bumped `@inharness-ai/agent-adapters` dependency to `^0.4.0` and switched from the local `file:` link to the published range — installing `@inharness-ai/agent-chat` from npm now resolves correctly.
- `messageReducer` patches `architecture` and `model` while preserving `messages`, `sessionId`, and `usage` on architecture changes.
- `useAgentChat` keeps the active thread across architecture switches instead of dropping it.
- `useAgentChat` and related hooks reworked for advanced options and tighter state management.

### Fixed
- Published `@inharness-ai/agent-chat@0.1.1` shipped with a `file:../agent-adapters` dependency that broke installs from the registry. Resolved here.

### Breaking
- `WireEvent.result.contextSize` is now **required** on every `result` event. Custom servers, proxies, or test fixtures synthesizing `WireEvent` must include it (`contextSize: usage.inputTokens + usage.outputTokens` is the canonical value); existing TypeScript code without it will fail to compile against the new types.
- Consumers that previously computed context-window utilization by summing `usage.inputTokens + outputTokens + cacheRead + cacheCreation` must switch to reading `chat.contextSize` (per-turn, overwritten — do not sum across turns). `state.usage` retains its cumulative billing semantics.

## [0.1.1] — 2026-04-28

### Added
- `agent-chat` CLI binary for instant local usage, served by an embedded Vite-built web UI.
- `UserInputRequestBlock` and `UserInputResponderContext` for handling agent-initiated user input prompts; `useAgentChat` now exposes a way to send user input responses, and `useMessageReducer` handles user input events.
- `ConfigBar` custom model input — switch between preset models and a free-form custom model id.

### Changed
- Bumped `@inharness-ai/agent-adapters` peer/dep to `^0.2.1`.
- Minimum Node.js version raised to 20.
- Server serialization errors now produce clearer messages.
- README expanded with instant-usage instructions, endpoint configuration docs, and component examples.

[0.3.1]: https://github.com/InHarness/agent-chat/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/InHarness/agent-chat/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/InHarness/agent-chat/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/InHarness/agent-chat/compare/v0.1.0...v0.1.1
