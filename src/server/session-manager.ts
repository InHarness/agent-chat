interface ActiveRequest {
  adapter: { abort(): void };
  requestId: string;
  architecture: string;
  sessionId?: string;
  createdAt: number;
}

export class SessionManager {
  private activeRequests = new Map<string, ActiveRequest>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private maxAgeMs: number;

  constructor(maxAgeMs = 30 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs;
    this.cleanupInterval = setInterval(() => this.sweep(), 60_000);
  }

  register(requestId: string, adapter: { abort(): void }, architecture: string): void {
    this.activeRequests.set(requestId, {
      adapter,
      requestId,
      architecture,
      createdAt: Date.now(),
    });
  }

  setSessionId(requestId: string, sessionId: string): void {
    const req = this.activeRequests.get(requestId);
    if (req) req.sessionId = sessionId;
  }

  abort(requestId: string): boolean {
    const req = this.activeRequests.get(requestId);
    if (!req) return false;
    req.adapter.abort();
    this.activeRequests.delete(requestId);
    return true;
  }

  remove(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  get size(): number {
    return this.activeRequests.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, req] of this.activeRequests) {
      if (now - req.createdAt > this.maxAgeMs) {
        req.adapter.abort();
        this.activeRequests.delete(id);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const [id, req] of this.activeRequests) {
      req.adapter.abort();
    }
    this.activeRequests.clear();
  }
}
