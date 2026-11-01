# dsh-auto-summary

一个面向 **DeepSeek Harness（DSH）** 的第三方插件包（bundle）：在 agent 每次工作
（回合）结束时检查 token 用量，当会话累计用量超过阈值时，用一次辅助模型调用生成
交接总结，并**新建一个 agent**，把总结作为它的初始提示词发送出去。

总结中**始终包含会话最初的那条用户提示词**（逐字引用），保证接手的 agent 不会丢掉
原本的任务。

- 不修改 DSH 源码：以外部 bundle 形式发布（`dsh.bundle.patch`）。
- 不污染原会话：不追加任何会话事件，不做上下文压缩。
- 防止递归：交接 agent 属于 subagent，子会话默认不触发。
- 失败可恢复：总结或创建失败只记录日志，下个回合自动重试。

---

## 功能特性

| | |
|---|---|
| **回合结束触发** | 监听 `session/event` 中的 `turn/end`，即每个工作回合结束后检查。 |
| **Token 阈值** | 默认 **1,000,000**，基于会话持久化日志计算。 |
| **两种度量** | `total`（累计计费 token，默认）或 `context`（当前上下文压力）。 |
| **保证带首次提示词** | 从 DSH 的 `titleInput` 投影读取（压缩后仍保留），并且即使自定义模板漏写也会强制追加。 |
| **新建 agent** | 通过 `ctx.subagents.startActivation` + `spawn` provider 创建，交接总结即其首条用户消息。 |
| **不污染对话** | 总结调用是手工构造的 `ctx.llm.stream()` 请求，不带会话 id、不带 purpose。 |
| **重新布防而非刷屏** | 成功一次后阈值上移一个 `thresholdTokens`：长会话每多消耗一个阈值才交接一次，而不是每个回合都触发。 |
| **预演模式** | `dryRun: true` 只记录日志，不调用模型、不创建 agent。 |

## 运行要求

- DSH `0.2.1-rc.5`（通过 `engines.dsh: ^0.2.1-rc.5` 声明兼容性）。
- Profile 需要挂载插件依赖的服务；官方 `dsh-base` + `dsh-web-app` 组合默认已包含：
  `agents`、`llm`、`sessionProjections`、`subagents`、`tokenMeter`。
- 需要已注册的 subagent provider：基础 profile 自带 `spawn`，也是默认值。
- 总结调用需要可用的 provider/model 路由：默认复用会话最近一次
  `request/header` 的路由，也可通过 `summary.provider` / `summary.model` 显式指定。

## 安装

### 从 GitHub 安装（推荐）

在 DSH Web 界面打开 **Plugins** 页面，把本仓库作为 bundle 安装；或让 agent 调用
`plugin_manager` 的 `install_bundle`：

```text
git+https://github.com/your-name/dsh-auto-summary.git
```

需要锁定版本时使用提交 SHA：

```text
git+https://github.com/your-name/dsh-auto-summary.git#<40 位 commit sha>
```

仓库**有意提交了构建产物 `lib/`**：DSH 以 git 依赖方式安装第三方插件，而包管理器会
阻止依赖的构建脚本执行，因此仓库必须自带可运行的 ESM 构建结果。

安装后该 bundle 会出现在 profile 的 `dsh.profile.bundles` 列表中，并挂载
`auto-summary` 行。若 Plugins 页面提示需要重启，请重启应用。

### 本地开发链接

```sh
# 在本仓库源码目录执行（CLI 管理操作需要先退出 DSH 应用）：
dsh plugin --profile desktop add /本机绝对路径/dsh-auto-summary
```

也可以在 Plugins 页面安装 `link:/本机绝对路径/dsh-auto-summary`。
`lib/` 的改动会在下一次组合（重启，或在启用 HMR 时切换 bundle）后生效。

### 卸载

在 Plugins 页面移除，或使用 CLI：

```sh
dsh plugin --profile desktop remove dsh-auto-summary
```

## 配置

