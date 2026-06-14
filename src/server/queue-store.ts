import type { QueuedMessage } from './protocol.js';

const DEFAULT_LIMIT = 20;

/**
 * In-memory per-thread message queue for the reference chat handler. A row
 * exists from enqueue until delivery (mid-turn push or after-turn merged
 * dispatch) or cancellation. Applications with durable storage (e.g. SQLite)
 * implement the same contract their own way — see the handler docs.
 */
export class QueueStore {
  private byThread = new Map<string, QueuedMessage[]>();
  private readonly limit: number;

  constructor(limit: number = DEFAULT_LIMIT) {
    this.limit = limit;
  }

  size(threadId: string): number {
    return this.byThread.get(threadId)?.length ?? 0;
  }

  isFull(threadId: string): boolean {
    return this.size(threadId) >= this.limit;
  }

  enqueue(threadId: string, text: string, createdAt: string): QueuedMessage {
    const msg: QueuedMessage = { id: crypto.randomUUID(), text, createdAt };
    const arr = this.byThread.get(threadId);
    if (arr) arr.push(msg);
    else this.byThread.set(threadId, [msg]);
    return msg;
  }

  /** Remove a single message by id. Returns it, or null if not found. */
  remove(threadId: string, id: string): QueuedMessage | null {
    const arr = this.byThread.get(threadId);
    if (!arr) return null;
    const idx = arr.findIndex(m => m.id === id);
    if (idx < 0) return null;
    const [removed] = arr.splice(idx, 1);
    if (arr.length === 0) this.byThread.delete(threadId);
    return removed;
  }

  /** Remove and return all queued messages for a thread (FIFO order). */
  popAll(threadId: string): QueuedMessage[] {
    const arr = this.byThread.get(threadId);
    if (!arr || arr.length === 0) return [];
    this.byThread.delete(threadId);
    return arr;
  }

  /** Alias for popAll — clears the queue and returns the removed messages. */
  clear(threadId: string): QueuedMessage[] {
    return this.popAll(threadId);
  }

  /** Non-destructive copy of a thread's current queue. */
  snapshot(threadId: string): QueuedMessage[] {
    return (this.byThread.get(threadId) ?? []).slice();
  }
}
