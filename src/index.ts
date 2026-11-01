/**
 * DeepSeek Harness auto-summary bundle.
 *
 * After every finished turn the plugin reads the session's token usage. Once a
 * session crosses its configured token threshold, the plugin writes a handoff
 * brief with one auxiliary model call and starts a fresh agent whose initial
 * prompt is that brief — with the session's first human prompt quoted verbatim.
 *
 * The plugin never rewrites the summarized session: it appends no events, makes
 * no compaction, and opens no model-visible context there. The auxiliary call is
 * a hand-built `ctx.llm.stream()` request (no `sessionId`, no `purpose`), so it
 * cannot reach the parent conversation or the shipped title/compaction
 * consumers.
 *
 * Subagent sessions are skipped by default. The handoff agent is itself a
 * subagent, so without that guard its own `turn/end` would trigger another
 * handoff forever.
 *
 * @module dsh-auto-summary
 */
import type { Context, Logger } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { Config, resolveConfig, type AutoSummaryConfig } from './config.js'
import { startHandoff } from './handoff.js'
import { TriggerLedger } from './ledger.js'
import {
  buildSummaryRequestText,
  composeHandoffTask,
  readFirstPrompt,
  renderTranscript,
  SUMMARY_SYSTEM_PROMPT,
} from './prompt.js'
import { summarize } from './summary.js'
import { measureUsage } from './usage.js'

/** Loader-validated configuration schema; re-exported as the plugin's `Config`. */
export { Config }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'auto-summary'

/** Services this plugin reads; the fiber waits until all of them exist. */
export const inject = ['agents', 'llm', 'sessionProjections', 'subagents', 'tokenMeter']

/** Prefix for every log line, so the plugin's records are greppable. */
const TAG = 'dsh-auto-summary'

/** Render one unknown thrown value as a single log-safe line. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * Whether a session belongs to a delegated child agent.
 *
 * Root-mounted plugins observe every live session, including subagent children,
 * so the handoff trigger must reject them explicitly. The same predicate the
 * shipped workspace-changes plugin uses: a durable `origin` marker or any
 * positive delegation depth.
 *
 * @param session - the session whose header is inspected.
 * @returns `true` for subagent child sessions.
 */
export function isSubagentSession(session: Session): boolean {
  return session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0
}

/** Resolved inputs of one summary/handoff pass. */
interface PassContext {
  readonly ctx: Context
  readonly config: AutoSummaryConfig
  readonly logger: Logger
  readonly ledger: TriggerLedger
  readonly session: Session
  readonly usage: number
  readonly turn: number
  readonly reason: string
  readonly signal: AbortSignal
}

/**
 * Resolve the provider/model route for the summary call.
 *
 * Explicit configuration wins; otherwise the session's latest `request/header`
 * supplies the route the conversation is already using.
 *
 * @param config - resolved plugin configuration.
 * @param session - the summarized session.
 * @returns the provider and model id to call.
 * @throws when no explicit route is configured and the session has no header.
 */
function resolveSummaryTarget(config: AutoSummaryConfig, session: Session): { provider: string; model: string } {
  if (config.summary.provider.length > 0 && config.summary.model.length > 0) {
    return { provider: config.summary.provider, model: config.summary.model }
  }
  const callConfig = session.requestHeader()?.config
  if (callConfig !== undefined && callConfig.provider.length > 0 && callConfig.model.length > 0) {
    return { provider: callConfig.provider, model: callConfig.model }
  }
  throw new Error(
    'no provider/model route available: set summary.provider and summary.model, or run one model request in the session first',
  )
}

/**
 * Run one summary/handoff pass.
 *
 * All failures are contained here: the caller owns ledger bookkeeping, and a
 * failed pass must not escape a fire-and-forget `session/event` listener.
 *
 * @param pass - the resolved pass inputs.
 */