所有字段都有默认值，因此 bundle 无配置也能直接挂载。需要定制时，在 **profile 自己的**
`cordis.patch.yml` 中重新声明该行（该层在本 bundle 层之后应用）：

```yaml
- id: auto-summary
  config:
    thresholdTokens: 1000000
    metric: total
    summary:
      provider: deepseek
      model: deepseek-chat
    handoff:
      delivery: parent
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `thresholdTokens` | `1000000` | 触发一次总结/交接的用量阈值，最小 1000。 |
| `metric` | `total` | `total`：累计计费 token（`tokenUsage` 投影）；`context`：当前请求压力（`ctx.tokenMeter.measure`）。 |
| `onlyCompletedTurns` | `true` | 仅在 `turn/end` 原因为 `completed` 时触发。 |
| `summarizeSubagentSessions` | `false` | 保持关闭，避免交接 agent 再次触发交接。 |
| `maxConsecutiveFailures` | `3` | 连续失败多少次后消费当前阈值（不再每回合重试）；`0` 表示一直重试。 |
| `dryRun` | `false` | 只记录将要做的事，不调用模型、不创建 agent。 |
| `summary.provider` / `summary.model` | `''` | 总结调用的显式路由；要么都设置，要么都留空（留空表示继承会话最近路由）。 |
| `summary.maxInputChars` | `48000` | 渲染出的对话记录字符上限。 |
| `summary.maxOutputTokens` | `4096` | 总结调用的输出上限。 |
| `summary.timeoutMs` | `120000` | 总结调用超时时间（毫秒）。 |
| `handoff.provider` | `spawn` | 用于创建新 agent 的 subagent provider。 |
| `handoff.delivery` | `parent` | `parent`：原 agent 会收到新 agent 的完成通知；`caller`：只在本插件内静默执行。 |
| `handoff.labelPrefix` | `handoff` | 新 agent 在 catalog 中的标签前缀。 |
| `handoff.promptTemplate` | 内置模板 | 交接任务模板，支持下列占位符。 |

### 模板占位符

| 占位符 | 替换内容 |
|---|---|
| `{{firstPrompt}}` | 会话最初的用户提示词（逐字）。 |
| `{{summary}}` | 模型生成的交接总结。 |
| `{{sessionId}}` | 被总结的会话 id。 |
| `{{turn}}` | 触发交接的回合号。 |
| `{{reason}}` | `turn/end` 的原因（默认 `completed`）。 |

如果自定义模板漏写 `{{firstPrompt}}` 或 `{{summary}}`，插件会自动追加对应小节，
确保新 agent 一定拿到首次提示词与总结。

## 工作原理

```text
session/event ──► 是否为 turn/end？
                   │
                   ├─ 只处理正常完成；跳过 subagent 子会话
                   ▼
          读取 token 用量（tokenUsage 投影或 tokenMeter.measure）
                   │
                   ├─ 低于阈值 ──► 结束
                   ▼
          TriggerLedger：同一会话同一时间只跑一次
                   │
   读取首次提示词（titleInput 投影，回退到对话历史）
   渲染对话记录（人类提示词 + assistant 文本，从新到旧）
                   │
   ctx.llm.stream({ provider, model, system, 单条 user 消息 })
                   │
   组装交接任务 = 模板 + 强制包含的首次提示词 + 总结
                   │
   ctx.subagents.startActivation({ provider: spawn, prompt: 任务 })
                   │
   账本重新布防：usage + thresholdTokens
