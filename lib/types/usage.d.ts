/**
 * Session usage measurement.
 *
 * Two figures are supported; both are durable-log measurements from the shipped
 * `dsh-token-meter` surface:
 *
 * - `total` — the session's cumulative provider-billed tokens, folded by the
 *   `tokenUsage` session projection. `stateOf(session, 'tokenUsage')` returns
 *   the host state `{ totals, last }`; `totals` is what this module reads.
 * - `context` — the current request pressure from `ctx.tokenMeter.measure()`,
 *   i.e. what the next request would send.
 *
 * Nothing here makes a model call; both reads replay the durable log.
 *
 * @module dsh-auto-summary/usage
 */
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import type { UsageMetric } from './config.js';
/** The services this module reads. */
export interface UsageSources {
    sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>;
    tokenMeter: Pick<TokenMeter, 'measure'>;
}
/**
 * Add up one usage sample. Counts are disjoint, so billed input is the sum of
 * the uncached and cached buckets; cache reads are tokens the provider sent
 * through the model even when they were billed at a lower rate.
 *
 * @param totals - one `tokenUsage` totals sample, or `undefined` before the
 *   first provider-reported usage.
 * @returns the non-negative token count, `0` when no sample exists.
 */
export declare function sumTokenTotals(totals: TokenUsageProjection | undefined): number;
/** Read the session's cumulative billed-token total; `0` before the first sample. */
export declare function readCumulativeUsage(sources: Pick<UsageSources, 'sessionProjections'>, session: Session): number;
/**
 * Measure the usage figure selected by the configured metric.
 *
 * @param sources - projection registry and token meter.
 * @param session - the session whose log is measured.
 * @param metric - `total` for cumulative billed tokens, `context` for current pressure.
 * @returns the non-negative token count.
 */
export declare function measureUsage(sources: UsageSources, session: Session, metric: UsageMetric): number;
