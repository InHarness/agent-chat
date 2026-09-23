# Changelog

All notable changes to `@inharness-ai/agent-chat` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.4.0] — Unreleased

Adapters that hold the session after handing control back (claude-code via agent-adapters 0.9.13 keeps it open while subagents or background tasks finish, then wakes the model and emits another `result`) now work end to end. The wire frames keep their shape; what changed is what they mean. See "Migrating from the single-`result` contract" in the chat protocol spec (`03-backend/03-chat-protocol.md`).

### Changed — behaviour
- **`result` closes a block, not the turn.** The reducer no longer tears the stream down on `result`: `isStreaming`, `activeAssistantMessageId` and `activeSubagents` stay as they are, so text after a second `result` is rendered and subagent panels stay open. `result` only adds its `usage`, overwrites `contextSize`, updates `sessionId` when present and closes the open text/thinking blocks.
- **`done` ends the stream.** `useEventStream` now forwards `done` to `onEvent` instead of swallowing it; the reducer's new `done` handler finalizes the active message and clears `isStreaming`, `activeAssistantMessageId` and `activeSubagents`. `done` and `error` are idempotent — `error` followed by `done` tears down once.
- An SSE connection that closes without `done` (server crash, proxy cut) is treated as `done`, so the UI no longer stays stuck in streaming. A deliberate `disconnect()` / `abort()` gets no synthetic `done`. With your own transport, dispatch `{ type: 'done' }` when it closes.
- **A further `turn_start` on the same stream opens a new user/assistant pair.** Previously it could rewrite the ids of the previous pair. Only the first `turn_start` adopts the optimistic pair created by `USER_MESSAGE` (new state field `optimisticAssistantMessageId`).
- The server emits `queue_updated` **before** `done`, so `done` is always the stream's last frame, in live streams and in replay.
- After an adapter `error` event only `queue_updated` and `done` follow on the wire, and no queued turn runs on that stream. Messages still queued are handed back with `queue_cleared` (texts for the composer, as on Stop) instead of staying queued with nothing to deliver them. The server still reads the adapter stream to its end — codex reports some runtime errors and carries on — but keeps only a later `result`'s `sessionId`; content and usage the client never saw are not persisted.
- Client-side errors of a side request (`QUEUE_ERROR` from a failed enqueue, `USER_INPUT_ERROR` from a failed user-input answer) set `error` without tearing down the live stream.
- Frames that belong inside a turn (content, subagent lifecycle, `result`, …) are dropped by the reducer while no assistant message is active — before the first `turn_start` and after `done` / `error`. A stray `result` no longer moves the hook's `usage` past what the persisted thread holds.

### Fixed
- An assistant message's `usage` is the sum over every `result` it received — live and persisted. It used to be overwritten by the last `result`, so after a reload the thread's cost was understated.
- A `result` without `sessionId` no longer erases the session id recorded for the thread.
- A throw during request setup after the SSE headers were sent (thread lookup, execution plan, thread update) left the stream open with no `done` and the thread locked. It now ends with `error` + `done` like any other failure.
- Frames an aborted stream produced while it was still unwinding could leak into the thread's next stream once a new `POST /api/chat` took the thread, and its after-turn loop could start a queued turn after Stop. The handler now emits only while its session still owns the thread, and no queued turn runs after Stop. Abort also cancels the thread's pending user-input prompts so the adapter can unwind.
- An exception thrown by the adapter (rather than emitted as an `error` event) now gets its proper `code` (`ADAPTER_TIMEOUT`, `IDLE_TIMEOUT`, …) instead of always `UNKNOWN`.
- A connection that drops mid-stream (a network error rather than a clean close) is resumed: the client rejoins `GET /api/chat/stream/:threadId` with `Last-Event-ID`, up to three times with backoff, so only the missed frames are replayed. If the stream has already ended on the server (404), the client delivers `done` and reloads the thread from disk. `useEventStream` gets an `onStreamLost(threadId)` option. It used to surface `NETWORK_ERROR` while the turn went on running on the server.
- Reloading a thread within 2 s of its stream ending no longer shows the last exchange twice. The join replayed turns that the reload had already restored from disk. A `turn_start` for an assistant message the state already holds is now ignored, along with its frames.

