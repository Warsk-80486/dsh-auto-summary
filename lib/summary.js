/** A summary call that failed in a way the caller should surface, not retry silently. */
export class SummaryError extends Error {
    /** Stable machine-readable failure code. */
    code;
    /**
     * @param message - human-readable diagnostic.
     * @param code - stable machine-readable code.
     */
    constructor(message, code) {
        super(message);
        this.name = 'SummaryError';
        this.code = code;
    }
}
/**
 * Join one stop reason into a fail-closed error, or accept a normal stop.
 *
 * @param finish - the terminal finish reason.
 * @throws {SummaryError} when the call stopped without text output.
 */
function assertStoppable(finish) {
    switch (finish.kind) {
        case 'stop':
            return;
        case 'max-tokens':
            throw new SummaryError('summary output reached the configured output-token ceiling', 'MAX_TOKENS');
        case 'tool-calls':
            throw new SummaryError('summary output must be plain text, but the model requested a tool call', 'TOOL_CALLS');
        case 'aborted':
            throw new SummaryError(`summary call was aborted: ${finish.failure.message}`, 'ABORTED');
        case 'error':
            throw new SummaryError(`summary call failed: ${finish.failure.message}`, 'ERROR');
    }
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
export async function collectStreamedText(chunks) {
    let text = '';
    let sawTextDelta = false;
    let blockEndText = '';
    let finish;
    let usage;
    for await (const chunk of chunks) {
        switch (chunk.type) {
            case 'text-delta':
                text += chunk.text;
                sawTextDelta = true;
                break;
            case 'block-end':
                if (chunk.block.type === 'text')
                    blockEndText += chunk.block.text;
                break;
            case 'usage':
                usage = chunk.usage;
                break;
            case 'finish':
                finish = chunk.reason;
                break;
            default:
                break;
        }
    }
    if (finish === undefined)
        throw new SummaryError('summary stream ended without a finish chunk', 'NO_FINISH');
    assertStoppable(finish);
    const collected = (sawTextDelta ? text : blockEndText).trim();
    if (collected.length === 0)
        throw new SummaryError('summary call produced no text output', 'EMPTY');
    return usage === undefined ? { text: collected, finish } : { text: collected, finish, usage };
}
/**
 * Assemble the provider request for one summarization call.
 * @param request - resolved call inputs.
 * @returns a fully populated, hand-built LLM request.
 */
export function buildSummaryGenerateOptions(request) {
    return {
        provider: request.provider,
        model: request.model,
        system: request.system,
        messages: [
            {
                role: 'user',
                content: [{ type: 'text', text: request.input }],
            },
        ],
        maxTokens: request.maxTokens,
        signal: request.signal,
    };
}
/**
 * Run one summarization call and return its text.
 *
 * @param llm - LLM service (or a test double with the same narrow shape).
 * @param request - resolved call inputs.
 * @returns the trimmed summary text.
 * @throws {SummaryError} when the model call fails or produces no usable text.
 */
export async function summarize(llm, request) {
    const collected = await collectStreamedText(llm.stream(buildSummaryGenerateOptions(request)));
    return collected.text;
}
