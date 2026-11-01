/**
 * One-shot summarization call.
 *
 * The summary is produced by a plain `ctx.llm.stream()` request that never
 * touches the summarized session: no session event is appended, so the parent
 * conversation is not polluted, and the request is not classified as an
 * agent-loop call (no `sessionId`, no `purpose`), so title and compaction
 * consumers ignore it.
 *
 * Chunks are collected by the small validating collector in this module rather
 * than by importing a helper from the host's `@deepseek-ai/*` packages: a
 * third-party bundle resolves only its own dependencies, so the plugin keeps its
 * runtime imports minimal and its stream handling explicit.
 *
 * @module dsh-auto-summary/summary
 */
import type { FinishReason, GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
/** The narrow LLM surface a summarizer needs. */
export interface LlmStreamer {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/** One complete model response collected from a chunk stream. */
export interface CollectedResponse {
    /** Concatenated visible text blocks, trimmed. */
    text: string;
    /** Terminal finish reason. */
    finish: FinishReason;
    /** Provider usage, when the adapter reported it. */
    usage?: TokenUsage;
}
/** A summary call that failed in a way the caller should surface, not retry silently. */
export declare class SummaryError extends Error {
    /** Stable machine-readable failure code. */
    readonly code: string;
    /**
     * @param message - human-readable diagnostic.
     * @param code - stable machine-readable code.
     */
    constructor(message: string, code: string);
}
/**
 * Collect a streamed response into text, finish reason, and usage.
 *
 * Text deltas are authoritative; a text `block-end` is only used when the
 * adapter streamed no deltas at all, so assembled blocks never double the text.
 *
 * @param chunks - the model chunk stream.
 * @returns the collected response.
 * @throws {SummaryError} when the stream ends without a finish chunk or without text.
 */
export declare function collectStreamedText(chunks: AsyncIterable<StreamChunk>): Promise<CollectedResponse>;
/** One resolved summarization call. */
export interface SummaryRequest {
    /** Provider route selected for the call. */
    provider: string;
    /** Model id selected for the call. */
    model: string;
    /** Fixed summarizer instructions. */
    system: string;
    /** Framed user-message body. */
    input: string;
    /** Output-token ceiling. */
    maxTokens: number;
    /** Deadline and plugin-lifetime cancellation. */
    signal: AbortSignal;
}
/**
 * Assemble the provider request for one summarization call.
 * @param request - resolved call inputs.
 * @returns a fully populated, hand-built LLM request.
 */
export declare function buildSummaryGenerateOptions(request: SummaryRequest): GenerateOptions;
/**
 * Run one summarization call and return its text.
 *
 * @param llm - LLM service (or a test double with the same narrow shape).
 * @param request - resolved call inputs.
 * @returns the trimmed summary text.
 * @throws {SummaryError} when the model call fails or produces no usable text.
 */
export declare function summarize(llm: LlmStreamer, request: SummaryRequest): Promise<string>;