### Internal
- `accumulateUsage` (in `core/usage.ts`) is the single rule for summing `result` usage, used by the reducer and by server persistence. Stream teardown for `done` / `error` is one shared helper (`teardownStream`).

### Removed
- `src/server/persistence.ts` (`persistTurn`) — dead code, never exported; threads are written once per stream by `appendMessages()` after `done`.

## [0.3.4] — 2026-09-23

### Changed
- Requires `@inharness-ai/agent-adapters` `^0.9.13` (was `^0.9.0`). 0.9.10–0.9.12 were never published, so this is the first published version carrying subagent re-entry (`resumed: true`, handled since 0.3.3).
- The `error` wire event gets a dedicated `code` for every terminal error class agent-adapters exports. They used to fall through to `UNKNOWN`: `IDLE_TIMEOUT` (`AdapterIdleTimeoutError`), `TOOL_CALL_TIMEOUT` (`AdapterToolCallTimeoutError`), `SUBAGENT_TIMEOUT` (`AdapterSubagentTimeoutError`), `BACKGROUND_HOLD_EXPIRED` (`AdapterBackgroundHoldExpiredError`), `TOOL_POLICY` (`AdapterToolPolicyError`). The three timeout classes are siblings of `AdapterTimeoutError`, not subclasses, so `ADAPTER_TIMEOUT` still means only the `timeoutMs` backstop. The handler still passes none of the new per-unit timeouts to `execute()`, so none of those clocks is armed by agent-chat itself.

### Fixed
- A subagent closed with `status: 'aborted'` (agent-adapters flushes open subagents when a run ends by abort, timeout or hold-cap expiry) or `'stopped'` no longer renders with the failure mark ✕. `SubagentPanel` shows ⊘; `data-status` carries the raw value as before.

### Notes
- agent-adapters 0.9.13 changed the claude-code background hold: a parked stretch whose only unsettled work is a background subagent is now cut at `claude_backgroundHoldCapMs` (default 90s), however busy the subagent is. It surfaces as `BACKGROUND_HOLD_EXPIRED`. Raise the cap via `architectureConfig` if your subagents outlive the turn.

## [0.3.3] — 2026-09-22

Never published to npm; its changes first ship in 0.3.4.

### Fixed
- Re-entered subagents no longer spawn a duplicate panel. Since `@inharness-ai/agent-adapters` 0.9.12 a subagent resumed via `SendMessage` opens another lifecycle cycle under the **same** `taskId`: a second `subagent_started` (with `resumed: true`) followed by its own `subagent_completed`. Both reducers (client `handleSubagentStarted` and server `applyEventToStoredBlocks`) now resume the existing block in the current turn — status back to `running`; the original `toolUseId` (so the panel stays paired with the tool card that spawned the agent), description and summary kept — instead of appending a second block. The last `subagent_completed` for the `taskId` sets the status; it replaces the summary only when it carries one, so a re-entry that ends without a report does not erase the first cycle's. A re-entry in a later turn still opens a fresh panel in that turn's message.
- Subagent content, completion and lookups by `taskId` target the **last** subagent block with that id (client `withFrame` / `handleSubagentCompleted`, server `resolveSubagentBlock` / `subagent_completed`), so older persisted threads that already hold duplicate blocks route events into exactly one panel.

### Changed
- `WireEvent`'s `subagent_started` variant declares `resumed?: boolean`.
- Widened the `@inharness-ai/agent-adapters` dependency from `^0.8.0` to `^0.9.0`, so a consuming app on 0.9.x loads a single copy of the library.

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

[0.3.4]: https://github.com/InHarness/agent-chat/compare/v0.3.2...v0.3.4
[0.3.2]: https://github.com/InHarness/agent-chat/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/InHarness/agent-chat/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/InHarness/agent-chat/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/InHarness/agent-chat/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/InHarness/agent-chat/compare/v0.1.0...v0.1.1
