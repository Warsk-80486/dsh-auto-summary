import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Session } from '@deepseek-ai/dsh-session'
import { measureUsage, readCumulativeUsage, sumTokenTotals, type UsageSources } from '../src/usage.js'

const session = {} as Session

describe('sumTokenTotals', () => {
  it('returns zero before the first provider usage sample', () => {
    assert.equal(sumTokenTotals(undefined), 0)
  })

  it('sums the disjoint cache and output buckets', () => {
    assert.equal(
      sumTokenTotals({
        uncachedInputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 1000,
        cacheWriteTokens: 5,
      }),
      1125,
    )
  })

  it('ignores malformed negative and non-finite counts', () => {
    assert.equal(
      sumTokenTotals({
        uncachedInputTokens: -5,
        outputTokens: Number.NaN,
        cacheReadTokens: Number.POSITIVE_INFINITY,
        cacheWriteTokens: 7,
      }),
      7,
    )
  })
})

describe('readCumulativeUsage', () => {
  it('reads the tokenUsage projection totals', () => {
    const sources = {
      sessionProjections: {
        stateOf: () => ({
          totals: { uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
          last: null,
        }),
      },
    } as unknown as Pick<UsageSources, 'sessionProjections'>
    assert.equal(readCumulativeUsage(sources, session), 100)
  })

  it('returns zero when the projection is absent', () => {
    const sources = {
      sessionProjections: { stateOf: () => undefined },
    } as unknown as Pick<UsageSources, 'sessionProjections'>
    assert.equal(readCumulativeUsage(sources, session), 0)
  })
})

describe('measureUsage', () => {
  it('uses context pressure for the context metric', () => {
    const sources = {
      sessionProjections: { stateOf: () => undefined },
      tokenMeter: { measure: () => ({ totalTokens: 7777 }) },
    } as unknown as UsageSources
    assert.equal(measureUsage(sources, session, 'context'), 7777)
  })

  it('uses cumulative totals for the total metric', () => {
    const sources = {
      sessionProjections: {
        stateOf: () => ({
          totals: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
          last: null,
        }),
      },
      tokenMeter: { measure: () => ({ totalTokens: 999 }) },
    } as unknown as UsageSources
    assert.equal(measureUsage(sources, session, 'total'), 10)
  })
})
