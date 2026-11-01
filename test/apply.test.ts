import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Session } from '@deepseek-ai/dsh-session'
import { buildTestConfig } from './helpers/host.js'
import * as plugin from '../src/index.js'
import { apply, isSubagentSession } from '../src/index.js'
import { assistantMessage, createFakeHost, turnEndEvent, userMessage, waitFor } from './helpers/host.js'

describe('plugin entry', () => {
  it('exports the Loader contract: name, inject, Config, and apply', () => {
    assert.equal(plugin.name, 'auto-summary')
    assert.deepEqual(plugin.inject, ['agents', 'llm', 'sessionProjections', 'subagents', 'tokenMeter'])
    assert.equal(typeof plugin.Config, 'function')
    assert.equal(typeof plugin.apply, 'function')
    const config = plugin.Config({}) as { thresholdTokens: number; metric: string }
    assert.equal(config.thresholdTokens, 100_000_000)
    assert.equal(config.metric, 'total')
  })
})

/** Give a fire-and-forget listener chain a chance to finish. */
function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('isSubagentSession', () => {
  it('detects the durable origin marker and any positive delegation depth', () => {
    assert.equal(isSubagentSession({ header: { origin: 'subagent' } } as unknown as Session), true)
    assert.equal(isSubagentSession({ header: { delegationDepth: 1 } } as unknown as Session), true)
    assert.equal(isSubagentSession({ header: {} } as unknown as Session), false)
  })
})

describe('auto-summary plugin', () => {
  const summaryText = '## Original Task\nFix the flaky upload test\n\n## Current State\nmost tests green'
  const baseMessages = [
    userMessage('m1', 'Fix the flaky upload test'),
    assistantMessage('m2', 'Added deterministic waits and reran the suite.'),
  ]

  it('summarizes above the threshold and starts a handoff agent with the first prompt and summary', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'Fix the flaky upload test',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
        messages: baseMessages,
        summaryText,
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await waitFor(() => host.activations.length === 1)

    assert.equal(host.llmCalls.length, 1)
    const request = host.llmCalls[0]!
    assert.equal(request.provider, 'deepseek')
    assert.equal(request.model, 'deepseek-chat')
    assert.equal(request.sessionId, undefined)
    assert.equal(request.purpose, undefined)
    const body = request.messages[0]!.content as { type: 'text'; text: string }[]
    assert.ok(body[0]!.text.includes('Fix the flaky upload test'))
    assert.ok(body[0]!.text.includes('Added deterministic waits'))

    const activation = host.activations[0]!
    assert.equal(activation.provider, 'spawn')
    assert.equal(activation.delivery, 'parent')
    assert.ok(activation.label.startsWith('handoff'))
    const task = activation.request.prompt[0] as { type: 'text'; text: string }
    assert.ok(task.text.includes('Fix the flaky upload test'))
    assert.ok(task.text.includes('## Current State'))
    assert.ok(host.logs.some((line) => line.level === 'info' && line.message.includes('started handoff agent')))
  })

  it('does nothing below the threshold', async () => {
    const host = createFakeHost({ totals: { uncachedInputTokens: 999, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }, apply)
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await settle()
    assert.equal(host.llmCalls.length, 0)
    assert.equal(host.activations.length, 0)
  })

  it('skips subagent child sessions to prevent recursive handoffs', async () => {
    const host = createFakeHost(
      { totals: { uncachedInputTokens: 5000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, origin: 'subagent' },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await settle()
    assert.equal(host.llmCalls.length, 0)
    assert.equal(host.activations.length, 0)
  })

  it('skips failed turns by default', async () => {
    const host = createFakeHost(
      { totals: { uncachedInputTokens: 5000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'error'))
    await settle()
    assert.equal(host.llmCalls.length, 0)
  })

  it('counts failed turns when onlyCompletedTurns is disabled', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 5000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'task',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
        summaryText,
        config: { ...(buildTestConfig() as object), onlyCompletedTurns: false },
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'error'))
    await waitFor(() => host.activations.length === 1)
  })

  it('honors dry run without calling the model or starting an agent', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 5000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'task',
        config: { ...(buildTestConfig() as object), dryRun: true },
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await settle()
    assert.equal(host.llmCalls.length, 0)
    assert.equal(host.activations.length, 0)
    assert.ok(host.logs.some((line) => line.message.includes('[dry-run]')))
  })

  it('uses an exported custom template but still guarantees the first prompt and summary', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'Fix the flaky upload test',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
        summaryText,
        config: {
          ...(buildTestConfig() as object),
          handoff: { provider: 'spawn', delivery: 'caller', labelPrefix: 'takeover', promptTemplate: 'Continue where the last agent stopped.' },
        },
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await waitFor(() => host.activations.length === 1)
    const activation = host.activations[0]!
    assert.equal(activation.delivery, 'caller')
    assert.ok(activation.label.startsWith('takeover'))
    const task = (activation.request.prompt[0] as { type: 'text'; text: string }).text
    assert.ok(task.includes('## Original first user prompt (verbatim)'))
    assert.ok(task.includes('Fix the flaky upload test'))
    assert.ok(task.includes('## Handoff summary'))
    assert.ok(task.includes('## Current State'))
  })

  it('re-arms one threshold above the usage that succeeded instead of firing every turn', async () => {
    const totals = { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const host = createFakeHost(
      {
        totals,
        firstPrompt: 'Fix the flaky upload test',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
        summaryText,
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await waitFor(() => host.activations.length === 1)

    host.emit(host.session, turnEndEvent(20, 2, 'completed'))
    await settle()
    assert.equal(host.llmCalls.length, 1)

    totals.uncachedInputTokens = 2600
    host.emit(host.session, turnEndEvent(30, 3, 'completed'))
    await waitFor(() => host.llmCalls.length === 2)
    await waitFor(() => host.activations.length === 2)
  })

  it('does not start a second pass while the first one is in flight', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'task',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
        summaryText,
        blockSummary: new Promise<void>(() => {}),
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await waitFor(() => host.llmCalls.length === 1)
    host.emit(host.session, turnEndEvent(20, 2, 'completed'))
    await settle()
    assert.equal(host.llmCalls.length, 1)
    host.unblock()
    await waitFor(() => host.activations.length === 1)
  })

  it('keeps the threshold armed after a summary failure and retries on the next turn', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'task',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
        summaryError: new Error('provider exploded'),
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await waitFor(() => host.logs.some((line) => line.level === 'error'))
    assert.equal(host.activations.length, 0)
    host.emit(host.session, turnEndEvent(20, 2, 'completed'))
    await waitFor(() => host.llmCalls.length === 2)
    assert.equal(host.activations.length, 0)
  })

  it('reports a missing explicit route instead of guessing one', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'task',
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await waitFor(() => host.logs.some((line) => line.level === 'error'))
    assert.match(host.logs.find((line) => line.level === 'error')!.message, /no provider\/model route/)
  })

  it('reports a disposed parent instead of starting an orphan activation', async () => {
    const host = createFakeHost(
      {
        totals: { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        firstPrompt: 'task',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
        summaryText,
        liveParent: false,
      },
      apply,
    )
    host.emit(host.session, turnEndEvent(10, 1, 'completed'))
    await waitFor(() => host.logs.some((line) => line.level === 'error'))
    assert.equal(host.activations.length, 0)
    assert.match(host.logs.find((line) => line.level === 'error')!.message, /no longer has a live agent/)
  })
})
