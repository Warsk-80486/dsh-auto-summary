/**
 * Test doubles for the host services the plugin reads.
 *
 * The doubles implement only the narrow surfaces used by the plugin, so the
 * tests stay independent of a running DeepSeek Harness process while still
 * exercising the real `apply()` wiring end to end.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, Message, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'

/** One recorded log line. */
export interface LogLine {
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

/** Knobs for one fake host instance. */
export interface FakeHostOptions {
  /** Cumulative `tokenUsage` totals the session reports. */
  totals?: {
    uncachedInputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  /** First prompt retained by the `titleInput` projection; omit for none. */
  firstPrompt?: string
  /** Provider/model the session's latest request header reports. */
  route?: { provider: string; model: string }
  /** Visible history returned by `session.deriveMessages()`. */
  messages?: Message[]
  /** Text the fake summary call streams. */
  summaryText?: string
  /** Session id reported for a started activation. */
  childId?: string
  /** When set, the summary stream waits for this promise before finishing. */
  blockSummary?: Promise<void>
  /** When set, the summary stream throws instead of finishing. */
  summaryError?: unknown
  /** Whether the parent agent is live; `false` simulates a disposed agent. */
  liveParent?: boolean
  /** Durable session origin marker. */
  origin?: 'subagent'
  /** Durable delegation depth. */
  delegationDepth?: number
  /** Override the configuration handed to `apply()`; defaults to {@link buildTestConfig}. */
  config?: unknown
}

/** The fake host exposed to one test. */
export interface FakeHost {
  /** Context object cast to the Cordis shape the plugin accepts. */
  ctx: Context
  /** Every recorded log line, in order. */
  logs: LogLine[]
  /** Every LLM request the plugin made. */
  llmCalls: GenerateOptions[]
  /** Every subagent activation the plugin requested. */
  activations: SubagentActivationSpec[]
  /** The fake session object the plugin observed. */
  session: Session
  /** Deliver one `session/event` to the plugin's listeners. */
  emit: (session: Session, event: SessionEvent) => void
  /** Accept the fake summary stream again after a block. */
  unblock: () => void
}

/** Build one user-role message. */
export function userMessage(id: string, text: string, kind: 'user' | 'injected' = 'user'): Message {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: kind === 'user' ? { kind: 'user' } : { kind: 'injected' },
  } as unknown as Message
}

/** Build one assistant message. */
export function assistantMessage(id: string, text: string): Message {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'fake', model: 'fake' },
  } as unknown as Message
}

/** Build one committed `user/message` event. */
export function userEvent(seq: number, text: string, kind: 'user' | 'injected' = 'user'): SessionEvent {
  return {
    seq,
    time: 0,
    type: 'user/message',
    data: userMessage(`m${seq}`, text, kind),
  } as unknown as SessionEvent
}

/** Build one committed `turn/end` event. */
export function turnEndEvent(seq: number, turn: number, kind: string): SessionEvent {
  return {
    seq,
    time: 0,
    type: 'turn/end',
    data: { turn, reason: { kind } },
  } as unknown as SessionEvent
}

/** Yield the fixed summary text, then a normal finish. */
async function* streamSummary(text: string, usage: TokenUsage | undefined, wait?: Promise<void>): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text }
  if (wait !== undefined) await wait
  if (usage !== undefined) yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * Create one fake host and mount the plugin's `apply()` against it.
 * @param options - fake service contents.
 * @param applyPlugin - the plugin entry point to mount.
 * @returns the fake host for assertions and event delivery.
 */
export function createFakeHost(
  options: FakeHostOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plugin's schema-validated config type differs per entry point
  applyPlugin: (ctx: Context, config: any) => void,
): FakeHost {
  const logs: LogLine[] = []
  const llmCalls: GenerateOptions[] = []
  const activations: SubagentActivationSpec[] = []
  const listeners: ((session: Session, event: SessionEvent) => void)[] = []
  let unblock!: () => void
  const blocked = options.blockSummary === undefined ? undefined : new Promise<void>((resolve) => (unblock = resolve))
  const session = {
    id: 'session-under-test',
    header: {
      version: 4,
      id: 'session-under-test',
      createdAt: 0,
      isSeeded: false,
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.delegationDepth === undefined ? {} : { delegationDepth: options.delegationDepth }),
    },
    get seq() {
      return 0
    },
    deriveMessages: () => options.messages ?? [],
    requestHeader: () => (options.route === undefined ? undefined : { config: options.route }),
    snapshotEvents: () => [],
    eventAt: () => undefined,
  } as unknown as Session
  const logger = (name: string) => {
    void name
    const record = (level: LogLine['level']) => (message: string) => {
      logs.push({ level, message })
    }
    return { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') }
  }
  const ctx = {
    logger,
    on: (event: string, listener: (session: Session, event: SessionEvent) => void) => {
      void event
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
        return true
      }
    },
    effect: (execute: () => () => void) => {
      const dispose = execute()
      return dispose
    },
    agents: {
      get: (id: string) => (options.liveParent === false ? undefined : { id }),
    },
    sessionProjections: {
      stateOf: (target: Session, key: string) => {
        void target
        if (key === 'tokenUsage' && options.totals !== undefined) {
          return { totals: options.totals, last: null }
        }
        if (key === 'titleInput' && options.firstPrompt !== undefined) {
          return { first: { seq: 0, text: options.firstPrompt }, count: 1, lastSeq: 0 }
        }
        return undefined
      },
    },
    tokenMeter: {
      measure: () => ({ totalTokens: 0 }),
    },
    llm: {
      stream: (request: GenerateOptions) => {
        llmCalls.push(request)
        if (options.summaryError !== undefined) {
          const error = options.summaryError
          return (async function* () {
            void error
            throw error
          })()
        }
        return streamSummary(
          options.summaryText ?? 'FAKE SUMMARY',
          undefined,
          blocked === undefined ? undefined : blocked,
        )
      },
    },
    subagents: {
      startActivation: async (spec: SubagentActivationSpec) => {
        activations.push(spec)
        return {
          childId: options.childId ?? 'session-handoff-child',
          result: Promise.resolve({ output: [], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    },
  } as unknown as Context
  applyPlugin(ctx, options.config ?? buildTestConfig())
  return {
    ctx,
    logs,
    llmCalls,
    activations,
    session,
    emit: (target: Session, event: SessionEvent) => {
      for (const listener of [...listeners]) listener(target, event)
    },
    unblock: () => {
      unblock?.()
    },
  }
}

/**
 * The plugin's default configuration as the loader would deliver it.
 * Kept here so tests exercise the same shape a profile row produces.
 */
export function buildTestConfig(): unknown {
  return {
    thresholdTokens: 1000,
    metric: 'total',
    onlyCompletedTurns: true,
    summarizeSubagentSessions: false,
    maxConsecutiveFailures: 3,
    dryRun: false,
    summary: {
      provider: '',
      model: '',
      maxInputChars: 48_000,
      maxOutputTokens: 4096,
      timeoutMs: 120_000,
    },
    handoff: {
      provider: 'spawn',
      delivery: 'parent',
      labelPrefix: 'handoff',
      promptTemplate: 'Continue the task.\n\n{{firstPrompt}}\n\n{{summary}}',
    },
  }
}

/** Wait until `predicate` is true, polling the microtask/macrotask queue. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}
