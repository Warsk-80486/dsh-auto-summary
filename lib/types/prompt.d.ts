/**
 * Prompt construction for the summarization request and the handoff task.
 *
 * The durable rule this module owns: **the first human prompt of the session is
 * always part of the handoff task**. It is quoted into the summarization input,
 * and {@link composeHandoffTask} appends an explicit verbatim section whenever a
 * custom template omits its `{{firstPrompt}}` placeholder, so the handoff agent
 * sees it even when the summarizer drops it or the template predates it.
 *
 * The first prompt is read without the deprecated synchronous log readers:
 * the shipped `titleInput` session projection keeps the first eligible human
 * message in O(1), and the compacted message history is the fallback.
 *
 * @module dsh-auto-summary/prompt
 */
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
/** Fixed instructions for the summarization model call. */
export declare const SUMMARY_SYSTEM_PROMPT: string;
/** How many characters of conversation transcript are rendered at most. */
export interface TranscriptOptions {
    /** Positive character budget for the rendered transcript. */
    maxChars: number;
}
/**
 * Extract the visible text of one content-block list.
 *
 * Images, files, reasoning, and tool-call blocks are not text: image and file
 * blocks are named, reasoning and tool calls are dropped.
 *
 * @param content - model-visible blocks.
 * @returns the newline-joined text, `''` when the message has none.
 */
export declare function textOfContent(content: readonly ContentBlock[]): string;
/** Whether one message is a direct human prompt rather than injected context. */
export declare function isHumanUserMessage(message: Message): boolean;
/**
 * Find the first direct human prompt by folding every committed user message.
 *
 * This mirrors the shipped session-title predicate: only `source.kind === 'user'`
 * counts, so injected context (skills, file-change notices, goal rounds, child
 * completion notices, compact checkpoints, team messages) is skipped.
 *
 * @param events - the session's committed events in sequence order.
 * @returns the first prompt text, or `undefined` when the log has none.
 */
export declare function extractFirstPromptFromEvents(events: readonly SessionEvent[]): string | undefined;
/**
 * Find the first direct human prompt in derived (compacted) history.
 *
 * Compaction replaces old history with a summary message that is not a human
 * prompt, so the projection path is preferred; this fallback covers sessions
 * whose title projection was unavailable before any compaction happened.
 * @param messages - derived model-visible history.
 * @returns the first prompt text, or `undefined` when history has none.
 */
export declare function extractFirstPromptFromMessages(messages: readonly Message[]): string | undefined;
/**
 * Validate and read the shipped `titleInput` projection's retained first prompt.
 *
 * The projection state is host-local and untrusted here: a missing unit, an
 * older shape, or an empty prompt all yield `undefined` rather than a throw.
 * @param state - raw value returned by the projection registry.
 * @returns the retained first prompt text, or `undefined`.
 */
export declare function readTitleInputFirstPrompt(state: unknown): string | undefined;
/**
 * Read the session's first human prompt.
 *
 * Preferred path: the `titleInput` session projection registered by the shipped
 * `dsh-session-title` service, which retains the first direct human message even
 * after compaction. Fallback: the derived (compacted) message history.
 *
 * @param sources - projection registry.
 * @param session - the session to read.
 * @returns the first prompt, or `undefined` when the session has no human message.
 */
export declare function readFirstPrompt(sources: {
    sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>;
}, session: Session): string | undefined;
/**
 * Render the compacted conversation as a plain transcript for the summarizer.
 *
 * Only direct human prompts and assistant text are rendered: injected context
 * would drown the useful signal, and tool results can be arbitrarily large.
 * Rendering runs newest-first inside the character budget, then reverses, so a
 * long session keeps its most recent work.
 *
 * @param messages - derived model-visible history.
 * @param options - transcript budget.
 * @returns the transcript text, with an omission marker when truncated.
 */
export declare function renderTranscript(messages: readonly Message[], options: TranscriptOptions): string;
/** Values substituted into a handoff template. */
export interface HandoffTemplateVars {
    /** The session's first direct human prompt, verbatim. */
    firstPrompt: string;
    /** The model-written handoff brief. */
    summary: string;
    /** The summarized session id. */
    sessionId: string;
    /** The turn whose completion triggered the handoff. */
    turn: number;
    /** The `turn/end` reason kind that triggered the handoff. */
    reason: string;
}
/**
 * Fill a handoff template and guarantee the two mandatory sections.
 *
 * Placeholders are literal `{{name}}` tokens; unknown names are left untouched.
 * When the template omits `{{firstPrompt}}` or `{{summary}}`, the corresponding
 * section is appended so the delivered task can never lose them.
 *
 * @param template - user-configured task template.
 * @param vars - substituted values.
 * @returns the handoff task text.
 */
export declare function composeHandoffTask(template: string, vars: HandoffTemplateVars): string;
/** Input framed for one summarization call. */
export interface SummaryInput {
    /** The session's first direct human prompt, verbatim. */
    firstPrompt: string;
    /** Rendered conversation transcript. */
    transcript: string;
    /** How many rendered messages the transcript represents. */
    messageCount?: number;
}
/**
 * Frame the summarization request body.
 *
 * The first prompt is repeated as its own verbatim block so the summary always
 * quotes it, independent of how hard the transcript budget truncates history.
 *
 * @param input - first prompt and transcript.
 * @returns the single user-message body sent to the summarizer.
 */
export declare function buildSummaryRequestText(input: SummaryInput): string;
