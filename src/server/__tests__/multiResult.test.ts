// Server side of the stream/turn/block contract: several `result` frames per
// turn, several turns per stream, exactly one `done` as the last frame, no
// turn after an `error`, and persisted `usage` summed over every `result`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAdapter } from '@inharness-ai/agent-adapters';
import { createChatHandler, type ChatHandler } from '../handler.js';
import { ThreadStore } from '../thread-store.js';
import type { ArchitectureConfig, StoredMessage, WireEvent } from '../protocol.js';
import { createInitialState, messageReducer } from '../../hooks/messageReducer.js';
import { storedMessageToChat, type ChatState } from '../../types.js';

interface FakeEvent { type: string; [k: string]: unknown }

let turnScripts: FakeEvent[][] = [];
let executeCalls: Array<Record<string, unknown>> = [];
let gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];
// Mid-turn pauses: a `{ type: '__hold', n }` script entry parks the adapter
// on `holds[n]` — the adapter holding the session between two `result`s.
let holds: Array<{ promise: Promise<void>; resolve: () => void }> = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

class HoldingAdapter {
  architecture = 'mr-arch';
  pushMessage(): boolean { return false; }
  abort(): void {}
  async *execute(params: Record<string, unknown>): AsyncGenerator<FakeEvent> {
    const turn = executeCalls.length;
    executeCalls.push(params);
    const gate = gates[turn];
    if (gate) await gate.promise;
    for (const ev of turnScripts[turn] ?? []) {
      if (ev.type === '__hold') { await holds[ev.n as number].promise; continue; }
      yield ev;
    }
  }
}

registerAdapter('mr-arch', () => new HoldingAdapter() as never);

const ARCHS: Record<string, ArchitectureConfig> = {
  'mr-arch': { models: ['m'], default: 'm', options: [] },
};

const text = (t: string): FakeEvent => ({ type: 'text_delta', text: t, isSubagent: false });
const result = (input: number, output: number, contextSize: number, sessionId?: string): FakeEvent => ({
  type: 'result',
  output: 'ok',
  usage: { inputTokens: input, outputTokens: output },
  contextSize,
  ...(sessionId ? { sessionId } : {}),
});

interface CapturedSSE { type: string; data: Record<string, unknown> }

function fakeRes() {
  const sse: CapturedSSE[] = [];
  let jsonBody: unknown;
  const res = {
    writeHead() { return res; },
    write(chunk: string) {
      const evMatch = /event: (.+)/.exec(chunk);
      const dataMatch = /data: (.+)/.exec(chunk);
      if (evMatch && dataMatch) sse.push({ type: evMatch[1], data: JSON.parse(dataMatch[1]) });
      return true;
    },
    end() { return res; },
    on() { return res; },
    status() { return res; },
    json(body: unknown) { jsonBody = body; return res; },
    get jsonBody() { return jsonBody; },
    sse,
  };
  return res;
}

const flush = () => new Promise(r => setTimeout(r, 0));

let dir: string;
let handler: ChatHandler;

