/**
 * Per-session trigger bookkeeping.
 *
 * A session becomes eligible at `thresholdTokens`, is disarmed while one pass is
 * in flight, and re-arms `thresholdTokens` above the usage observed when the
 * pass succeeded. Because cumulative usage only grows, a session with a very
 * long life produces one handoff per additional threshold of billed tokens
 * rather than one handoff per turn.
 *
 * State is process-local and weakly keyed: a session that is discarded loses
 * its ledger entry with it, and a resumed session starts a fresh ledger (the
 * first completed turn after resume re-evaluates the cumulative total).
 *
 * @module dsh-auto-summary/ledger
 */
/**
 * Track when each session may be summarized again.
 *
 * Keys are session objects, not ids, so a disposed session's state is collected
 * without an explicit cleanup path.
 */
export class TriggerLedger {
    thresholdTokens;
    maxConsecutiveFailures;
    states = new WeakMap();
    /**
     * @param thresholdTokens - tokens added above the last successful pass before
     *   the session becomes eligible again.
     * @param maxConsecutiveFailures - failed passes after which the current
     *   threshold is treated as consumed and re-armed; `0` retries forever.
     */
    constructor(thresholdTokens, maxConsecutiveFailures) {
        this.thresholdTokens = thresholdTokens;
        this.maxConsecutiveFailures = maxConsecutiveFailures;
    }
    /** Read (creating on first use) one session's trigger state. */
    stateOf(key) {
        const existing = this.states.get(key);
        if (existing !== undefined)
            return existing;
        const created = {
            nextThreshold: this.thresholdTokens,
            inFlight: false,
            triggered: 0,
            failures: 0,
        };
        this.states.set(key, created);
        return created;
    }
    /**
     * Whether one pass may start now.
     *
     * @param key - the session object.
     * @param usage - the measured usage figure for this session.
     * @returns `true` when no pass is in flight and the figure reached the threshold.
     */
    shouldTrigger(key, usage) {
        const state = this.stateOf(key);
        return !state.inFlight && usage >= state.nextThreshold;
    }
    /** Mark a pass as started; further turns are ignored until it settles. */
    begin(key) {
        const state = this.stateOf(key);
        state.inFlight = true;
        state.triggered += 1;
    }
    /**
     * Mark a pass as succeeded: re-arm one threshold above the observed usage.
     *
     * @param key - the session object.
     * @param usage - usage measured when the pass started.
     */
    succeed(key, usage) {
        const state = this.stateOf(key);
        state.inFlight = false;
        state.failures = 0;
        state.nextThreshold = usage + this.thresholdTokens;
    }
    /**
     * Mark a pass as failed. The threshold stays armed so the next completed turn
     * retries, until {@link maxConsecutiveFailures} consecutive failures consume
     * the current threshold.
     *
     * @param key - the session object.
     * @param usage - usage measured when the pass started.
     */
    fail(key, usage) {
        const state = this.stateOf(key);
        state.inFlight = false;
        state.failures += 1;
        if (this.maxConsecutiveFailures > 0 && state.failures >= this.maxConsecutiveFailures) {
            state.failures = 0;
            state.nextThreshold = usage + this.thresholdTokens;
        }
    }
    /** Drop one session's state (used on plugin unload). */
    forget(key) {
        this.states.delete(key);
    }
}
