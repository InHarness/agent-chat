import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAdapter } from '@inharness-ai/agent-adapters';
import { createChatHandler, type ChatHandler } from '../handler.js';
import type { ArchitectureConfig } from '../protocol.js';

// --- Controllable fake adapter --------------------------------------------
// One shared instance per test so we can inspect execute() params and drive
// pushMessage. `register('fake-arch')` is a non-capable architecture
// (architectureCapabilities → midTurnPush:false), exercising the after-turn path.

interface FakeEvent { type: string; [k: string]: unknown }

let executeCalls: Array<Record<string, unknown>> = [];
let turnScripts: FakeEvent[][] = [];
let gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];
let pushHandler: ((text: string) => boolean) | null = null;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

class FakeAdapter {
  architecture = 'fake-arch';
  pushMessage(text: string): boolean {
    return pushHandler ? pushHandler(text) : false;
  }
  abort(): void {}
  async *execute(params: Record<string, unknown>): AsyncGenerator<FakeEvent> {
    const turn = executeCalls.length;
    executeCalls.push(params);
    const gate = gates[turn];
    if (gate) await gate.promise;
    for (const ev of turnScripts[turn] ?? []) yield ev;
  }
}

registerAdapter('fake-arch', () => new FakeAdapter() as never);

const ARCHS: Record<string, ArchitectureConfig> = {
  'fake-arch': { models: ['fake-model'], default: 'fake-model', options: [] },
};

function resultEvent(sessionId: string, ctx = 10): FakeEvent {
  return { type: 'result', output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, contextSize: ctx, sessionId };
}

// --- Minimal Express-ish req/res ------------------------------------------

interface CapturedSSE { type: string; data: unknown }

function fakeRes() {
  const sse: CapturedSSE[] = [];
  let statusCode = 200;
  let jsonBody: unknown;
  const closeHandlers: Array<() => void> = [];
  const res = {
    writeHead() { return res; },
    write(chunk: string) {
      // Parse "event: X\n...\ndata: {json}\n\n"
      const evMatch = /event: (.+)/.exec(chunk);
      const dataMatch = /data: (.+)/.exec(chunk);
      if (evMatch && dataMatch) sse.push({ type: evMatch[1], data: JSON.parse(dataMatch[1]) });
      return true;
    },
    end() { return res; },
    on(event: string, cb: () => void) { if (event === 'close') closeHandlers.push(cb); return res; },
    status(code: number) { statusCode = code; return res; },
    json(body: unknown) { jsonBody = body; return res; },
    get statusCode() { return statusCode; },
    get jsonBody() { return jsonBody; },
    sse,
    closeHandlers,
  };
  return res;
}

const flush = () => new Promise(r => setTimeout(r, 0));

let dir: string;
let handler: ChatHandler;

beforeEach(() => {
  executeCalls = [];
  turnScripts = [];
  gates = [];
  pushHandler = null;
  dir = mkdtempSync(join(tmpdir(), 'agent-chat-queue-'));
  handler = createChatHandler({
    architectures: ARCHS,
    defaultArchitecture: 'fake-arch',
    systemPrompt: 'sys',
    threadsDir: dir,
  });
});

afterEach(() => {
  handler.destroy();
  rmSync(dir, { recursive: true, force: true });
});

async function startTurn(threadId: string, prompt: string) {
  const res = fakeRes();
  const req = { body: { threadId, prompt, architecture: 'fake-arch', model: 'fake-model' } } as never;
  const done = handler.handleChat(req, res as never);
  await flush(); // let the session register + execute reach its gate
  return { res, done };
}

function createThread(): string {
  const res = fakeRes();
  handler.handleCreateThread({ body: { architecture: 'fake-arch', model: 'fake-model' } } as never, res as never);
  return (res.jsonBody as { id: string }).id;
}

