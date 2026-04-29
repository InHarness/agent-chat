/**
 * Minimal logger used by the library to surface non-fatal errors that would
 * otherwise be silently swallowed (network failures on background refreshes,
 * SSE parse errors, corrupt thread files, etc.).
 *
 * Defaults: dev → `console.warn`, prod → no-op. Pass `onError` from the
 * consumer config to forward to a custom sink (Sentry, Datadog, app state).
 */
export interface Logger {
  warn: (context: string, error?: unknown) => void;
}

export interface LoggerOptions {
  /**
   * Custom error sink. When provided, every log call is forwarded here and
   * the built-in console output is suppressed.
   */
  onError?: (error: unknown, context: string) => void;
}

function isProduction(): boolean {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

export function createLogger(opts?: LoggerOptions): Logger {
  if (opts?.onError) {
    const onError = opts.onError;
    return { warn: (context, error) => onError(error, context) };
  }
  if (isProduction()) {
    return { warn: () => {} };
  }
  return {
    warn: (context, error) => {
      console.warn(`[agent-chat] ${context}`, error);
    },
  };
}

export const defaultLogger: Logger = createLogger();
