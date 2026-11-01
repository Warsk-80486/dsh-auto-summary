/**
 * Add up one usage sample. Counts are disjoint, so billed input is the sum of
 * the uncached and cached buckets; cache reads are tokens the provider sent
 * through the model even when they were billed at a lower rate.
 *
 * @param totals - one `tokenUsage` totals sample, or `undefined` before the
 *   first provider-reported usage.
 * @returns the non-negative token count, `0` when no sample exists.
 */
export function sumTokenTotals(totals) {
    if (totals === undefined)
        return 0;
    return (finite(totals.uncachedInputTokens) +
        finite(totals.outputTokens) +
        finite(totals.cacheReadTokens) +
        finite(totals.cacheWriteTokens));
}
/** Read the session's cumulative billed-token total; `0` before the first sample. */
export function readCumulativeUsage(sources, session) {
    const state = sources.sessionProjections.stateOf(session, 'tokenUsage');
    return sumTokenTotals(state?.totals);
}
/**
 * Measure the usage figure selected by the configured metric.
 *
 * @param sources - projection registry and token meter.
 * @param session - the session whose log is measured.
 * @param metric - `total` for cumulative billed tokens, `context` for current pressure.
 * @returns the non-negative token count.
 */
export function measureUsage(sources, session, metric) {
    if (metric === 'context')
        return finite(sources.tokenMeter.measure(session).totalTokens);
    return readCumulativeUsage(sources, session);
}
/** Coerce one provider-reported count to a safe non-negative number. */
function finite(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
}
