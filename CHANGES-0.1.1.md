# Changes for hook-only consumers — `contextSize` rollout

Scope: integrators that build their own UI on top of `useAgentChat` /
`useMessageReducer` (i.e. nie używają gotowego `<AgentChat />` ani
`<UsageDisplay />`). Niżej tylko to, co dotyka publicznego API hooków,
typów i wire-protocol.

Backing requirement: `@inharness-ai/agent-adapters` rozdzielił dwie
metryki na evencie `result`:

| Metric                  | Field                | Use for                                    | Aggregation across turns |
|-------------------------|----------------------|--------------------------------------------|--------------------------|
| USAGE BILLING TOKENS    | `result.usage`       | cost / billing alarms                      | **sum**                  |
| USAGE CONTEXT WINDOW    | `result.contextSize` | "X / 200k" utilization bar                 | **take last turn only**  |

`agent-chat` od tej wersji propaguje obie end-to-end. Stare podejście
(sumowanie billing-tokens i traktowanie ich jako context window)
produkowało wartości >100% po kilku turach — to znika.

---

## What changed in hook surface

### `useAgentChat`

Nowe pole w return value:

```ts
const chat = useAgentChat({ serverUrl });

chat.contextSize    // number | null  ← NOWE — last turn's contextSize
chat.usage          // UsageStats | null  ← bez zmian (cumulative billing)
chat.contextWindow  // number | undefined ← bez zmian (cap z server config)
```

`contextSize` jest **nadpisywane** na każdym `result`-evencie (last-turn
value). NIE sumuj go po stronie konsumenta — sumowanie jest przeznaczone
dla `usage`.

### `useMessageReducer`

`ChatState` ma nowe pole:

```ts
interface ChatState {
  // ...istniejące
  usage: UsageStats | null;
  contextSize: number | null;   // ← NOWE
}
```

`createInitialState()` zwraca `contextSize: null`. Reducer ustawia je
na każdym `result` z `event.contextSize` (overwrite). `RESTORE` bierze
wartość z OSTATNIEJ assistant-msg w listzie restorowanych wiadomości
(z fallbackiem dla wątków persisted przed tym polem — patrz niżej).

### `ChatMessage`

```ts
interface ChatMessage {
  // ...istniejące
  usage?: UsageStats;
  contextSize?: number;   // ← NOWE — post-turn context window utilization
}
```

`storedMessageToChat()` (helper publiczny używany do hydratacji wątków
po `GET /api/threads/:id`) sam wypełnia `contextSize` — z persisted
pola jeśli istnieje, inaczej oblicza `usage.inputTokens + outputTokens`
jako fallback dla starych wątków. Konsumenci nie muszą tego robić ręcznie.

---

## Wire protocol change

`WireEvent` w gałęzi `result`:

```ts
// PRZED
{ type: 'result'; output: string; usage: WireUsageStats; sessionId?: string }

// TERAZ
{ type: 'result'; output: string; usage: WireUsageStats; contextSize: number; sessionId?: string }
```

`StoredMessage` (z `GET /api/threads/:id`):

```ts
interface StoredMessage {
  // ...istniejące
  usage?: WireUsageStats;
  contextSize?: number;   // ← NOWE — opcjonalne (backward-compat)
}
```

Konsekwencje dla custom serwerów / proxy:
- Każdy adapter z `agent-adapters` już emituje `contextSize` na `result`.
  Wymaga **przebudowy `agent-adapters/dist`** jeżeli linkujesz lokalnie
  starszą wersję — typ `result` w dist musi mieć to pole, inaczej
  `tsc` walnie w handlerze.
- Pole jest WYMAGANE na wire, więc jeżeli masz własny event-pipeline
  zawijający `WireEvent` — musisz dorzucić `contextSize` na każdym
  syntetycznym/proxy-owanym evencie typu `result`.

---

## Migracja UI w consumer-side renderze

Wcześniej (źle — wartości >100% po paru turach):

```tsx
const { usage, contextWindow } = useAgentChat({ serverUrl });
const total = usage.inputTokens + usage.outputTokens
            + (usage.cacheReadInputTokens ?? 0)
            + (usage.cacheCreationInputTokens ?? 0);
const pct = (total / contextWindow) * 100;
```

Teraz (poprawnie):

```tsx
const { contextSize, contextWindow } = useAgentChat({ serverUrl });
if (contextSize === null || !contextWindow) return null;
const pct = Math.min(100, (contextSize / contextWindow) * 100);
return <Bar value={pct} label={`${contextSize} / ${contextWindow}`} />;
```

Helper publiczny dostępny z paczki:

```ts
import { contextSizeOf } from '@inharness-ai/agent-chat';
// contextSizeOf(usage) === usage.inputTokens + usage.outputTokens
// (mirror `contextSize()` z agent-adapters; przydaje się gdy masz tylko
// surowy `UsageStats` z subagenta lub historycznej assistant-msg)
```

---

## Co się NIE zmieniło

- `state.usage` — dalej cumulative billing przez wszystkie tury (po to
  jest `addUsage` / `sumUsage` z `core/usage.ts`). Można dalej liczyć
  z niego koszt / wyświetlać sumę in/out tokenów.
- `useEventStream`, `useThreads` — sygnatury bez zmian.
- `WireEvent.result.usage` — semantyka niezmieniona (per-call billing
  delta, pochodzi 1:1 z adaptera).
- `MODEL_CONTEXT_WINDOWS` / `getModelContextWindow` — wystawiane przez
  serwer w `ServerConfig.architectures[arch].contextWindows[model]`,
  bez zmian.
- `subagent.usage` na `UIContentBlock { type: 'subagent' }` — bez zmian
  semantycznie. Gdy renderujesz pasek subagenta, użyj
  `contextSizeOf(subagent.usage)` zamiast doliczać cache-fields osobno
  (to był bug w starym `totalContextTokens`).

---

## Testy

Jeśli masz własne testy reducera z fixturami `result`-eventów, dopisz
`contextSize: <number>` do każdego `result`. Stare fixtury bez tego
pola nie skompilują się pod nową definicją `WireEvent`. Wzorzec:

```ts
{ type: 'result', output: 'done',
  usage: { inputTokens: 10, outputTokens: 20 },
  contextSize: 30 }   // == inputTokens + outputTokens
```

Niezmiennik do walidacji w testach: po DWÓCH turach z `contextSize: 30`
i `contextSize: 105` odpowiednio, `state.contextSize === 105` (NIE 135).
`state.usage` dalej kumuluje normalnie.