async function runPass(pass: PassContext): Promise<void> {
  const { ctx, config, logger, ledger, session, usage, turn, reason, signal } = pass
  try {
    const firstPrompt = readFirstPrompt(ctx, session)
    const transcript = renderTranscript(session.deriveMessages(), { maxChars: config.summary.maxInputChars })
    if (config.dryRun) {
      logger.info(
        `${TAG}: [dry-run] session ${session.id} usage ${usage} reached the threshold; ` +
          `firstPrompt ${firstPrompt === undefined ? 'missing' : `${firstPrompt.length} chars`}, ` +
          `transcript ${transcript.length} chars`,
      )
      ledger.succeed(session, usage)
      return
    }
    if (firstPrompt === undefined) {
      logger.warn(`${TAG}: session ${session.id} has no human first prompt; the handoff brief will rely on the transcript`)
    }
    const target = resolveSummaryTarget(config, session)
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.summary.timeoutMs)])
    const requestText = buildSummaryRequestText({
      firstPrompt: firstPrompt ?? '(first prompt unavailable in the recorded session)',
      transcript,
    })
    const summary = await summarize(ctx.llm, {
      provider: target.provider,
      model: target.model,
      system: SUMMARY_SYSTEM_PROMPT,
      input: requestText,
      maxTokens: config.summary.maxOutputTokens,
      signal: requestSignal,
    })
    const parent = ctx.agents.get(session.id)
    if (parent === undefined) {
      throw new Error(`session ${session.id} no longer has a live agent; cannot start a handoff agent`)
    }
    const task = composeHandoffTask(config.handoff.promptTemplate, {
      firstPrompt: firstPrompt ?? '(first prompt unavailable in the recorded session)',
      summary,
      sessionId: session.id,
      turn,
      reason,
    })
    const activation = await startHandoff(
      { startActivation: (spec) => ctx.subagents.startActivation(spec) },
      {
        provider: config.handoff.provider,
        delivery: config.handoff.delivery,
        labelPrefix: config.handoff.labelPrefix,
        task,
        parent,
        signal,
        turn,
      },
    )
    ledger.succeed(session, usage)
    logger.info(`${TAG}: summarized session ${session.id} at ${usage} tokens; started handoff agent ${activation.childId}`)
    void activation.result
      .then((result) => {
        logger.info(`${TAG}: handoff agent ${activation.childId} settled (${result.stopReason})`)
      })
      .catch((error: unknown) => {
        logger.warn(`${TAG}: handoff agent ${activation.childId} failed: ${describeError(error)}`)
      })
  } catch (error) {
    ledger.fail(session, usage)
    logger.error(`${TAG}: summary/handoff pass for session ${session.id} failed: ${describeError(error)}`)
  }
}

/**
 * Mount the plugin: observe completed turns, gate them through the trigger
 * ledger, and run one pass at a time per session.
 *
 * @param ctx - plugin context carrying every {@link inject}ed service.
 * @param rawConfig - schema-validated plugin configuration.
 */
export function apply(ctx: Context, rawConfig: AutoSummaryConfig): void {
  const config = resolveConfig(rawConfig)
  const logger = ctx.logger(name)
  const ledger = new TriggerLedger(config.thresholdTokens, config.maxConsecutiveFailures)
  const lifetime = new AbortController()
  ctx.effect(() => () => {
    lifetime.abort(new Error(`${TAG} unloaded`))
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    if (config.onlyCompletedTurns && event.data.reason.kind !== 'completed') return
    if (!config.summarizeSubagentSessions && isSubagentSession(session)) return
    let usage: number
    try {
      usage = measureUsage(ctx, session, config.metric)
    } catch (error) {
      logger.warn(`${TAG}: cannot measure session ${session.id}: ${describeError(error)}`)
      return
    }
    if (!ledger.shouldTrigger(session, usage)) return
    ledger.begin(session)
    void runPass({
      ctx,
      config,
      logger,
      ledger,
      session,
      usage,
      turn: event.data.turn,
      reason: event.data.reason.kind,
      signal: lifetime.signal,
    })
  })
}
