/**
 * Handoff-agent creation.
 *
 * The fresh agent is started through the shipped subagent service
 * (`ctx.subagents.startActivation`), so identity reservation, capacity,
 * depth policy, cataloging, settlement, and teardown stay owned by the host.
 * The handoff task — a continuation brief that always carries the original first
 * prompt — is delivered as the child's initial prompt.
 *
 * @module dsh-auto-summary/handoff
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivation, SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'
import type { HandoffDelivery } from './config.js'

/** The narrow subagent surface a handoff needs. */
export interface SubagentStarter {
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>
}

/** Resolved inputs for one handoff activation. */
export interface HandoffInput {
  /** Registered provider name (`spawn` ships with the base profile). */
  provider: string
  /** Result-delivery policy. */
  delivery: HandoffDelivery
  /** Prefix of the short catalog label. */
  labelPrefix: string
  /** Complete continuation task delivered as the child's first prompt. */
  task: string
  /** The live parent agent that just finished its turn. */
  parent: Agent
  /** Plugin-lifetime cancellation for the pre-publication phase. */
  signal: AbortSignal
  /** The turn whose completion triggered the handoff. */
  turn: number
}

/** Longest label the handoff records in the parent's subagent catalog. */
const MAX_LABEL_CHARS = 80

/**
 * Build the activation spec without touching the host.
 *
 * @param input - resolved handoff inputs.
 * @returns a detached activation spec whose initial prompt is the handoff task.
 */
export function buildHandoffSpec(input: HandoffInput): SubagentActivationSpec {
  const label = `${input.labelPrefix} turn ${input.turn}`.slice(0, MAX_LABEL_CHARS)
  return {
    provider: input.provider,
    label,
    request: {
      prompt: [{ type: 'text', text: input.task }],
      parent: input.parent,
    },
    signal: input.signal,
    delivery: input.delivery,
  }
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
export async function startHandoff(subagents: SubagentStarter, input: HandoffInput): Promise<SubagentActivation> {
  return subagents.startActivation(buildHandoffSpec(input))
}

/** Read the handoff agent's durable child id from an activation. */
export function childIdOf(activation: Pick<SubagentActivation, 'childId'>): SessionId {
  return activation.childId
}
