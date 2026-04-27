export interface BufferedEvent {
  id: number;
  type: string;
  data: unknown;
}

export type SessionListener = (event: BufferedEvent) => void;

export interface ActiveSession {
  threadId: string;
  requestId: string;
  adapter: { abort(): void };
  architecture: string;
  sessionId?: string;
  createdAt: number;
  /**
   * Rolling buffer of events broadcast on this thread. Capped by `maxBufferSize`
   * — oldest events are dropped when full. Used to replay to clients that join
   * via `handleStream` after the stream has already begun.
   */
  replayBuffer: BufferedEvent[];
  listeners: Set<SessionListener>;
  /** Last event id broadcast; used to assign monotonically increasing ids. */
  lastEventId: number;
  /** Removal grace timer — stays alive briefly after `remove()` so late joiners still get `done`. */
  removalTimer?: ReturnType<typeof setTimeout>;
}

export interface SessionSubscription {
  replay: BufferedEvent[];
  unsubscribe: () => void;
  /** Reference to the live session — consumers watch `listeners` membership or
   * call `unsubscribe()` when their response closes. */
  session: ActiveSession;
}

interface SessionManagerOptions {
  maxAgeMs?: number;
  maxBufferSize?: number;
  /** Grace window after `remove()` during which late joiners can still replay. */
  removalGraceMs?: number;
}

export class SessionManager {
  private byThread = new Map<string, ActiveSession>();
  private byRequest = new Map<string, string>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private maxAgeMs: number;
  private maxBufferSize: number;
  private removalGraceMs: number;

  constructor(opts: SessionManagerOptions = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? 30 * 60 * 1000;
    this.maxBufferSize = opts.maxBufferSize ?? 500;
    this.removalGraceMs = opts.removalGraceMs ?? 2000;
    this.cleanupInterval = setInterval(() => this.sweep(), 60_000);
  }

  /**
   * Register a fresh session for a thread. Returns null if the thread already
   * has an active (non-removed) session — caller should respond with 409.
   */
  register(
    threadId: string,
    requestId: string,
    adapter: { abort(): void },
    architecture: string,
  ): ActiveSession | null {
    const existing = this.byThread.get(threadId);
    if (existing && !existing.removalTimer) return null;
    // If a stale entry exists (inside grace window), flush it now so the new
    // session gets a clean buffer.
    if (existing?.removalTimer) {
      clearTimeout(existing.removalTimer);
      this.byThread.delete(threadId);
      this.byRequest.delete(existing.requestId);
    }
    const session: ActiveSession = {
      threadId,
      requestId,
      adapter,
      architecture,
      createdAt: Date.now(),
      replayBuffer: [],
      listeners: new Set(),
      lastEventId: 0,
    };
    this.byThread.set(threadId, session);
    this.byRequest.set(requestId, threadId);
    return session;
  }

  /**
   * Get the live session for a thread, if any. Sessions inside the removal
   * grace window are still returned — late joiners can replay them.
   */
  getByThread(threadId: string): ActiveSession | null {
    return this.byThread.get(threadId) ?? null;
  }

  setSessionId(requestId: string, sessionId: string): void {
    const threadId = this.byRequest.get(requestId);
    if (!threadId) return;
    const session = this.byThread.get(threadId);
    if (session) session.sessionId = sessionId;
  }

  /** Push an event to all listeners and store it in the replay buffer. */
  broadcast(threadId: string, type: string, data: unknown): BufferedEvent | null {
    const session = this.byThread.get(threadId);
    if (!session) return null;
    const event: BufferedEvent = { id: ++session.lastEventId, type, data };
    session.replayBuffer.push(event);
    if (session.replayBuffer.length > this.maxBufferSize) {
      session.replayBuffer.splice(0, session.replayBuffer.length - this.maxBufferSize);
    }
    for (const listener of session.listeners) {
      try {
        listener(event);
      } catch {
        // ignore — broken listeners shouldn't break the broadcast
      }
    }
    return event;
  }

  /**
   * Attach a listener to a thread's live stream. Returns the replay buffer
   * (optionally filtered by `fromEventId`) and an unsubscribe handle. Returns
   * null when no active session exists for the thread.
   */
  subscribe(threadId: string, fromEventId?: number): SessionSubscription | null {
    const session = this.byThread.get(threadId);
    if (!session) return null;
    const replay = typeof fromEventId === 'number'
      ? session.replayBuffer.filter(e => e.id > fromEventId)
      : session.replayBuffer.slice();
    const listener: SessionListener = () => {};
    // We'll fill in the listener after the caller constructs theirs — subscribe
    // is intentionally split so callers can attach a real listener via `on`.
    return { replay, unsubscribe: () => session.listeners.delete(listener), session };
  }

  /** Attach an arbitrary listener; returns unsubscribe. */
  on(threadId: string, listener: SessionListener): (() => void) | null {
    const session = this.byThread.get(threadId);
    if (!session) return null;
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }

  abort(requestId: string): boolean {
    const threadId = this.byRequest.get(requestId);
    if (!threadId) return false;
    const session = this.byThread.get(threadId);
    if (!session) return false;
    session.adapter.abort();
    this.remove(requestId);
    return true;
  }

  /**
   * Mark the session as finished. The entry lingers for `removalGraceMs` so
   * late joiners can still receive the trailing `done` event.
   */
  remove(requestId: string): void {
    const threadId = this.byRequest.get(requestId);
    if (!threadId) return;
    const session = this.byThread.get(threadId);
    if (!session) return;
    if (session.removalTimer) return;
    session.removalTimer = setTimeout(() => {
      this.byThread.delete(threadId);
      this.byRequest.delete(requestId);
      session.listeners.clear();
    }, this.removalGraceMs);
  }

  get size(): number {
    return this.byThread.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [threadId, session] of this.byThread) {
      if (session.removalTimer) continue;
      if (now - session.createdAt > this.maxAgeMs) {
        try {
          session.adapter.abort();
        } catch {
          // ignore
        }
        this.byThread.delete(threadId);
        this.byRequest.delete(session.requestId);
        session.listeners.clear();
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const session of this.byThread.values()) {
      if (session.removalTimer) clearTimeout(session.removalTimer);
      try {
        session.adapter.abort();
      } catch {
        // ignore
      }
      session.listeners.clear();
    }
    this.byThread.clear();
    this.byRequest.clear();
  }
}
