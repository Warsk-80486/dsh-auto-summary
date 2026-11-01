/**
 * Configuration schema and normalization for the auto-summary bundle.
 *
 * The schema is exported as `Config` so the Cordis loader validates a profile
 * row's `config:` block before {@link resolveConfig} applies the cross-field
 * rules. Every field has a default: the bundle's `cordis.patch.yml` inserts the
 * row without a `config:` block, and the row still mounts.
 *
 * @module dsh-auto-summary/config
 */
import z from '@deepseek-ai/schemastery'

/** Which usage figure the threshold is compared against. */
export type UsageMetric =
  /** Cumulative provider-billed tokens of the session (`tokenUsage` projection). */
  | 'total'
  /** Current request pressure of the session (`ctx.tokenMeter.measure().totalTokens`). */
  | 'context'

/** Where the handoff agent's completion notice is delivered. */
export type HandoffDelivery =
  /** The parent agent receives a completion notice and may answer it. */
  | 'parent'
  /** No parent notice; the run is fire-and-forget from the session's point of view. */
  | 'caller'

/** Model-call controls for the summarization request. */
export interface SummaryOptions {
  /** Explicit provider route; empty pairs with `model` to inherit the session's latest route. */
  provider: string
  /** Explicit model id; empty pairs with `provider` to inherit the session's latest route. */
  model: string
  /** Maximum characters of conversation transcript sent to the summarizer. */
  maxInputChars: number
  /** Output-token ceiling for the summary call. */
  maxOutputTokens: number
  /** Deadline for one summary call, in milliseconds. */
  timeoutMs: number
}

/** How the fresh handoff agent is created and briefed. */
export interface HandoffOptions {
  /** Registered subagent provider used to create the handoff agent (`spawn` is shipped). */
  provider: string
  /** Result-delivery policy for the handoff activation. */
  delivery: HandoffDelivery
  /** Prefix of the short catalog label recorded for the handoff agent. */
  labelPrefix: string
  /**
   * Task template for the handoff agent. `{{firstPrompt}}`, `{{summary}}`,
   * `{{sessionId}}`, `{{turn}}`, and `{{reason}}` are substituted; a missing
   * placeholder section is appended so the first prompt and the summary are
   * always present in the delivered task.
   */
  promptTemplate: string
}

/** Fully resolved plugin configuration. */
export interface AutoSummaryConfig {
  /** Token count at which one summary/handoff pass is triggered. */
  thresholdTokens: number
  /** Usage figure compared against {@link thresholdTokens}. */
  metric: UsageMetric
  /** Trigger only after a turn that ended normally (`turn/end.reason.kind === 'completed'`). */
  onlyCompletedTurns: boolean
  /** Also summarize subagent sessions; the default skips them to prevent recursion. */
  summarizeSubagentSessions: boolean
  /** Consecutive failed passes after which the threshold is re-armed instead of retried. */
  maxConsecutiveFailures: number
  /** Compute and log the pass without calling the model or starting an agent. */
  dryRun: boolean
  /** Summary model-call controls. */
  summary: SummaryOptions
  /** Handoff agent controls. */
  handoff: HandoffOptions
}

/** Task framing delivered to the fresh handoff agent. */
export const DEFAULT_HANDOFF_TEMPLATE = `You are a continuation agent taking over a task from an earlier DeepSeek Harness session.

The earlier session reached its token budget and handed off to you with the summary below. Do not repeat work it already completed. Verify the state it describes against the workspace where that matters, then continue the task.

## Original first user prompt (verbatim)
{{firstPrompt}}

## Handoff summary
{{summary}}

## How to proceed
- Read the files and artifacts named in the summary first.
- Continue from "Current state" and "Next steps"; do not restart from the beginning.
- If the summary is missing something you need, inspect the workspace rather than guessing.
- Finish with what you verified, what you changed, and what remains.`

