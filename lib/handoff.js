/** Longest label the handoff records in the parent's subagent catalog. */
const MAX_LABEL_CHARS = 80;
/**
 * Build the activation spec without touching the host.
 *
 * @param input - resolved handoff inputs.
 * @returns a detached activation spec whose initial prompt is the handoff task.
 */
export function buildHandoffSpec(input) {
    const label = `${input.labelPrefix} turn ${input.turn}`.slice(0, MAX_LABEL_CHARS);
    return {
        provider: input.provider,
        label,
        request: {
            prompt: [{ type: 'text', text: input.task }],
            parent: input.parent,
        },
        signal: input.signal,
        delivery: input.delivery,
    };
}
/**
 * Start the handoff agent.
 *
 * @param subagents - the host's subagent service.
 * @param input - resolved handoff inputs.
 * @returns the accepted activation, whose `childId` names the fresh session.
 * @throws when the host rejects the activation (capacity, depth, unknown
 *   provider) or the plugin unloads before publication.
 */
export async function startHandoff(subagents, input) {
    return subagents.startActivation(buildHandoffSpec(input));
}
/** Read the handoff agent's durable child id from an activation. */
export function childIdOf(activation) {
    return activation.childId;
}
