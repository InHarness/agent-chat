import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { StoredThread, ThreadMeta, StoredMessage } from './protocol.js';

export class ThreadStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  list(): ThreadMeta[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const threads: ThreadMeta[] = [];

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(this.dir, file), 'utf-8')) as StoredThread;
        threads.push({
          id: data.id,
          title: data.title,
          architecture: data.architecture,
          model: data.model,
          ...(data.cwd && { cwd: data.cwd }),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): StoredThread | null {
    const path = this.filePath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as StoredThread;
    } catch {
      return null;
    }
  }

  create(id: string, title: string, architecture: string, model: string, opts?: { cwd?: string; systemPrompt?: string; maxTurns?: number; architectureConfig?: Record<string, unknown>; planMode?: boolean }): StoredThread {
    const now = new Date().toISOString();
    const thread: StoredThread = {
      id,
      title,
      architecture,
      model,
      ...(opts?.cwd && { cwd: opts.cwd }),
      ...(opts?.systemPrompt && { systemPrompt: opts.systemPrompt }),
      ...(opts?.maxTurns && { maxTurns: opts.maxTurns }),
      ...(opts?.architectureConfig && Object.keys(opts.architectureConfig).length > 0 && { architectureConfig: opts.architectureConfig }),
      ...(opts?.planMode !== undefined && { planMode: opts.planMode }),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    writeFileSync(this.filePath(id), JSON.stringify(thread, null, 2));
    return thread;
  }

  update(id: string, updates: Partial<Pick<StoredThread, 'title' | 'sessionId' | 'messages' | 'architecture' | 'model' | 'systemPrompt' | 'maxTurns' | 'architectureConfig' | 'planMode'>>): StoredThread | null {
    const thread = this.get(id);
    if (!thread) return null;

    const updated: StoredThread = {
      ...thread,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(this.filePath(id), JSON.stringify(updated, null, 2));
    return updated;
  }

  appendMessages(id: string, messages: StoredMessage[], sessionId?: string): StoredThread | null {
    const thread = this.get(id);
    if (!thread) return null;

    const updated: StoredThread = {
      ...thread,
      messages: [...thread.messages, ...messages],
      sessionId: sessionId ?? thread.sessionId,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(this.filePath(id), JSON.stringify(updated, null, 2));
    return updated;
  }

  delete(id: string): boolean {
    const path = this.filePath(id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  private filePath(id: string): string {
    // Sanitize id to prevent path traversal
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(this.dir, `${safe}.json`);
  }
}