describe('queue endpoints', () => {
  it('rejects enqueue with 409 NO_ACTIVE_STREAM when the thread has no live turn', () => {
    const res = fakeRes();
    handler.handleQueueEnqueue({ params: { threadId: 'nope' }, body: { prompt: 'hi' } } as never, res as never);
    expect(res.statusCode).toBe(409);
    expect(res.jsonBody).toEqual({ error: 'NO_ACTIVE_STREAM' });
  });

  it('enqueues (202 + snapshot) and broadcasts queue_updated while a turn is live', async () => {
    const threadId = createThread();
    turnScripts = [[resultEvent('s1')]];
    gates = [deferred()];
    const { res: streamRes, done } = await startTurn(threadId, 'first');

    const enqRes = fakeRes();
    handler.handleQueueEnqueue({ params: { threadId }, body: { prompt: 'queued one' } } as never, enqRes as never);
    expect(enqRes.statusCode).toBe(202);
    expect((enqRes.jsonBody as { queued: Array<{ text: string }> }).queued.map(m => m.text)).toEqual(['queued one']);

    // Broadcast reached the live stream.
    const qUpdates = streamRes.sse.filter(e => e.type === 'queue_updated');
    expect(qUpdates.length).toBeGreaterThanOrEqual(1);

    gates[0].resolve();
    await done;
  });

  it('enforces QUEUE_FULL at the limit', async () => {
    const threadId = createThread();
    turnScripts = [[resultEvent('s1')]];
    gates = [deferred()];
    const { done } = await startTurn(threadId, 'first');

    // Default limit is 20.
    for (let i = 0; i < 20; i++) {
      const r = fakeRes();
      handler.handleQueueEnqueue({ params: { threadId }, body: { prompt: `m${i}` } } as never, r as never);
      expect(r.statusCode).toBe(202);
    }
    const full = fakeRes();
    handler.handleQueueEnqueue({ params: { threadId }, body: { prompt: 'overflow' } } as never, full as never);
    expect(full.statusCode).toBe(400);
    expect(full.jsonBody).toEqual({ error: 'QUEUE_FULL' });

    gates[0].resolve();
    await done;
  });

  it('cancel removes one; clear empties and returns texts', async () => {
    const threadId = createThread();
    // Two turns: the queued message will be dispatched after turn 1, so keep turn 2 scripted.
    turnScripts = [[resultEvent('s1')], [resultEvent('s2')]];
    gates = [deferred()];
    const { done } = await startTurn(threadId, 'first');

    const e1 = fakeRes();
    handler.handleQueueEnqueue({ params: { threadId }, body: { prompt: 'a' } } as never, e1 as never);
    const id0 = (e1.jsonBody as { queued: Array<{ id: string }> }).queued[0].id;
    const e2 = fakeRes();
    handler.handleQueueEnqueue({ params: { threadId }, body: { prompt: 'b' } } as never, e2 as never);

    const cancelRes = fakeRes();
    handler.handleQueueCancel({ params: { threadId, messageId: id0 } } as never, cancelRes as never);
    expect(cancelRes.statusCode).toBe(200);
    expect((cancelRes.jsonBody as { queued: Array<{ text: string }> }).queued.map(m => m.text)).toEqual(['b']);

    const clearRes = fakeRes();
    handler.handleQueueClear({ params: { threadId } } as never, clearRes as never);
    expect((clearRes.jsonBody as { clearedTexts: string[] }).clearedTexts).toEqual(['b']);

    gates[0].resolve();
    await done;
  });
});

describe('after-turn merged dispatch', () => {
  it('drains the queue into one merged turn that resumes the just-finished session', async () => {
    const threadId = createThread();
    turnScripts = [[resultEvent('s1')], [resultEvent('s2')]];
    gates = [deferred()]; // gate only the first turn

    const { res: streamRes, done } = await startTurn(threadId, 'first');

    // Enqueue two messages during the (gated) first turn. Fake arch isn't
    // mid-turn capable, so they stay queued.
    for (const text of ['second', 'third']) {
      const r = fakeRes();
      handler.handleQueueEnqueue({ params: { threadId }, body: { prompt: text } } as never, r as never);
    }

    gates[0].resolve();
    await done;

    // Two executes ran: the original, then the merged dispatch.
    expect(executeCalls).toHaveLength(2);
    expect(executeCalls[1].prompt).toBe('second\n\n---\n\nthird');
    expect(executeCalls[1].resumeSessionId).toBe('s1');

    // A second turn_start was broadcast for the merged turn.
    expect(streamRes.sse.filter(e => e.type === 'turn_start')).toHaveLength(2);

    // Persistence: user(first)·assistant·user(merged)·assistant, session = s2.
    const tRes = fakeRes();
    handler.handleGetThread({ params: { id: threadId } } as never, tRes as never);
    const stored = tRes.jsonBody as { messages: Array<{ role: string }>; sessionId: string };
    expect(stored.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(stored.sessionId).toBe('s2');
  });
});

describe('mid-turn push at enqueue', () => {
  it('removes the row when the live adapter accepts the push (capable arch)', async () => {
    // Register a capable architecture by reusing the claude-code capability via
    // a fake adapter under that name. architectureCapabilities('claude-code')
    // is midTurnPush:true.
    const pushed: string[] = [];
    pushHandler = (t) => { pushed.push(t); return true; };

    registerAdapter('claude-code', () => new FakeAdapter() as never);
    const capHandler = createChatHandler({
      architectures: { 'claude-code': { models: ['m'], default: 'm', options: [] } },
      defaultArchitecture: 'claude-code',
      systemPrompt: 'sys',
      threadsDir: dir,
    });
    try {
      const cRes = fakeRes();
      capHandler.handleCreateThread({ body: { architecture: 'claude-code', model: 'm' } } as never, cRes as never);
      const threadId = (cRes.jsonBody as { id: string }).id;

      turnScripts = [[resultEvent('s1')]];
      gates = [deferred()];
      const sRes = fakeRes();
      const done = capHandler.handleChat({ body: { threadId, prompt: 'first', architecture: 'claude-code', model: 'm' } } as never, sRes as never);
      await flush();

      const eRes = fakeRes();
      capHandler.handleQueueEnqueue({ params: { threadId }, body: { prompt: 'pushed msg' } } as never, eRes as never);
      // Pushed → row removed → snapshot empty.
      expect(pushed).toEqual(['pushed msg']);
      expect((eRes.jsonBody as { queued: unknown[] }).queued).toEqual([]);

      gates[0].resolve();
      await done;

      // No after-turn merged dispatch happened (only the original execute).
      expect(executeCalls).toHaveLength(1);
    } finally {
      capHandler.destroy();
    }
  });
});
