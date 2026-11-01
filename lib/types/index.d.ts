/**
 * DeepSeek Harness auto-summary bundle.
 *
 * After every finished turn the plugin reads the session's token usage. Once a
 * session crosses its configured token threshold, the plugin writes a handoff
 * brief with one auxiliary model call and starts a fresh agent whose initial
 * prompt is that brief — with the session's first human prompt quoted verbatim.
 *
 * The plugin never rewrites the summarized session: it appends no events, makes
 * no compaction, and opens no model-visible context there. The auxiliary call is
 * a hand-built `ctx.llm.stream()` request (no `sessionId`, no `purpose`), so it
 * cannot reach the parent conversation or the shipped title/compaction
 * consumers.
 *
 * Subagent sessions are skipped by default. The handoff agent is itself a
 * subagent, so without that guard its own `turn/end` would trigger another
 * handoff forever.
 *
 * @module dsh-auto-summary
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import { Config, type AutoSummaryConfig } from './config.js';
/** Loader-validated configuration schema; re-exported as the plugin's `Config`. */
export { Config };
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "auto-summary";
/** Services this plugin reads; the fiber waits until all of them exist. */
export declare const inject: string[];
/**
 * Whether a session belongs to a delegated child agent.
 *
 * Root-mounted plugins observe every live session, including subagent children,
 * so the handoff trigger must reject them explicitly. The same predicate the
 * shipped workspace-changes plugin uses: a durable `origin` marker or any
 * positive delegation depth.
 *
 * @param session - the session whose header is inspected.
 * @returns `true` for subagent child sessions.
 */
export declare function isSubagentSession(session: Session): boolean;
/**
 * Mount the plugin: observe completed turns, gate them through the trigger
 * ledger, and run one pass at a time per session.
 *
 * @param ctx - plugin context carrying every {@link inject}ed service.
 * @param rawConfig - schema-validated plugin configuration.
 */
export declare function apply(ctx: Context, rawConfig: AutoSummaryConfig): void;