beforeEach(() => {
  turnScripts = [];
  executeCalls = [];
  gates = [];
  holds = [];
  dir = mkdtempSync(join(tmpdir(), 'agent-chat-multiresult-'));
  handler = createChatHandler({
    architectures: ARCHS,
    defaultArchitecture: 'mr-arch',
    systemPrompt: 'sys',
    threadsDir: dir,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  handler.destroy();
  rmSync(dir, { recursive: true, force: true });
});

function createThread(): string {
  const res = fakeRes();
  handler.handleCreateThread({ body: { architecture: 'mr-arch', model: 'm' } } as never, res as never);
  return (res.jsonBody as { id: string }).id;
}

async function runStream(threadId: string, whileRunning?: () => void) {
  const res = fakeRes();
  const req = { body: { threadId, prompt: 'first', architecture: 'mr-arch', model: 'm' } } as never;
  const done = handler.handleChat(req, res as never);
  await flush();
  whileRunning?.();
  gates[0]?.resolve();
  await done;
  return res.sse;
}

function startStream(threadId: string, prompt = 'first') {
  const res = fakeRes();
  const req = { body: { threadId, prompt, architecture: 'mr-arch', model: 'm' } } as never;
  return { res, done: handler.handleChat(req, res as never) };
}

function enqueue(threadId: string, prompt: string) {
  handler.handleQueueEnqueue({ params: { threadId }, body: { prompt } } as never, fakeRes() as never);
}

function storedThread(threadId: string) {
  const res = fakeRes();
  handler.handleGetThread({ params: { id: threadId } } as never, res as never);
  return res.jsonBody as { messages: StoredMessage[]; sessionId?: string; queuedMessages?: unknown[] };
}

describe('stream / turn / block — server', () => {
  it('forwards more than one result frame in a single turn', async () => {
    const threadId = createThread();
    turnScripts = [[text('a'), result(10, 5, 15, 's1'), text('b'), result(20, 7, 27)]];
    const sse = await runStream(threadId);
    expect(sse.filter(e => e.type === 'result')).toHaveLength(2);
    expect(sse.filter(e => e.type === 'turn_start')).toHaveLength(1);
  });

  it('carries more than one turn_start on one stream when the queue drains after a turn', async () => {
    const threadId = createThread();
    turnScripts = [[result(1, 1, 2, 's1')], [result(1, 1, 3, 's2')]];
    gates = [deferred()];
    const sse = await runStream(threadId, () => enqueue(threadId, 'queued'));
    expect(sse.filter(e => e.type === 'turn_start')).toHaveLength(2);
  });

  it('emits exactly one done frame per stream', async () => {
    const threadId = createThread();
    turnScripts = [[result(1, 1, 2, 's1')], [result(1, 1, 3, 's2')]];
    gates = [deferred()];
    const sse = await runStream(threadId, () => enqueue(threadId, 'queued'));
    expect(sse.filter(e => e.type === 'done')).toHaveLength(1);
  });

  it('sends no frame after done — queue_updated comes before it', async () => {
    const threadId = createThread();
    turnScripts = [[text('a'), result(1, 1, 2, 's1'), { type: 'error', error: new Error('boom') }]];
    gates = [deferred()];
    const sse = await runStream(threadId, () => enqueue(threadId, 'queued'));
    expect(sse.at(-1)!.type).toBe('done');
    expect(sse.at(-2)!.type).toBe('queue_updated');
  });

  it('runs no further turn after an adapter error — the queued message is handed back', async () => {
    const threadId = createThread();
    turnScripts = [[text('a'), { type: 'error', error: new Error('boom') }], [result(1, 1, 2, 's2')]];
    gates = [deferred()];
    const sse = await runStream(threadId, () => enqueue(threadId, 'queued'));
    const errorIdx = sse.findIndex(e => e.type === 'error');
    expect(errorIdx).toBeGreaterThan(-1);
    expect(sse.slice(errorIdx).some(e => e.type === 'turn_start')).toBe(false);
    expect(executeCalls).toHaveLength(1);
    // Nothing would deliver it, and the next POST would run it after its own
    // prompt — so it goes back to the composer, like on Stop.
    expect(sse.slice(errorIdx + 1).map(e => e.type)).toEqual(['queue_cleared', 'queue_updated', 'done']);
    expect(sse[errorIdx + 1].data.texts).toEqual(['queued']);
    expect(sse.at(-2)!.data.queued).toEqual([]);
    expect(storedThread(threadId).queuedMessages ?? []).toEqual([]);
  });

  it('persists an assistant message usage as the sum of its result frames', async () => {
    const threadId = createThread();
    turnScripts = [[text('a'), result(10, 5, 15, 's1'), text('b'), result(20, 7, 27)]];
    await runStream(threadId);
    const assistant = storedThread(threadId).messages.find(m => m.role === 'assistant')!;
    expect(assistant.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
  });

  it('persists the contextSize of the last result frame', async () => {
    const threadId = createThread();
    turnScripts = [[text('a'), result(10, 5, 15, 's1'), text('b'), result(20, 7, 27)]];
    await runStream(threadId);
    const assistant = storedThread(threadId).messages.find(m => m.role === 'assistant')!;
    expect(assistant.contextSize).toBe(27);
  });

  it('keeps the last sessionId when a later result carries none', async () => {
    const threadId = createThread();
    turnScripts = [[result(1, 1, 2, 's1'), result(1, 1, 3)]];
    await runStream(threadId);
    expect(storedThread(threadId).sessionId).toBe('s1');
  });

  it('a reloaded thread reports the usage the hook held at done', async () => {
    const threadId = createThread();
    turnScripts = [
      [text('a'), result(10, 5, 15, 's1'), text('b'), result(20, 7, 27)],
      [text('c'), result(3, 4, 34, 's2')],
    ];
    gates = [deferred()];
    const sse = await runStream(threadId, () => enqueue(threadId, 'queued'));

    let live: ChatState = messageReducer(createInitialState('mr-arch', 'm'), { type: 'USER_MESSAGE', text: 'first' });
    for (const frame of sse) {
      if (frame.type === 'connected') continue;
      live = messageReducer(live, { type: 'EVENT', event: { type: frame.type, ...frame.data } as WireEvent });
    }
    expect(live.isStreaming).toBe(false);

    const stored = storedThread(threadId);
    const reloaded = messageReducer(createInitialState('mr-arch', 'm'), {
      type: 'RESTORE',
      messages: stored.messages.map(storedMessageToChat),
      architecture: 'mr-arch',
      model: 'm',
    });
    expect(reloaded.usage).toEqual(live.usage);
    expect(reloaded.usage).toEqual({ inputTokens: 33, outputTokens: 16 });
  });
});

describe('stream lock, error and setup paths — server', () => {
  it('rejects a second POST with 409 while the adapter holds the session after a result', async () => {
    const threadId = createThread();
    holds = [deferred()];
    turnScripts = [[text('a'), result(1, 1, 2, 's1'), { type: '__hold', n: 0 }, text('b'), result(1, 1, 3)]];
    const first = startStream(threadId);
    await flush();
    expect(first.res.sse.some(e => e.type === 'result')).toBe(true);

    const second = startStream(threadId, 'again');
    await second.done;
    expect((second.res.jsonBody as { error: string }).error).toBe('STREAM_IN_PROGRESS');

    holds[0].resolve();
    await first.done;
    expect(first.res.sse.at(-1)!.type).toBe('done');
  });

  it('releases the thread on abort — the aborted stream cannot leak frames or start a queued turn', async () => {
    const threadId = createThread();
    holds = [deferred()];
    turnScripts = [
      [text('a'), { type: '__hold', n: 0 }, text('late'), result(1, 1, 2, 's1')],
      [text('new'), result(1, 1, 3, 's2')],
    ];
    const first = startStream(threadId);
    await flush();
    const requestId = first.res.sse.find(e => e.type === 'connected')!.data.requestId as string;

    const abortRes = fakeRes();
    handler.handleAbort({ body: { requestId } } as never, abortRes as never);
    expect(abortRes.jsonBody).toMatchObject({ ok: true });

    // Stop released the stream: nothing more can be queued onto it.
    const enqueueRes = fakeRes();
    handler.handleQueueEnqueue({ params: { threadId }, body: { prompt: 'after stop' } } as never, enqueueRes as never);
    expect((enqueueRes.jsonBody as { error: string }).error).toBe('NO_ACTIVE_STREAM');

    // The user's next message starts a new stream at once.
    const second = startStream(threadId, 'again');
    await flush();
    expect(second.res.jsonBody).toBeUndefined();

    // The aborted adapter unwinds only now; its frames reach neither stream.
    holds[0].resolve();
    await Promise.all([first.done, second.done]);
    const secondTexts = second.res.sse.filter(e => e.type === 'text_delta').map(e => e.data.text);
    expect(secondTexts).toEqual(['new']);
    expect(second.res.sse.filter(e => e.type === 'done')).toHaveLength(1);
    expect(second.res.sse.at(-1)!.type).toBe('done');
    expect(first.res.sse.some(e => e.type === 'text_delta' && e.data.text === 'late')).toBe(false);
    expect(executeCalls).toHaveLength(2);
  });

  it('forwards nothing the adapter emits after its error, but still reads it for the sessionId', async () => {
    const threadId = createThread();
    // codex-style: a non-fatal runtime error item, then the turn carries on.
    turnScripts = [[text('a'), { type: 'error', error: new Error('boom') }, text('late'), result(1, 1, 2, 's1')]];
    const sse = await runStream(threadId);
    const errorIdx = sse.findIndex(e => e.type === 'error');
    expect(sse.slice(errorIdx + 1).map(e => e.type)).toEqual(['queue_updated', 'done']);

    const stored = storedThread(threadId);
    expect(stored.sessionId).toBe('s1');
    // Content and usage the client never saw are not persisted.
    const assistant = stored.messages.find(m => m.role === 'assistant')!;
    expect(JSON.stringify(assistant.blocks)).not.toContain('late');
    expect(assistant.usage).toBeUndefined();
  });

  it('ends the stream with error + done when setup throws after the headers are sent', async () => {
    const threadId = createThread();
    vi.spyOn(ThreadStore.prototype, 'get').mockImplementation(() => { throw new Error('disk gone'); });
    turnScripts = [[result(1, 1, 2, 's1')]];
    const sse = await runStream(threadId);
    expect(sse.map(e => e.type)).toEqual(['connected', 'turn_start', 'error', 'queue_updated', 'done']);
    expect(executeCalls).toHaveLength(0);

    vi.restoreAllMocks();
    const next = startStream(threadId, 'again');
    await next.done;
    expect(next.res.jsonBody).toBeUndefined();
  });

  it('replays several turn_start and result frames to a rejoining client and ends it with done', async () => {
    const threadId = createThread();
    holds = [deferred()];
    turnScripts = [
      [text('a'), result(1, 1, 2, 's1'), { type: '__hold', n: 0 }, text('b'), result(1, 1, 3)],
      [text('c'), result(1, 1, 4, 's2')],
    ];
    const first = startStream(threadId);
    await flush();
    enqueue(threadId, 'queued');

    const joiner = fakeRes();
    let ended = false;
    const origEnd = joiner.end;
    joiner.end = () => { ended = true; return origEnd(); };
    handler.handleStream({ params: { threadId }, header: () => undefined } as never, joiner as never);

    holds[0].resolve();
    await first.done;

    const types = joiner.sse.map(e => e.type);
    expect(types.filter(t => t === 'turn_start')).toHaveLength(2);
    expect(types.filter(t => t === 'result')).toHaveLength(3);
    expect(types.filter(t => t === 'done')).toHaveLength(1);
    expect(types.at(-1)).toBe('done');
    expect(ended).toBe(true);
    expect(joiner.sse).toEqual(first.res.sse);
  });
});
