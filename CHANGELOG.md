# Changelog

All notable changes to `@inharness-ai/agent-chat` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

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

[0.1.1]: https://github.com/InHarness/agent-chat/compare/v0.1.0...v0.1.1
