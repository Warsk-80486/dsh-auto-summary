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
import z from '@deepseek-ai/schemastery';
/** Which usage figure the threshold is compared against. */
export type UsageMetric = 
/** Cumulative provider-billed tokens of the session (`tokenUsage` projection). */
'total'
/** Current request pressure of the session (`ctx.tokenMeter.measure().totalTokens`). */
 | 'context';
/** Where the handoff agent's completion notice is delivered. */
export type HandoffDelivery = 
/** The parent agent receives a completion notice and may answer it. */
'parent'
/** No parent notice; the run is fire-and-forget from the session's point of view. */
 | 'caller';
/** Model-call controls for the summarization request. */
export interface SummaryOptions {
    /** Explicit provider route; empty pairs with `model` to inherit the session's latest route. */
    provider: string;
    /** Explicit model id; empty pairs with `provider` to inherit the session's latest route. */
    model: string;
    /** Maximum characters of conversation transcript sent to the summarizer. */
    maxInputChars: number;
    /** Output-token ceiling for the summary call. */
    maxOutputTokens: number;
    /** Deadline for one summary call, in milliseconds. */
    timeoutMs: number;
}
/** How the fresh handoff agent is created and briefed. */
export interface HandoffOptions {
    /** Registered subagent provider used to create the handoff agent (`spawn` is shipped). */
    provider: string;
    /** Result-delivery policy for the handoff activation. */
    delivery: HandoffDelivery;
    /** Prefix of the short catalog label recorded for the handoff agent. */
    labelPrefix: string;
    /**
     * Task template for the handoff agent. `{{firstPrompt}}`, `{{summary}}`,
     * `{{sessionId}}`, `{{turn}}`, and `{{reason}}` are substituted; a missing
     * placeholder section is appended so the first prompt and the summary are
     * always present in the delivered task.
     */
    promptTemplate: string;
}
/** Fully resolved plugin configuration. */
export interface AutoSummaryConfig {
    /** Token count at which one summary/handoff pass is triggered. */
    thresholdTokens: number;
    /** Usage figure compared against {@link thresholdTokens}. */
    metric: UsageMetric;
    /** Trigger only after a turn that ended normally (`turn/end.reason.kind === 'completed'`). */
    onlyCompletedTurns: boolean;
    /** Also summarize subagent sessions; the default skips them to prevent recursion. */
    summarizeSubagentSessions: boolean;
    /** Consecutive failed passes after which the threshold is re-armed instead of retried. */
    maxConsecutiveFailures: number;
    /** Compute and log the pass without calling the model or starting an agent. */
    dryRun: boolean;
    /** Summary model-call controls. */
    summary: SummaryOptions;
    /** Handoff agent controls. */
    handoff: HandoffOptions;
}
/** Task framing delivered to the fresh handoff agent. */
export declare const DEFAULT_HANDOFF_TEMPLATE = "You are a continuation agent taking over a task from an earlier DeepSeek Harness session.\n\nThe earlier session reached its token budget and handed off to you with the summary below. Do not repeat work it already completed. Verify the state it describes against the workspace where that matters, then continue the task.\n\n## Original first user prompt (verbatim)\n{{firstPrompt}}\n\n## Handoff summary\n{{summary}}\n\n## How to proceed\n- Read the files and artifacts named in the summary first.\n- Continue from \"Current state\" and \"Next steps\"; do not restart from the beginning.\n- If the summary is missing something you need, inspect the workspace rather than guessing.\n- Finish with what you verified, what you changed, and what remains.";
/** Loader-validated configuration schema; every field has a default. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    thresholdTokens: z<number, number, "defined">;
    metric: z<"total" | "context", "total" | "context", "defined">;
    onlyCompletedTurns: z<boolean, boolean, "defined">;
    summarizeSubagentSessions: z<boolean, boolean, "defined">;
    maxConsecutiveFailures: z<number, number, "defined">;
    dryRun: z<boolean, boolean, "defined">;
    summary: z<Schemastery.ObjectS<NoInfer<{
        provider: z<string, string, "defined">;
        model: z<string, string, "defined">;
        maxInputChars: z<number, number, "defined">;
        maxOutputTokens: z<number, number, "defined">;
        timeoutMs: z<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: z<string, string, "defined">;
        model: z<string, string, "defined">;
        maxInputChars: z<number, number, "defined">;
        maxOutputTokens: z<number, number, "defined">;
        timeoutMs: z<number, number, "defined">;
    }>>, "defined">;
    handoff: z<Schemastery.ObjectS<NoInfer<{
        provider: z<string, string, "defined">;
        delivery: z<"parent" | "caller", "parent" | "caller", "defined">;
        labelPrefix: z<string, string, "defined">;
        promptTemplate: z<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: z<string, string, "defined">;
        delivery: z<"parent" | "caller", "parent" | "caller", "defined">;
        labelPrefix: z<string, string, "defined">;
        promptTemplate: z<string, string, "defined">;
    }>>, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    thresholdTokens: z<number, number, "defined">;
    metric: z<"total" | "context", "total" | "context", "defined">;
    onlyCompletedTurns: z<boolean, boolean, "defined">;
    summarizeSubagentSessions: z<boolean, boolean, "defined">;
    maxConsecutiveFailures: z<number, number, "defined">;
    dryRun: z<boolean, boolean, "defined">;
    summary: z<Schemastery.ObjectS<NoInfer<{
        provider: z<string, string, "defined">;
        model: z<string, string, "defined">;
        maxInputChars: z<number, number, "defined">;
        maxOutputTokens: z<number, number, "defined">;
        timeoutMs: z<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: z<string, string, "defined">;
        model: z<string, string, "defined">;
        maxInputChars: z<number, number, "defined">;
        maxOutputTokens: z<number, number, "defined">;
        timeoutMs: z<number, number, "defined">;
    }>>, "defined">;
    handoff: z<Schemastery.ObjectS<NoInfer<{
        provider: z<string, string, "defined">;
        delivery: z<"parent" | "caller", "parent" | "caller", "defined">;
        labelPrefix: z<string, string, "defined">;
        promptTemplate: z<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        provider: z<string, string, "defined">;
        delivery: z<"parent" | "caller", "parent" | "caller", "defined">;
        labelPrefix: z<string, string, "defined">;
        promptTemplate: z<string, string, "defined">;
    }>>, "defined">;
}>>, "plain">;
/**
 * Apply the cross-field rules the schema cannot express and return a detached,
 * frozen configuration.
 *
 * @param config - schema-validated configuration.
 * @returns the normalized configuration.
 * @throws when a paired option is half-set or a required identifier is empty.
 */
export declare function resolveConfig(config: AutoSummaryConfig): AutoSummaryConfig;