/** Loader-validated configuration schema; every field has a default. */
export const Config = z
  .object({
    thresholdTokens: z
      .natural()
      .min(1000)
      .default(1_000_000)
      .description('Billed-token total at which one summary/handoff pass is triggered.'),
    metric: z
      .union([z.const('total'), z.const('context')])
      .default('total')
      .description('Compare the threshold against cumulative billed tokens or current context pressure.'),
    onlyCompletedTurns: z
      .boolean()
      .default(true)
      .description('Trigger only after a normally completed turn, not a failed, aborted, or blocked one.'),
    summarizeSubagentSessions: z
      .boolean()
      .default(false)
      .description('Also summarize subagent child sessions. Off prevents recursive handoffs.'),
    maxConsecutiveFailures: z
      .natural()
      .max(100)
      .default(3)
      .description('Failed passes after which the threshold is re-armed instead of retried on the next turn.'),
    dryRun: z
      .boolean()
      .default(false)
      .description('Log what would be summarized and handed off without calling the model or starting an agent.'),
    summary: z
      .object({
        provider: z.string().default('').description('Provider route override; empty inherits the session route.'),
        model: z.string().default('').description('Model override; empty inherits the session route.'),
        maxInputChars: z
          .natural()
          .min(1000)
          .default(48_000)
          .description('Maximum characters of conversation transcript sent to the summarizer.'),
        maxOutputTokens: z.natural().min(256).default(4096).description('Output-token ceiling for the summary call.'),
        timeoutMs: z.natural().min(1000).default(120_000).description('Deadline for one summary call, in milliseconds.'),
      })
      .default({
        provider: '',
        model: '',
        maxInputChars: 48_000,
        maxOutputTokens: 4096,
        timeoutMs: 120_000,
      }),
    handoff: z
      .object({
        provider: z.string().default('spawn').description('Registered subagent provider used to start the handoff agent.'),
        delivery: z
          .union([z.const('parent'), z.const('caller')])
          .default('parent')
          .description('Deliver the handoff result to the parent agent or only to the plugin.'),
        labelPrefix: z.string().default('handoff').description('Prefix of the short catalog label for the handoff agent.'),
        promptTemplate: z.string().default(DEFAULT_HANDOFF_TEMPLATE).description('Task template for the handoff agent.'),
      })
      .default({
        provider: 'spawn',
        delivery: 'parent',
        labelPrefix: 'handoff',
        promptTemplate: DEFAULT_HANDOFF_TEMPLATE,
      }),
  })
  .description('Automatic session summarization and fresh-agent handoff for DeepSeek Harness.')

/** One non-empty trimmed string, or a descriptive error. */
function requireText(field: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`dsh-auto-summary: ${field} must not be empty`)
  return trimmed
}

/**
 * Apply the cross-field rules the schema cannot express and return a detached,
 * frozen configuration.
 *
 * @param config - schema-validated configuration.
 * @returns the normalized configuration.
 * @throws when a paired option is half-set or a required identifier is empty.
 */
export function resolveConfig(config: AutoSummaryConfig): AutoSummaryConfig {
  const provider = config.summary.provider.trim()
  const model = config.summary.model.trim()
  if ((provider.length === 0) !== (model.length === 0)) {
    throw new Error('dsh-auto-summary: summary.provider and summary.model must be set together or left empty together')
  }
  const handoffProvider = requireText('handoff.provider', config.handoff.provider)
  const labelPrefix = requireText('handoff.labelPrefix', config.handoff.labelPrefix)
  const promptTemplate = requireText('handoff.promptTemplate', config.handoff.promptTemplate)
  const thresholdTokens = Math.floor(config.thresholdTokens)
  if (!Number.isSafeInteger(thresholdTokens) || thresholdTokens < 1) {
    throw new Error('dsh-auto-summary: thresholdTokens must be a positive integer')
  }
  return Object.freeze({
    ...config,
    thresholdTokens,
    summary: Object.freeze({ ...config.summary, provider, model }),
    handoff: Object.freeze({ ...config.handoff, provider: handoffProvider, labelPrefix, promptTemplate }),
  })
}
