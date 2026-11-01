/** Fixed instructions for the summarization model call. */
export const SUMMARY_SYSTEM_PROMPT = [
    'You summarize one DeepSeek Harness coding session so a fresh agent can continue the work.',
    '',
    'Produce a self-contained handoff brief in Markdown with exactly these sections:',
    '## Original Task',
    '## Work Completed',
    '## Key Decisions and Rationale',
    '## Files and Artifacts',
    '## Current State',
    '## Next Steps',
    '## Constraints and Preferences',
    '',
    'Rules:',
    '- Write in the same natural language as the conversation.',
    '- Preserve exact file paths, commands, identifiers, error strings, numeric values, and API signatures.',
    '- Capture the user instructions and corrections faithfully; never invent requirements.',
    '- State what is verified versus uncertain. Quote the original task in its own section.',
    '- Do not mention this summarization request, token limits, or that a handoff is happening.',
    '- Output only the brief; do not call tools and do not add commentary before or after it.',
].join('\n');
/** Marker appended to keep a truncated transcript honest. */
const OMITTED_MARKER = '[earlier messages omitted to fit the input budget]';
/**
 * Extract the visible text of one content-block list.
 *
 * Images, files, reasoning, and tool-call blocks are not text: image and file
 * blocks are named, reasoning and tool calls are dropped.
 *
 * @param content - model-visible blocks.
 * @returns the newline-joined text, `''` when the message has none.
 */
export function textOfContent(content) {
    const parts = [];
    for (const block of content) {
        if (block.type === 'text')
            parts.push(block.text);
        else if (block.type === 'image')
            parts.push('[image]');
        else if (block.type === 'file')
            parts.push(`[file: ${block.attachment.name}]`);
    }
    return parts.join('\n').trim();
}
/** Whether one message is a direct human prompt rather than injected context. */
export function isHumanUserMessage(message) {
    return message.role === 'user' && message.source.kind === 'user';
}
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
export function extractFirstPromptFromEvents(events) {
    for (const event of events) {
        if (event.type !== 'user/message')
            continue;
        if (event.data.source.kind !== 'user')
            continue;
        const text = textOfContent(event.data.content);
        if (text.length > 0)
            return text;
    }
    return undefined;
}
/**
 * Find the first direct human prompt in derived (compacted) history.
 *
 * Compaction replaces old history with a summary message that is not a human
 * prompt, so the projection path is preferred; this fallback covers sessions
 * whose title projection was unavailable before any compaction happened.
 * @param messages - derived model-visible history.
 * @returns the first prompt text, or `undefined` when history has none.
 */
export function extractFirstPromptFromMessages(messages) {
    for (const message of messages) {
        if (!isHumanUserMessage(message))
            continue;
        const text = textOfContent(message.content);
        if (text.length > 0)
            return text;
    }
    return undefined;
}
/**
 * Validate and read the shipped `titleInput` projection's retained first prompt.
 *
 * The projection state is host-local and untrusted here: a missing unit, an
 * older shape, or an empty prompt all yield `undefined` rather than a throw.
 * @param state - raw value returned by the projection registry.
 * @returns the retained first prompt text, or `undefined`.
 */
export function readTitleInputFirstPrompt(state) {
    if (typeof state !== 'object' || state === null)
        return undefined;
    const first = state.first;
    if (typeof first !== 'object' || first === null)
        return undefined;
    const text = first.text;
    return typeof text === 'string' && text.trim().length > 0 ? text.trim() : undefined;
}
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
export function readFirstPrompt(sources, session) {
    const readState = sources.sessionProjections.stateOf;
    const fromProjection = readTitleInputFirstPrompt(readState.call(sources.sessionProjections, session, 'titleInput'));
    if (fromProjection !== undefined)
        return fromProjection;
    return extractFirstPromptFromMessages(session.deriveMessages());
}
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
export function renderTranscript(messages, options) {
    const lines = [];
    let used = 0;
    let omitted = false;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message === undefined)
            continue;
        let line;
        if (isHumanUserMessage(message)) {
            const text = textOfContent(message.content);
            if (text.length === 0)
                continue;
            line = `User: ${text}`;
        }
        else if (message.role === 'assistant') {
            const text = textOfContent(message.content);
            if (text.length === 0)
                continue;
            line = `Assistant: ${text}`;
        }
        else {
            continue;
        }
        if (used + line.length + 1 > options.maxChars) {
            omitted = true;
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }
    if (lines.length === 0)
        return '(no conversation transcript available)';
    lines.reverse();
    if (omitted)
        lines.unshift(OMITTED_MARKER);
    return lines.join('\n');
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
export function composeHandoffTask(template, vars) {
    const substitutions = {
        firstPrompt: vars.firstPrompt,
        summary: vars.summary,
        sessionId: vars.sessionId,
        turn: String(vars.turn),
        reason: vars.reason,
    };
    let task = template.replace(/\{\{(firstPrompt|summary|sessionId|turn|reason)\}\}/gu, (_match, name) => {
        return substitutions[name] ?? '';
    });
    if (!template.includes('{{firstPrompt}}')) {
        task += `\n\n## Original first user prompt (verbatim)\n${vars.firstPrompt}`;
    }
    if (!template.includes('{{summary}}')) {
        task += `\n\n## Handoff summary\n${vars.summary}`;
    }
    return task.trim();
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
export function buildSummaryRequestText(input) {
    return [
        'Summarize this DeepSeek Harness coding session for a fresh agent that will continue the work.',
        '',
        '## Original first user prompt (verbatim, must be quoted in your "Original Task" section)',
        input.firstPrompt,
        '',
        '## Conversation transcript',
        input.transcript,
        '',
        'Produce the handoff brief now.',
    ].join('\n');
}
