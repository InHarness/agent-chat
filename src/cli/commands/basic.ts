import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createConsoleObserver, dispatchEvent } from '@inharness-ai/agent-adapters';
import { createChatHandler } from '../../server/index.js';

const HELP = `Usage: agent-chat basic [options]

Options:
  --port <number>          Port to listen on (default: 3001 or $PORT)
  --threads-dir <path>     Directory to store threads (default: ./threads)
  --no-open                Do not open the browser automatically
  --quiet                  Disable the per-event terminal log (consoleObserver)
  -h, --help               Show this help

Reads .env from the current directory if present (Node 20.6+).
`;

interface BasicOptions {
  port: number;
  threadsDir: string;
  open: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): BasicOptions {
  let port = Number(process.env.PORT ?? 3001);
  let threadsDir = resolve(process.cwd(), 'threads');
  let open = true;
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === '--port') {
      const next = argv[++i];
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--port expects a positive number, got: ${next}`);
      }
      port = parsed;
    } else if (arg === '--threads-dir') {
      const next = argv[++i];
      if (!next) throw new Error('--threads-dir expects a path');
      threadsDir = resolve(process.cwd(), next);
    } else if (arg === '--no-open') {
      open = false;
    } else if (arg === '--quiet') {
      quiet = true;
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${HELP}`);
    }
  }

  return { port, threadsDir, open, quiet };
}

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loadEnvFile !== 'function') {
    process.stderr.write(
      `note: .env found but Node ${process.version} lacks process.loadEnvFile (need 20.6+). Skipping.\n`,
    );
    return;
  }
  try {
    loadEnvFile(envPath);
  } catch (err) {
    process.stderr.write(`note: failed to load .env: ${err instanceof Error ? err.message : err}\n`);
  }
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // best-effort; user can click the printed URL
  }
}

export async function runBasic(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  loadDotEnv();

  const observer = opts.quiet
    ? null
    : createConsoleObserver({
        compactAdapterReady: true,
        sdkConfigExclude: ['*.apiKey', '*.token', '*.credentials'],
      });

  const handler = createChatHandler({
    systemPrompt: 'You are a helpful assistant.',
    threadsDir: opts.threadsDir,
    onEvent: observer ? (event) => dispatchEvent(event, [observer]) : undefined,
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/chat', handler.handleChat);
  app.post('/api/chat/abort', handler.handleAbort);
  app.post('/api/chat/user-input', handler.handleUserInput);
  app.get('/api/chat/stream/:threadId', handler.handleStream);
  app.get('/api/config', handler.handleConfig);

  app.get('/api/threads', handler.handleListThreads);
  app.post('/api/threads', handler.handleCreateThread);
  app.get('/api/threads/:id', handler.handleGetThread);
  app.delete('/api/threads/:id', handler.handleDeleteThread);
  app.patch('/api/threads/:id', handler.handleUpdateThread);

  const here = dirname(fileURLToPath(import.meta.url));
  const webDir = resolve(here, 'web');
  const indexHtml = resolve(webDir, 'index.html');

  if (!existsSync(indexHtml)) {
    throw new Error(
      `UI bundle not found at ${webDir}. The package may be installed without its built assets.`,
    );
  }

  app.use(express.static(webDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });

  const url = `http://localhost:${opts.port}`;
  app.listen(opts.port, () => {
    process.stdout.write(`\nagent-chat basic\n`);
    process.stdout.write(`  ${url}\n`);
    process.stdout.write(`  threads: ${opts.threadsDir}\n\n`);
    if (opts.open) openBrowser(url);
  });
}
