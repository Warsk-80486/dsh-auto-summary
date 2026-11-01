# dsh-auto-summary

A third-party **DeepSeek Harness (DSH)** bundle that watches each finished agent
turn, measures the session's token usage, and — once a session crosses a token
threshold — writes a handoff brief with one auxiliary model call and starts a
fresh agent whose initial prompt is that brief.

The summary always carries the session's **original first user prompt**, quoted
verbatim, so a continuation agent never loses the task it is continuing.

- No DSH source changes: ships as an external bundle (`dsh.bundle.patch`).
- No session mutation: the summarized conversation gets no new events and is not
  compacted.
- Recursion-safe: handoff agents are subagents, and subagent sessions are skipped.
- Fail-open: a failed summary or spawn is logged and retried on the next turn.

---

## Features

| | |
|---|---|
| **Turn-end trigger** | Runs after a `turn/end` event, i.e. after each finished piece of work. |
| **Token threshold** | Defaults to **100,000,000** tokens; measured from the durable session log. |
| **Two metrics** | `total` (cumulative provider-billed tokens, default) or `context` (current request pressure). |
| **First prompt guaranteed** | Read from DSH's `titleInput` projection (survives compaction) and force-appended to the handoff task even if a custom template omits it. |
| **Fresh agent** | Started through `ctx.subagents.startActivation` with the `spawn` provider; the brief is its first user message. |
| **No conversation pollution** | The summary call is a hand-built `ctx.llm.stream()` request with no session id and no purpose tag. |
| **Re-arm, not spam** | After a successful pass the session re-arms one threshold higher, so a long session produces one handoff per additional threshold, not one per turn. |
| **Dry run** | `dryRun: true` logs what would happen without calling the model or starting an agent. |

## Requirements

- DSH `0.2.1-rc.5` (declared through `engines.dsh: ^0.2.1-rc.5`).
- The profile must mount the services the plugin reads. The shipped
  `dsh-base` + `dsh-web-app` composition does:
  `agents`, `llm`, `sessionProjections`, `subagents`, `tokenMeter`.
- A subagent provider — `spawn` ships with the base profile and is the default.
- A routed provider/model for the summary call: the session's latest
  `request/header` route is used unless `summary.provider` / `summary.model` are
  configured.

## Install

### From GitHub (recommended)

In the DSH Web GUI, open **Plugins** and install this repository as a bundle, or
ask the agent to run `plugin_manager` with `install_bundle`:

```text
git+https://github.com/your-name/dsh-auto-summary.git
```

Pin a commit for reproducibility:

```text
git+https://github.com/your-name/dsh-auto-summary.git#<40-char-commit-sha>
```

The built ESM `lib/` is committed on purpose: DSH installs third-party bundles as
git dependencies and package managers block dependency build scripts, so the
repository must ship its build output.

After installation the bundle appears in the profile's `dsh.profile.bundles`
list and its `auto-summary` row mounts. Restart the app if the Plugins page says
a restart is required.

### Local development link

```sh
# From a source checkout of this repo (DSH app closed for CLI operations):
dsh plugin --profile desktop add /absolute/path/to/dsh-auto-summary
```

Or install `link:/absolute/path/to/dsh-auto-summary` from the Plugins page.
Changes to `lib/` are picked up at the next composition (restart, or toggling
the bundle if HMR is enabled).

### Uninstall

Remove the bundle from the Plugins page, or use the CLI:

```sh
dsh plugin --profile desktop remove dsh-auto-summary
```

## Configuration

Every field has a default, so the bundle mounts with no configuration. To
configure it, restate the row in the profile's own `cordis.patch.yml` (this layer
is applied after the bundle's):

```yaml
- id: auto-summary
  config:
    thresholdTokens: 100000000
    metric: total
    onlyCompletedTurns: true
    summarizeSubagentSessions: false
    maxConsecutiveFailures: 3
    dryRun: false
    summary:
      provider: ''
      model: ''
      maxInputChars: 48000
      maxOutputTokens: 4096
      timeoutMs: 120000
    handoff:
      provider: spawn
      delivery: parent
      labelPrefix: handoff
      promptTemplate: |
        You are a continuation agent taking over a task from an earlier DeepSeek Harness session.
        ...
        ## Original first user prompt (verbatim)
        {{firstPrompt}}
        ## Handoff summary
        {{summary}}
```

| Field | Default | Meaning |
|---|---|---|
| `thresholdTokens` | `100000000` | Usage figure at which one summary/handoff pass starts. Minimum 1000. |
| `metric` | `total` | `total`: cumulative billed tokens (`tokenUsage` projection). `context`: current request pressure (`ctx.tokenMeter.measure`). |
| `onlyCompletedTurns` | `true` | Trigger only after `turn/end` with reason `completed`. |
| `summarizeSubagentSessions` | `false` | Keep off to prevent handoff agents from triggering further handoffs. |
| `maxConsecutiveFailures` | `3` | Failed passes after which the current threshold is consumed instead of retried every turn; `0` retries forever. |
| `dryRun` | `false` | Log the pass without any model call or agent creation. |
| `summary.provider` / `summary.model` | `''` | Explicit route for the summary call; set both or neither. Empty means "inherit the session's latest request route". |
| `summary.maxInputChars` | `48000` | Character budget for the rendered transcript. |
| `summary.maxOutputTokens` | `4096` | Output ceiling for the summary call. |
| `summary.timeoutMs` | `120000` | Deadline for the summary call. |
| `handoff.provider` | `spawn` | Registered subagent provider used to start the fresh agent. |
| `handoff.delivery` | `parent` | `parent`: the original agent receives the new agent's completion notice. `caller`: fire-and-forget. |
| `handoff.labelPrefix` | `handoff` | Prefix of the catalog label recorded for the fresh agent. |
| `handoff.promptTemplate` | built-in | Continuation task template. See placeholders below. |

