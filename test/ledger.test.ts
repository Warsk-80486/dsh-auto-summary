import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TriggerLedger } from '../src/ledger.js'

describe('TriggerLedger', () => {
  const key = {}

  it('triggers at the threshold and not below it', () => {
    const ledger = new TriggerLedger(1000, 3)
    assert.equal(ledger.shouldTrigger(key, 999), false)
    assert.equal(ledger.shouldTrigger(key, 1000), true)
  })

  it('disarms while a pass is in flight and re-arms one threshold higher', () => {
    const ledger = new TriggerLedger(1000, 3)
    assert.equal(ledger.shouldTrigger(key, 1200), true)
    ledger.begin(key)
    assert.equal(ledger.shouldTrigger(key, 5000), false)
    ledger.succeed(key, 1200)
    assert.equal(ledger.shouldTrigger(key, 2199), false)
    assert.equal(ledger.shouldTrigger(key, 2200), true)
  })

  it('retries a failed pass on the next turn until the failure budget is spent', () => {
    const ledger = new TriggerLedger(1000, 2)
    assert.equal(ledger.shouldTrigger(key, 1500), true)
    ledger.begin(key)
    ledger.fail(key, 1500)
    assert.equal(ledger.shouldTrigger(key, 1500), true)
    ledger.begin(key)
    ledger.fail(key, 1500)
    // Two consecutive failures consumed this threshold; re-armed 1000 above usage.
    assert.equal(ledger.shouldTrigger(key, 2400), false)
    assert.equal(ledger.shouldTrigger(key, 2500), true)
  })

  it('retries forever when the failure budget is disabled', () => {
    const ledger = new TriggerLedger(1000, 0)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(ledger.shouldTrigger(key, 1000), true)
      ledger.begin(key)
      ledger.fail(key, 1000)
    }
  })

  it('counts started passes and forgets state on demand', () => {
    const ledger = new TriggerLedger(1000, 3)
    ledger.begin(key)
    assert.equal(ledger.stateOf(key).triggered, 1)
    ledger.forget(key)
    assert.equal(ledger.stateOf(key).triggered, 0)
  })

  it('keys state by session object, not by content', () => {
    const ledger = new TriggerLedger(1000, 3)
    const other = {}
    assert.equal(ledger.shouldTrigger(key, 1000), true)
    ledger.begin(key)
    assert.equal(ledger.shouldTrigger(other, 1000), true)
  })
})
