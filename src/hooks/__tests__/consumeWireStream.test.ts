import { describe, expect, it } from 'vitest';
import { consumeWireStream, consumeWithResume } from '../useEventStream.js';
import { createInitialState, messageReducer } from '../useMessageReducer.js';
import type { WireEvent } from '../../server/protocol.js';

function sseResponse(frames: Array<[string, unknown]>): Response {
  const body = frames.map(([ev, data]) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  }));
}

const TS = '2026-04-28T00:00:00.000Z';
const turnStart = { userMessageId: 'u1', assistantMessageId: 'a1', prompt: 'hi', timestamp: TS };

describe('consumeWireStream', () => {
  it('forwards done to onEvent exactly once', async () => {
    const events: WireEvent[] = [];
    await consumeWireStream(
      sseResponse([['connected', { requestId: 'r', threadId: 't' }], ['turn_start', turnStart], ['done', {}]]),
      { onEvent: e => events.push(e) },
    );
    expect(events.map(e => e.type)).toEqual(['turn_start', 'done']);
  });

  it('reports connected through onConnected, not onEvent', async () => {
    const connected: string[] = [];
    const events: WireEvent[] = [];
    await consumeWireStream(
      sseResponse([['connected', { requestId: 'r', threadId: 't' }], ['done', {}]]),
      { onEvent: e => events.push(e), onConnected: (r, t) => connected.push(`${r}/${t}`) },
    );
    expect(connected).toEqual(['r/t']);
    expect(events.map(e => e.type)).toEqual(['done']);
  });

  it('delivers a synthetic done when the connection closes without one', async () => {
    const events: WireEvent[] = [];
    await consumeWireStream(
      sseResponse([['turn_start', turnStart], ['text_delta', { text: 'x', isSubagent: false }]]),
      { onEvent: e => events.push(e) },
    );
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('leaves the hook not streaming when the SSE connection closes without done', async () => {
    let state = messageReducer(createInitialState('claude-code', 'sonnet'), { type: 'USER_MESSAGE', text: 'hi' });
    await consumeWireStream(
      sseResponse([['turn_start', turnStart], ['text_delta', { text: 'x', isSubagent: false }]]),
      { onEvent: e => { state = messageReducer(state, { type: 'EVENT', event: e }); } },
    );
    expect(state.isStreaming).toBe(false);
  });

  it('delivers no synthetic done when the read is aborted', async () => {
    const events: WireEvent[] = [];
    const frame = `event: turn_start\ndata: ${JSON.stringify(turnStart)}\n\n`;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame));
        controller.error(new DOMException('aborted', 'AbortError'));
      },
    }));
    await expect(consumeWireStream(response, { onEvent: e => events.push(e) }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(events.some(e => e.type === 'done')).toBe(false);
  });
});

/** Frames with SSE `id:` lines; `drop` ends the body with a network error. */
function idResponse(frames: Array<[number, string, unknown]>, drop = false): Response {
  const body = frames.map(([id, ev, data]) => `id: ${id}\nevent: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  let sent = false;
  return new Response(new ReadableStream({
    // Error on the NEXT pull: an errored stream discards chunks not yet read.
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(body));
      } else if (drop) {
        controller.error(new TypeError('network error'));
      } else {
        controller.close();
      }
    },
  }));
}

const firstLeg = (): Response => idResponse([
  [1, 'connected', { requestId: 'r', threadId: 't' }],
  [2, 'turn_start', turnStart],
  [3, 'text_delta', { text: 'a', isSubagent: false }],
], true);

describe('consumeWithResume — a dropped connection', () => {
  it('rejoins with Last-Event-ID and delivers only the missed frames', async () => {
    const events: WireEvent[] = [];
    const rejoins: Array<[string, string | undefined]> = [];
    await consumeWithResume(firstLeg(), {
      signal: new AbortController().signal,
      handlers: { onEvent: e => events.push(e) },
      rejoin: async (threadId, lastEventId) => {
        rejoins.push([threadId, lastEventId]);
        return idResponse([[4, 'text_delta', { text: 'b', isSubagent: false }], [5, 'done', {}]]);
      },
      backoffMs: 0,
    });
    expect(rejoins).toEqual([['t', '3']]);
    expect(events.map(e => e.type)).toEqual(['turn_start', 'text_delta', 'text_delta', 'done']);
  });

  it('ends with a synthetic done and reports the thread when the stream is gone (404)', async () => {
    const events: WireEvent[] = [];
    const lost: string[] = [];
    await consumeWithResume(firstLeg(), {
      signal: new AbortController().signal,
      handlers: { onEvent: e => events.push(e) },
      rejoin: async () => new Response(null, { status: 404 }),
      onStreamLost: id => lost.push(id),
      backoffMs: 0,
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(lost).toEqual(['t']);
  });

  it('does not rejoin after an abort', async () => {
    const controller = new AbortController();
    controller.abort();
    let rejoined = false;
    await expect(consumeWithResume(firstLeg(), {
      signal: controller.signal,
      handlers: { onEvent: () => {} },
      rejoin: async () => { rejoined = true; return new Response(null, { status: 404 }); },
      backoffMs: 0,
    })).rejects.toThrow('network error');
    expect(rejoined).toBe(false);
  });

  it('rethrows the failure when nothing identified the stream yet', async () => {
    const response = idResponse([[1, 'turn_start', turnStart]], true);
    await expect(consumeWithResume(response, {
      signal: new AbortController().signal,
      handlers: { onEvent: () => {} },
      rejoin: async () => { throw new Error('must not rejoin'); },
      backoffMs: 0,
    })).rejects.toThrow('network error');
  });
});
