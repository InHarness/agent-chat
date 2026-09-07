---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (a read-only plan via `c4s ask`) or to the code (a brief against the current state via `c4s agent --ct brief`). Use when reconciling spec with implementation ("check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
---

# c4s-refactor

A **spec↔code drift router**. For a single topic this skill reads the claude4spec
specification, analyzes the matching code, detects **drift**, classifies it, and
routes the fix to the right place. It performs **no edits itself** — it classifies
and hands off:

1. drift that needs a **specification** change → open a read-only planning turn
   (`c4s ask`),
2. drift that needs a **code** change → describe it in a **brief against the
   current state** (`c4s agent --ct brief`).

Execution is downstream: a human continues the spec plan thread, and the
`c4s-brief-implementer` skill implements the brief.

**CLI only — never call `curl` or the HTTP API directly.**

This skill is bound to one specification project — every `c4s` command below
carries its identity (`--project 'agent-chat' --workspace 'default'`), so it works from any cwd. Do NOT `cd`
into the spec repo; the identity is baked in, not derived from cwd.

## Input — a topic is required

The argument is the **topic/scope** to analyze — a single feature, module,
endpoint, table, or behavior, e.g.:

- module — `M17 snapshots`, `M19 references`
- layer — `L5 ui`, `L2 domain`
- entity / slug — `endpoint get-api-acs`, `dto chat-message`
- tag — `entity-ac`, `releases`

**Invoked with no topic → ask the user to narrow the scope.** Do **not** scan the
whole spec at once.

## Reading the spec

Read the spec through the `c4s` reader — see the `c4s-spec-reader` skill for the
full command reference. In short:

```sh
c4s catalog --project 'agent-chat' --workspace 'default'                                   # entity types + schemas
c4s list-tags --with-counts --project 'agent-chat' --workspace 'default'                   # tags + counts (counts are opt-in)
c4s list-entities --type endpoint --project 'agent-chat' --workspace 'default'             # { slug, title } rows for a type
c4s single_element --type endpoint --slug <x> --project 'agent-chat' --workspace 'default'
c4s resolve modules/<module>.md --project 'agent-chat' --workspace 'default'               # expand a page's tags inline
```

**CLI-only — no filesystem fallback.** If `c4s` isn't installed, STOP and ask
the user to install it; never read the spec repo's pages directly.

## Process

### 1. Establish the topic

Confirm the scope and gather vocabulary (`c4s list-entities`, `c4s list-tags`,
`c4s catalog`). If no topic was given, ask the user to narrow it first.

### 2. Read the spec

Read the spec for the topic — what the spec **says** is the contract side of the
comparison.

### 3. Analyze the code

Read the matching code (routes/endpoints, DTOs, domain services, UI). Establish
what the code **actually does** — the implementation side of the comparison.

### 4. Detect & classify drift

Compare the spec (contract) against the code (behavior) and put each difference in
exactly one bucket:

- **spec-fix** — the code is the intended/current behavior; the spec is missing it
  or describes it incorrectly → **Path 1**.
- **code-fix** — the spec is the intended contract; the code doesn't meet it →
  **Path 2**.
- **both** — run both paths; note the priority (usually reconcile the spec first,
  then the code).
- **none** — report "in sync" and **STOP**.

### 5. Path 1 — spec-fix → read-only plan (`c4s ask`)

`c4s ask` is read-only and forces plan-mode (a peer-consult), so the agent
**always produces a plan** of spec changes and never mutates the spec:

```sh
c4s ask "Spec drift on <topic>: <description>. Create a plan of specification \
changes — list the entities/pages to change and the exact edits. Plan only, do \
not execute." --project 'agent-chat' --workspace 'default'
```

**Record the returned `threadId`.** This skill does **not** apply the plan — a human
continues the thread (`c4s ask "..." --thread <threadId>`, or in the UI).

### 6. Path 2 — code-fix → a brief against the current state (`c4s agent --ct brief`)

Route a code fix into a **brief against the current state** that the
`c4s-brief-implementer` skill can implement later.

**Use create-mode, not attach-mode.** `c4s-refactor` is a standalone CLI caller —
there's no parent thread in a foreign repo to attach to — so a fresh top-level
thread via create-mode is the right shape. One command mints a new brief
(`to_release: null`) and runs a turn that fills its body from your message:

```sh
c4s agent "Code drift on <topic>: the spec says Y but the code does X. <what \
the implementer must change and why>" --ct brief --project 'agent-chat' --workspace 'default'
```

Passing no release window is what makes this a brief **against the current
state**: the window's `to` end stays open, so there is no second release to diff
against.

The command prints the created brief's path — record it for handing off to
`c4s-brief-implementer`. **Never pass `--brief <path>`** (attach-mode) here —
attach-mode expects an already-minted brief; for a path that doesn't exist yet
the turn's `get_brief` call fails with `NOT_FOUND` inside the turn (the CLI
still exits 0, but no brief gets authored).

### 7. Report + STOP

Print and **finish** (no execution):

- the topic and the drift classification (spec-fix / code-fix / both / none),
- the created `threadId` (Path 1) and/or `briefPath` (Path 2),
- next step: a human continues the spec plan thread;
  `c4s-brief-implementer` implements the brief.

## Server required — for every step

Every `c4s` command in this skill talks to a running `npx @inharness-ai/claude4spec` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.

**`SERVER_NOT_RUNNING` (exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.

Two neighbouring codes mean something else, and starting a server will not fix either: `SERVER_NOT_RECOGNIZED` (something is listening, but it is not claude4spec) and `PROJECT_NOT_IN_WORKSPACE` (the server is fine; this project is not registered in the workspace you named). Report those as they are.

Reading the spec and analyzing the code are not an exception to it: `resolve`, the `list-*` readers and `single_element` delegate to the server exactly as `c4s ask` / `c4s agent` do. With the server down this skill cannot detect drift, let alone route it.

## Hard dependency & gotchas

- **The identity is baked in — never `cd`.** `--project 'agent-chat' --workspace 'default'` is injected into every
  command above; `cd`-ing into the spec repo is unnecessary and, if it's reached
  through a symlink, can even break resolution.
- **`c4s ask` is read-only** — it yields a plan only and never mutates the spec;
  execution is a separate, human-driven step.
- **Path 2 uses create-mode, not attach-mode.** Mint the brief via
  `c4s agent --ct brief` with no window flags. Don't pass `--brief <path>` —
  that's attach-mode, which expects a pre-existing brief.

## Notes

This is a **base skill** generated by claude4spec, delivered on demand via
`c4s install-skills` or the Settings page's "External Skills" ZIP download —
nothing regenerates it automatically once it lands in your project's
`.claude/skills/`. Edits you make here are yours to keep.
