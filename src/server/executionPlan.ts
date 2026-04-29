import type { StoredThread, StoredMessage } from './protocol.js';
import { modelChangeRequiresReplay } from './architectureCapabilities.js';
import { buildHistoryPrompt } from './historyBuilder.js';

/**
 * Recognise adapter errors that indicate a failed resume — i.e. the adapter
 * could not find the prior session it was asked to continue.
 *
 * Observed strings (extend as new adapters surface their own variants):
 * - codex: `thread/resume: thread/resume failed: no rollout found for thread id ...`
 * - generic: `session not found`, `resume failed`, `no such session`
 *
 * When this matches, the safe response is to discard the stored sessionId,
 * fold the transcript into the prompt via buildHistoryPrompt, and retry once
 * with resumeSessionId=undefined.
 */
export function isResumeFailureError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no rollout found|thread\/resume failed|session not found|resume failed|no such session/i.test(msg);
}

/**
 * Build the prompt to use after a failed resume — folds the stored transcript
 * (if any) in front of the new user prompt.
 */
export function buildReplayPromptForFallback(
  messages: StoredMessage[],
  newUserPrompt: string,
): string {
  if (messages.length === 0) return newUserPrompt;
  return buildHistoryPrompt(messages, { newUserPrompt });
}

export interface ExecutionPlan {
  /**
   * `resumeSessionId` to pass to `adapter.execute(...)`. `undefined` when the
   * existing session is incompatible with the requested architecture/model and
   * we must start fresh.
   */
  resumeSessionId: string | undefined;
  /**
   * Prompt to send. Equal to `prompt` in the steady state; when replay is
   * required, the prior transcript is folded in as preamble.
   */
  prompt: string;
  archChanged: boolean;
  modelChanged: boolean;
  requiresHistoryReplay: boolean;
}

export interface ResolveExecutionPlanArgs {
  existingThread: StoredThread | null;
  requestedArchitecture: string;
  requestedModel: string;
  /** `chatReq.sessionId` from the request body — wins over the thread's stored sessionId when present. */
  requestedSessionId: string | undefined;
  /** Original `chatReq.prompt`. */
  prompt: string;
}

/**
 * Decide whether a chat turn can resume the existing adapter session, and what
 * prompt to send. Pulled out of `handleChat` so it can be unit-tested.
 */
export function resolveExecutionPlan(args: ResolveExecutionPlanArgs): ExecutionPlan {
  const { existingThread, requestedArchitecture, requestedModel, requestedSessionId, prompt } = args;
  const sessionId = requestedSessionId ?? existingThread?.sessionId;

  const archChanged = !!existingThread && existingThread.architecture !== requestedArchitecture;
  const modelChanged = !!existingThread && existingThread.model !== requestedModel;
  const requiresHistoryReplay =
    archChanged || (modelChanged && modelChangeRequiresReplay(requestedArchitecture));

  const resumeSessionId = requiresHistoryReplay ? undefined : sessionId;

  const wrappedPrompt =
    requiresHistoryReplay && existingThread && existingThread.messages.length > 0
      ? buildHistoryPrompt(existingThread.messages, { newUserPrompt: prompt })
      : prompt;

  return {
    resumeSessionId,
    prompt: wrappedPrompt,
    archChanged,
    modelChanged,
    requiresHistoryReplay,
  };
}