```

1. **监听**：插件在根上下文订阅提交后的 `session/event`，能看到所有会话，但只处理
   `turn/end`。
2. **过滤**：默认跳过失败/中止的回合；跳过持久化 header 标记为 subagent 的子会话
   （`origin: 'subagent'` 或 `delegationDepth > 0`）——否则交接 agent 自己的回合会
   再次触发交接，形成无限递归。
3. **度量**：`total` 读取 `tokenUsage` 投影的 `{ totals }`（包含 cache 读写桶）；
   `context` 读取 `ctx.tokenMeter.measure(session).totalTokens`。两者都基于日志回放，
   不产生模型调用。
4. **总结**：首次提示词来自 `titleInput` 投影（压缩后仍保留第一次人类消息），
   回退到派生对话历史；对话记录只保留人类提示词与 assistant 文本，并按字符预算从新到旧
   截取。通过一次手工构造的 `ctx.llm.stream()` 得到总结；请求不带 `sessionId`、不带
   `purpose`、不带工具，因此不会影响原会话，也不会触发 DSH 的标题/压缩消费者。
5. **交接**：通过 `ctx.subagents.startActivation` 把任务作为新 agent 的初始提示词发送。
   身份、并发容量、代理深度、catalog 与结算都由 DSH 管理；插件不会调用
   `ctx.agents.create`，也不会主动销毁子 agent。
6. **重新布防**：成功后阈值变为 `本次用量 + thresholdTokens`；失败则保持阈值，在下一个
   正常回合重试。

### 成本

每跨过一次阈值产生一次总结调用（输入受 `summary.maxInputChars` 限制，输出受
`summary.maxOutputTokens` 限制），外加新 agent 自身的运行消耗。可先用
`dryRun: true` 验证触发节奏，不消耗 token。

## 开发

需要 Node.js 20+ 与 pnpm 10+。

```sh
pnpm install
pnpm run typecheck      # 对 src/ 做严格 TypeScript 检查
pnpm run build          # 生成 lib/index.js 与 lib/types/**
pnpm test               # 编译测试并用 node:test 运行
pnpm run verify         # 一次完成类型检查 + 测试
```

测试通过一个假的 Cordis 上下文（`test/helpers/host.ts`）运行，只实现插件实际读取的服务，
因此能真实覆盖 `apply()` 的装配：触发过滤、账本重新布防、总结请求形状、首次提示词保证、
递归保护、dry run 与失败重试，无需启动 DSH。

`lib/` 需要提交：git 安装无法执行构建脚本。任何源码改动都要重新构建并提交；CI 会在提交的
构建产物过期时报错。

### 目录结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | 插件入口：`name`、`inject`、`apply`、回合结束接线。 |
| `src/config.ts` | Schemastery `Config` 模式与跨字段校验。 |
| `src/ledger.ts` | 每个会话的触发状态与重新布防策略。 |
| `src/usage.ts` | token 度量策略。 |
| `src/prompt.ts` | 首次提示词提取、对话记录渲染、任务组装。 |
| `src/summary.ts` | 总结请求组装与流式结果收集。 |
| `src/handoff.ts` | subagent 激活参数与创建。 |
| `cordis.patch.yml` | 插入 `auto-summary` 行的 bundle patch。 |
| `locale/*.json` | Plugins 页面标题与描述。 |

## 发布清单

1. 把 `package.json` 的 `repository` / `homepage` / `bugs` 以及本文安装命令中的
   `your-name` 改成实际 GitHub 用户名。
2. 执行 `pnpm run verify && pnpm run build`，提交 `lib/`。
3. 打 tag 并推送：`git tag v0.1.0 && git push --tags`。
4. 可选：`npm publish` 发布到 npm（包名未加 scope 且为公开包），之后可用
   `dsh-auto-summary@0.1.0` 安装，而不必使用 git 地址。

## 已知限制

- 总结的措辞与质量取决于总结模型；插件只保证“首次提示词 + 固定结构”，不保证文风。
- 触发账本保存在进程内。重启后，累计用量已超阈值的会话会在下一个正常回合重新评估。
- 使用 `metric: context` 时，重新布防仍按累计用量计算，因此同一会话通常只会在累计用量再
  增长一个阈值后才再次因上下文压力触发。
- 新 agent 仍占用宿主机的 subagent 并发容量（`maxActiveSubagents`，默认 8）；创建被拒绝
  时会记录日志，并在下一个正常回合重试。
- 首次提示词依赖 DSH 自带的 `titleInput` 投影；若 profile 禁用了 `dsh-session-title`，
  则回退到已压缩的历史，此时首次提示词可能已被压缩掉。

## 许可证

[MIT](LICENSE)