### Handoff template placeholders

| Placeholder | Substituted value |
|---|---|
| `{{firstPrompt}}` | The session's first direct human prompt, verbatim. |
| `{{summary}}` | The model-written handoff brief. |
| `{{sessionId}}` | The summarized session id. |
| `{{turn}}` | The turn whose completion triggered the handoff. |
| `{{reason}}` | The `turn/end` reason kind (`completed` by default). |

If a custom template omits `{{firstPrompt}}` or `{{summary}}`, the corresponding
section is appended automatically — the fresh agent can never lose them.

## How it works

```text
session/event  →  turn/end ?
                      │
                      ├─ onlyCompletedTurns / subagent guard
                      ▼
              measure usage (tokenUsage projection or tokenMeter.measure)
                      │
                      ├─ below threshold → stop
                      ▼
              TriggerLedger: one pass in flight per session
                      │
        read first prompt (titleInput projection, then history)
        render transcript (human prompts + assistant text, newest first)
                      │
        ctx.llm.stream({ provider, model, system, one user message })
                      │
        compose handoff task = template + guaranteed first prompt + summary
                      │
        ctx.subagents.startActivation({ provider: spawn, prompt: task })
                      │
        ledger re-arms at usage + thresholdTokens
```

1. **Observe.** The plugin subscribes to the post-commit `session/event` feed at
   the root context, so it sees every session. It reacts only to `turn/end`.
2. **Gate.** Failed/aborted turns are skipped by default, and sessions whose
   durable header marks them as subagent children
   (`origin: 'subagent'` or `delegationDepth > 0`) are skipped — otherwise the
   handoff agent's own turn would trigger another handoff forever.
3. **Measure.** `total` reads `{ totals }` from the `tokenUsage` session
   projection (cache-read/write buckets included); `context` reads
   `ctx.tokenMeter.measure(session).totalTokens`. Both are replay-based and make
   no model call.
4. **Summarize.** The first prompt is read from the `titleInput` projection
   (which retains the first human message across compaction), falling back to the
   derived history. The transcript keeps only direct human prompts and assistant
   text, newest-first inside the character budget. One hand-built
   `ctx.llm.stream()` call produces the brief; the request carries no
   `sessionId`, no `purpose`, and no tools, so neither the parent conversation
   nor DSH's title/compaction consumers are affected.
5. **Hand off.** The task is delivered as the fresh agent's initial prompt via
   `ctx.subagents.startActivation`. The host owns identity, capacity, delegation
   depth, cataloging, and settlement; the plugin never calls `ctx.agents.create`
   and never disposes the child.
6. **Re-arm.** A successful pass sets the next threshold to
   `observedUsage + thresholdTokens`; a failure leaves the threshold armed and is
   retried on the next completed turn.

### Cost

One summary call per threshold crossing (capped by `summary.maxOutputTokens`,
input bounded by `summary.maxInputChars`) plus the fresh agent's own run. Set
`dryRun: true` to verify the trigger cadence without spending tokens.

## Development

Requires Node.js 20+ and pnpm 10+.

```sh
pnpm install
pnpm run typecheck      # strict TypeScript over src/
pnpm run build          # emits lib/index.js + lib/types/**
pnpm test               # compiles tests and runs node:test
pnpm run verify         # typecheck + tests in one shot
```

The test suite runs against a fake Cordis context (`test/helpers/host.ts`) that
implements only the services the plugin reads, so it exercises the real
`apply()` wiring — trigger gating, ledger re-arming, the summarized request
shape, the guaranteed first prompt, recursion guard, dry run, and failure
retries — without a running DSH process.

`lib/` is committed because git installs cannot run build scripts. Rebuild and
commit it with any source change; CI fails when the committed output is stale.

### Repository layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Plugin entry: `name`, `inject`, `apply`, turn-end wiring. |
| `src/config.ts` | Schemastery `Config` schema and cross-field normalization. |
| `src/ledger.ts` | Per-session trigger state and re-arm policy. |
| `src/usage.ts` | Token measurement strategies. |
| `src/prompt.ts` | First-prompt extraction, transcript rendering, task composition. |
| `src/summary.ts` | Summary request assembly and stream collection. |
| `src/handoff.ts` | Subagent activation spec and start. |
| `cordis.patch.yml` | The bundle patch that inserts the `auto-summary` row. |
| `locale/*.json` | Plugins-page title and description. |

## Publishing

1. Replace `your-name` in `package.json` (`repository`, `homepage`, `bugs`) and
   in the install commands above.
2. `pnpm run verify && pnpm run build`, then commit `lib/`.
3. Tag a release, e.g. `git tag v0.1.0 && git push --tags`.
4. Optional: publish to npm with `npm publish` (the package is unscoped and
   public), then install with `dsh-auto-summary@0.1.0` instead of a git address.

## Limitations

- Summary quality and wording depend on the summarizer model; the original first
  prompt and the handoff structure are guaranteed by the plugin, the prose is
  not.
- The trigger ledger is process-local. After a restart, a session whose
  cumulative usage is already above a threshold is re-evaluated on its next
  completed turn.
- With `metric: context`, re-arming still uses cumulative usage, so a session
  normally receives at most one context-pressure handoff until its billed total
  grows by another threshold.
- A handoff agent still consumes the host's subagent capacity
  (`maxActiveSubagents`, default 8); a rejected activation is logged and retried
  on the next completed turn.
- The first prompt comes from the shipped `titleInput` projection. A profile that
  disables `dsh-session-title` falls back to compacted history, where an already
  compacted first prompt may no longer be present.

## License

[MIT](LICENSE)
