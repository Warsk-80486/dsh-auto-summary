import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Config, DEFAULT_HANDOFF_TEMPLATE, resolveConfig, type AutoSummaryConfig } from '../src/config.js'

describe('config schema', () => {
  it('fills every default when the profile row has no config block', () => {
    const config = Config({}) as AutoSummaryConfig
    assert.equal(config.thresholdTokens, 1_000_000)
    assert.equal(config.metric, 'total')
    assert.equal(config.onlyCompletedTurns, true)
    assert.equal(config.summarizeSubagentSessions, false)
    assert.equal(config.maxConsecutiveFailures, 3)
    assert.equal(config.dryRun, false)
    assert.equal(config.summary.provider, '')
    assert.equal(config.summary.model, '')
    assert.equal(config.summary.maxInputChars, 48_000)
    assert.equal(config.summary.maxOutputTokens, 4096)
    assert.equal(config.summary.timeoutMs, 120_000)
    assert.equal(config.handoff.provider, 'spawn')
    assert.equal(config.handoff.delivery, 'parent')
    assert.equal(config.handoff.labelPrefix, 'handoff')
    assert.equal(config.handoff.promptTemplate, DEFAULT_HANDOFF_TEMPLATE)
  })

  it('accepts explicit values and rejects a threshold below the supported floor', () => {
    const config = Config({ thresholdTokens: 5000, metric: 'context' }) as AutoSummaryConfig
    assert.equal(config.thresholdTokens, 5000)
    assert.equal(config.metric, 'context')
    assert.throws(() => Config({ thresholdTokens: 10 }), /thresholdTokens/)
  })

  it('exposes the first-prompt and summary placeholders in the default handoff template', () => {
    assert.ok(DEFAULT_HANDOFF_TEMPLATE.includes('{{firstPrompt}}'))
    assert.ok(DEFAULT_HANDOFF_TEMPLATE.includes('{{summary}}'))
  })
})

describe('resolveConfig', () => {
  const base = Config({}) as AutoSummaryConfig

  it('rejects a summary route with only one half configured', () => {
    assert.throws(
      () => resolveConfig({ ...base, summary: { ...base.summary, provider: 'deepseek' } }),
      /must be set together/,
    )
    assert.throws(
      () => resolveConfig({ ...base, summary: { ...base.summary, model: 'deepseek-chat' } }),
      /must be set together/,
    )
  })

  it('accepts a complete explicit route and trims identifiers', () => {
    const resolved = resolveConfig({
      ...base,
      summary: { ...base.summary, provider: ' deepseek ', model: ' deepseek-chat ' },
    })
    assert.equal(resolved.summary.provider, 'deepseek')
    assert.equal(resolved.summary.model, 'deepseek-chat')
  })

  it('rejects empty handoff identifiers', () => {
    assert.throws(() => resolveConfig({ ...base, handoff: { ...base.handoff, provider: '  ' } }), /handoff\.provider/)
    assert.throws(() => resolveConfig({ ...base, handoff: { ...base.handoff, labelPrefix: '' } }), /labelPrefix/)
    assert.throws(() => resolveConfig({ ...base, handoff: { ...base.handoff, promptTemplate: ' \n ' } }), /promptTemplate/)
  })

  it('floors a fractional threshold to a safe integer', () => {
    const resolved = resolveConfig({ ...base, thresholdTokens: 2500.9 })
    assert.equal(resolved.thresholdTokens, 2500)
  })

  it('returns a frozen value so later mutation cannot change the running policy', () => {
    const resolved = resolveConfig(base)
    assert.ok(Object.isFrozen(resolved))
    assert.ok(Object.isFrozen(resolved.summary))
    assert.ok(Object.isFrozen(resolved.handoff))
  })
})
