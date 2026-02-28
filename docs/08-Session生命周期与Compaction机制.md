# 08 - Session 生命周期与 Compaction 机制

## 目录

1. [概览](#1-概览)
2. [数据库 Schema](#2-数据库-schema)
3. [Message V2 Part 类型系统](#3-message-v2-part-类型系统)
4. [ToolPart 状态机](#4-toolpart-状态机)
5. [Session CRUD 与消息存储](#5-session-crud-与消息存储)
6. [SessionPrompt — 主控制面](#6-sessionprompt-主控制面)
7. [SessionProcessor — 核心流式循环](#7-sessionprocessor-核心流式循环)
8. [Doom Loop 检测](#8-doom-loop-检测)
9. [LLM 流式集成 llm.ts](#9-llm-流式集成-llmts)
10. [Compaction 上下文压缩](#10-compaction-上下文压缩)
11. [工具输出裁剪 prune()](#11-工具输出裁剪-prune)
12. [Retry 重试机制](#12-retry-重试机制)
13. [Revert 消息级撤销](#13-revert-消息级撤销)
14. [SessionSummary Git 差异统计](#14-sessionsummary-git-差异统计)
15. [完整数据流图](#15-完整数据流图)
16. [关键架构洞察](#16-关键架构洞察)

---

## 1. 概览

Session 系统是 OpenCode 的核心编排层，位于 `packages/opencode/src/session/`，共 **~5,751 行** TypeScript，15 个文件。它管理：

- LLM 对话的完整生命周期
- 消息持久化（12+ 种 Part 类型）
- 流式处理与工具调度
- 上下文窗口压缩（Compaction）
- 工具输出裁剪（Prune）
- 消息级撤销（Revert）+ Git 快照
- 重试与错误恢复

### 文件概览

| 文件 | 行数 | 职责 |
|------|------|------|
| `prompt.ts` | 1,959 | **主控制面**：消息路由、prompt 构建、流式编排 |
| `message-v2.ts` | 899 | Message/Part 类型系统 |
| `index.ts` | 877 | Session CRUD、消息存储、SQL 查询 |
| `processor.ts` | 421 | 流处理、工具调度、doom-loop 检测 |
| `compaction.ts` | 261 | 上下文窗口总结 |
| `summary.ts` | 161 | Git diff 统计 |
| `revert.ts` | 138 | 消息级撤销 + Git 快照 |
| `retry.ts` | 101 | 指数退避 + header 感知延迟 |
| `session.sql.ts` | 88 | Drizzle schema |
| `status.ts` | 76 | Session 忙碌/空闲状态 |
| `todo.ts` | 56 | Session 内 Todo 管理 |
| `llm.ts` | — | LLM 流式集成 |
| `instruction.ts` | — | 指令文件发现 |
| `system.ts` | — | Provider 特定系统提示词 |
| `message.ts` | — | 遗留 V1 消息格式 |

---

## 2. 数据库 Schema

**文件**: `session/session.sql.ts` (88 行)

### SessionTable

```
id (PK), project_id (FK→ProjectTable, CASCADE), parent_id (FK self-ref),
slug, directory, title, version, share_url,
summary_additions / summary_deletions / summary_files (integer),
summary_diffs (JSON: FileDiff[]),
revert (JSON: { messageID, partID?, snapshot?, diff? }),
permission (JSON: PermissionNext.Ruleset),
time_created / time_updated, time_compacting, time_archived
```

- `parent_id` 用于子 session（TaskTool 创建）
- `revert` 存储待撤销状态
- `permission` 存储 session 级权限覆盖

### MessageTable

```
id (PK), session_id (FK→SessionTable, CASCADE),
time_created / time_updated,
data (JSON: InfoData)  — role, time, model, agent, error, tokens, cost 等
```

### PartTable

```
id (PK), message_id (FK→MessageTable, CASCADE), session_id,
time_created / time_updated,
data (JSON: PartData)  — Part 类型和类型特定载荷
```

索引：`message_id` 和 `session_id` 双索引。

### TodoTable

```
(session_id, position) 复合主键, content, status, priority
```

### PermissionTable

```
project_id (PK), data (JSON: PermissionNext.Ruleset)
```

---

## 3. Message V2 Part 类型系统

**文件**: `session/message-v2.ts` (899 行)

每条消息由类型化的 Part 组成，所有 Part 的基础字段：`{ id, sessionID, messageID }`。

### 12 种 Part 类型

| # | 类型 | 关键字段 | 用途 |
|---|------|---------|------|
| 1 | **TextPart** | `text, synthetic?, ignored?, time?` | LLM 文本输出。`synthetic` = 程序注入，`ignored` = 排除在 LLM 消息外 |
| 2 | **ReasoningPart** | `text, metadata?, time:{start,end?}` | 推理模型的思维链输出 |
| 3 | **FilePart** | `mime, filename?, url, source?` | 文件附件。source 子类型：`FileSource`, `SymbolSource`, `ResourceSource` |
| 4 | **ToolPart** | `callID, tool, state: ToolState, metadata?` | 工具调用（4 态状态机，见下节） |
| 5 | **StepStartPart** | `snapshot?` | Agent 步骤开始标记，`snapshot` = Git hash |
| 6 | **StepFinishPart** | `reason, snapshot?, cost, tokens:{...}` | 步骤结束 + token 计费 |
| 7 | **SnapshotPart** | `snapshot: string` | Git 快照引用 |
| 8 | **PatchPart** | `hash: string, files: string[]` | 步骤中变更的文件记录（用于 revert） |
| 9 | **AgentPart** | `name: string, source?` | 用户通过 `@name` 显式调用 Agent |
| 10 | **CompactionPart** | `auto: boolean` | 请求压缩标记；`auto = true` 表示溢出自动触发 |
| 11 | **SubtaskPart** | `prompt, description, agent, model?, command?` | 待处理子 Agent 任务 |
| 12 | **RetryPart** | `attempt, error: APIError, time:{created}` | 重试事件记录 |

### 消息类型

**User 消息**：
```typescript
{
  role: "user", id, sessionID,
  time: { created },
  format?,        // OutputFormatText | OutputFormatJsonSchema
  summary?,       // 标题、正文、diffs
  agent,          // 当前使用的 agent 名
  model: { providerID, modelID },
  system?,        // 额外系统提示词
  tools?,         // 工具覆盖（已弃用）
  variant?        // 推理努力级别
}
```

**Assistant 消息**：
```typescript
{
  role: "assistant", id, sessionID,
  parentID, modelID, providerID, agent,
  path: { cwd, root },
  summary?,      // true = 这是一条压缩总结消息
  cost, tokens: { total?, input, output, reasoning, cache: { read, write } },
  structured?,   // 结构化输出的 JSON 值
  finish?,       // "stop" | "tool-calls" | "length" 等
  error?,        // 类型化错误联合体
  time: { created, completed? }
}
```

### `toModelMessages()` — Part 到 AI SDK 消息的转换

关键逻辑：
- **跳过** 0 个 Part 的消息
- User 消息：`text`（非 ignored）, `file`, `compaction` → `"What did we do so far?"`, `subtask` → `"The following tool was executed by the user"`
- Assistant 消息：跳过有错误的消息（除非是 AbortedError 且有实际内容）
- **ToolPart** 状态转换：
  - `completed` → output
  - `error` → errorText
  - `pending/running` → `"[Tool execution was interrupted]"`（防止悬挂的 tool_use 块）
- **已压缩的工具输出**：`state.time.compacted` 已设置时 → `"[Old tool result content cleared]"`
- **跨 provider 媒体处理**：支持原生 tool result 中的媒体附件（Anthropic, OpenAI, Bedrock, Gemini 3.x），其他 provider 提取图片/PDF 并注入合成 user 消息

---

## 4. ToolPart 状态机

```
   (无 part)
      │
      ▼ [tool-input-start]
   ┌──────────┐
   │ pending  │ {input:{}, raw:""}
   └──────────┘
      │
      ▼ [tool-call]
   ┌──────────┐
   │ running  │ {input:parsed, time:{start}}
   └──────────┘
      │
      ├─────────────────────┐
      ▼ [tool-result]       ▼ [tool-error 或 abort]
   ┌──────────┐          ┌──────────┐
   │completed │          │  error   │
   └──────────┘          └──────────┘
   {output, title,       {error:string,
    metadata, time:       time:{start,end}}
    {start,end},
    attachments?}
```

- `pending` → `running`：LLM 发出完整的工具调用参数
- `running` → `completed`：工具正常执行完毕
- `running` → `error`：工具抛出异常，或被 abort / permission rejected
- `pending/running` → `error`：流式中断后的清理（设置 `"Tool execution aborted"`）

---

## 5. Session CRUD 与消息存储

**文件**: `session/index.ts` (877 行)

### Session 生命周期函数

| 函数 | 用途 |
|------|------|
| `Session.create(input?)` | 创建新 session；自动 share 如果配置了 `auto` |
| `Session.createNext(input)` | 实际创建：生成**降序 ID**（最新排在前面）、创建 Slug |
| `Session.fork({sessionID, messageID?})` | 克隆消息/Part 到新 session（分支对话） |
| `Session.get(sessionID)` | 读取单个 session |
| `Session.touch(sessionID)` | 更新 `time_updated` |
| `Session.share(sessionID)` | 推送到云分享服务 |
| `Session.remove(sessionID)` | 递归删除子 session + unshare + CASCADE 删除 |
| `Session.list(input?)` | 当前项目 sessions，支持目录/日期/搜索过滤，上限 100 |
| `Session.listGlobal(input?)` | 跨项目列表，支持游标分页 |
| `Session.children(parentID)` | 直接子 session 列表 |

### 消息/Part I/O

| 函数 | 行为 |
|------|------|
| `Session.updateMessage(msg)` | UPSERT + 发布 `MessageV2.Event.Updated` |
| `Session.removeMessage(...)` | 删除 + CASCADE + 发布 `Removed` |
| `Session.updatePart(part)` | UPSERT + 发布 `PartUpdated` |
| `Session.removePart(...)` | 删除 + 发布 `PartRemoved` |
| `Session.updatePartDelta(...)` | **仅 Bus 事件**（无 DB 写入）用于实时流式 |
| `Session.messages({sessionID})` | 调用 `MessageV2.stream()` 收集 + 反转为时间序 |

### Token 计费

`Session.getUsage()` 从 Vercel AI SDK usage 计算费用：
- **Anthropic 特殊处理**：`inputTokens` 不含缓存 token，与 OpenRouter/OpenAI 惯例不同
- 支持 `experimentalOver200K` 定价层级
- 使用 `Decimal.js` 确保浮点精度

### Session ID 设计

Session ID 使用 **降序 ULID**（`Identifier.descending`），`ORDER BY id DESC` 自然将最新 session 排在前面。Message ID 使用**升序 ULID**，按时间顺序排列。

---

## 6. SessionPrompt — 主控制面

**文件**: `session/prompt.ts` (1,959 行)

这是整个系统中最核心、最长的文件。

### 状态管理

```typescript
// 每 session 一个 AbortController + 等待队列
const state: Record<string, {
  abort: AbortController,
  callbacks: { resolve, reject }[]
}> = {}
```

### `SessionPrompt.prompt(input)` — 公开入口

```
1. 获取 session，调用 SessionRevert.cleanup() 应用待撤销操作
2. createUserMessage(input) 持久化用户消息和 Part
3. Session.touch(sessionID)
4. 处理遗留 tools → permissions 转换
5. noReply === true → 立即返回消息
6. 否则 → 调用 loop()
```

### `SessionPrompt.loop()` — 外层无限循环

```python
abort = start(sessionID)   # 创建 AbortController
if session 已在运行: return Promise（排队回调）

using _ = defer(() => cancel(sessionID))  # 退出时清理

while (true):
    SessionStatus.set("busy")
    if abort.aborted: break

    msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

    # 查找 lastUser, lastAssistant, lastFinished
    # 收集待处理任务 (compaction/subtask part)

    # 退出条件：assistant 已完成且其 ID > lastUser 的 ID
    if lastAssistant.finish 且 finish 不在 ["tool-calls","unknown"]
       且 lastUser.id < lastAssistant.id:
        break

    step++
    if step == 1: ensureTitle(...)   # 异步标题生成，不阻塞

    model = Provider.getModel(lastUser.model)

    task = tasks.pop()   # LIFO 获取下一个待处理任务

    # --- Subtask 处理 ---
    if task?.type == "subtask":
        # 创建 assistant message + ToolPart(running)
        # 执行 TaskTool.execute()
        # 更新 ToolPart → completed/error
        continue

    # --- Compaction 处理 ---
    if task?.type == "compaction":
        result = SessionCompaction.process(...)
        if result == "stop": break
        continue

    # --- 溢出自动检测 ---
    if lastFinished 且 非 summary 且 isOverflow:
        SessionCompaction.create({auto: true})
        continue

    # --- 正常 LLM 处理 ---
    agent = Agent.get(lastUser.agent)
    maxSteps = agent.steps ?? Infinity
    isLastStep = step >= maxSteps

    msgs = insertReminders({messages, agent, session})

    processor = SessionProcessor.create(...)
    tools = resolveTools({agent, session, model, ...})

    # 结构化输出模式
    if format.type == "json_schema":
        tools["StructuredOutput"] = createStructuredOutputTool(...)

    # 中途用户消息 → <system-reminder> 包装
    if step > 1 且有新用户消息: 包装为提醒

    system = [SystemPrompt.environment(model), ...InstructionPrompt.system()]

    result = processor.process({
        messages: [...toModelMessages(msgs), ...(isLastStep ? [MAX_STEPS] : [])],
        tools, model, ...
    })

    if structuredOutput: break
    if result == "stop": break
    if result == "compact": SessionCompaction.create({auto: true}); continue

# 循环结束后：
SessionCompaction.prune({sessionID})   # 裁剪旧工具输出
# 返回最后的 assistant message
```

### `createUserMessage(input)` — 用户消息创建

处理每个输入 Part：
- `type:"file"` + MCP resource → 读取 + 转为合成 text part
- `type:"file"` + `data:text/plain` → 注入合成 read tool 模拟
- `type:"file"` + `file:text/plain` → 调用 `ReadTool.execute()` + 注入结果
- `type:"file"` + 目录 → 调用 `ReadTool.execute()` 目录列表
- `type:"file"` + 其他 MIME → 读取字节 → base64 URL
- `type:"agent"` → 保留 + 注入 "Use the above message... call the task tool with subagent: <name>"

触发 Plugin `"chat.message"` 钩子，持久化消息和 Part。

### `resolveTools(input)` — 工具集组装

```
1. 遍历 ToolRegistry.tools(model, agent) — 内置工具
2. 对每个：ProviderTransform.schema() 转换 JSON schema
3. 包装 execute + Plugin 钩子
4. 遍历 MCP.tools() — MCP 服务器工具
5. MCP 工具：包装 + Permission.ask() + Truncate.output()
6. 合并返回 Record<string, AITool>
```

### `insertReminders()` — Plan/Build 模式切换提醒

- 非实验模式：plan agent → 追加 `PROMPT_PLAN` 文本；plan→build 切换 → 追加 `BUILD_SWITCH`
- 实验模式：
  - plan→build 切换：读取 plan 文件，追加路径信息
  - 进入 plan 模式：注入 70+ 行 `<system-reminder>` 描述 5 阶段工作流
  - 同一 agent 内无变更

---

## 7. SessionProcessor — 核心流式循环

**文件**: `session/processor.ts` (421 行)

### 私有状态

```typescript
toolcalls: Record<string, ToolPart>   // 进行中的工具调用
snapshot: string | undefined          // 当前步骤的 Git 快照 hash
blocked: boolean                      // 工具被拒绝时设置
attempt: number                       // 重试计数
needsCompaction: boolean              // 检测到 token 溢出
```

### `processor.process()` 完整流程

```
while (true):
  try:
    stream = LLM.stream(streamInput)
    for await (value of stream.fullStream):
      abort.throwIfAborted()

      switch (value.type):
        "start"          → SessionStatus.set("busy")
        "reasoning-start"→ 创建 ReasoningPart，持久化
        "reasoning-delta"→ 累积 text，发射 PartDelta Bus 事件
        "reasoning-end"  → trimEnd()，设置结束时间，持久化
        "tool-input-start"→ 创建 ToolPart("pending")
        "tool-call"      → 转为 "running"，检查 doom-loop
        "tool-result"    → 转为 "completed" + output/attachments
        "tool-error"     → 转为 "error"；如果 Rejected → blocked=true
        "error"          → 抛出 value.error
        "start-step"     → Git 快照 + StepStartPart
        "finish-step"    → 计算 usage + StepFinishPart + PatchPart + 溢出检查
        "text-start"     → 创建 TextPart（内存中）
        "text-delta"     → 累积 + PartDelta 事件
        "text-end"       → trimEnd() + Plugin 钩子 + 持久化

      if needsCompaction: break   # 退出内层循环

  catch (e):
    error = MessageV2.fromError(e)
    retry = SessionRetry.retryable(error)
    if retry 存在:
      attempt++
      delay = SessionRetry.delay(attempt, ...)
      SessionStatus.set("retry", {...})
      await SessionRetry.sleep(delay, abort)
      continue    # 重试

    # 不可重试：存储错误，设置 idle

  # 内层循环退出后的清理：
  # 1. 如果快照仍打开（中途中断），为变更文件创建 PatchPart
  # 2. 将所有 pending/running 的 ToolPart → "error" + "Tool execution aborted"
  # 3. 设置 assistantMessage.time.completed

  if needsCompaction: return "compact"
  if blocked: return "stop"
  if error: return "stop"
  return "continue"
```

---

## 8. Doom Loop 检测

### 阈值

```typescript
const DOOM_LOOP_THRESHOLD = 3
```

### 检测逻辑

在每个 `tool-call` 事件之后：

1. 获取当前 assistant 消息的所有 Part
2. 取最后 3 个 Part：`parts.slice(-DOOM_LOOP_THRESHOLD)`
3. 检查是否**全部**满足：
   - 同一 `tool` 名称
   - 非 `pending` 状态
   - 完全相同的 `JSON.stringify(input)`
4. 如果 3 个连续的相同工具调用 → 触发权限检查：

```typescript
PermissionNext.ask({
  permission: "doom_loop",
  patterns: [toolName],
  always: [toolName],
  ...
})
```

用户在 UI 中看到提示，可以选择允许继续或拒绝。

---

## 9. LLM 流式集成 llm.ts

**文件**: `session/llm.ts`

### System Prompt 组装

```
agent.prompt  (如果 agent 有自己的 prompt)
  OR
SystemPrompt.provider(model)  (否则使用 provider 特定 prompt)
  +
input.system  (每次调用的系统附加)
  +
input.user.system  (每消息的系统附加)
```

用 `\n` 连接。Plugin `"experimental.chat.system.transform"` 可修改。

### Model Option 合并顺序（后者覆盖前者）

```
ProviderTransform.options(base)
  → mergeDeep(model.options)
  → mergeDeep(agent.options)
  → mergeDeep(variant)
```

### 关键特性

- **LiteLLM 兼容**：如果检测到 LiteLLM 代理，且历史有工具调用但当前工具列表为空 → 注入 `_noop` 占位工具
- **工具名修复**：`experimental_repairToolCall` 回调先尝试大小写不敏感查找，否则路由到 `"invalid"` 工具
- **Codex 模式**：system prompt 通过 `options.instructions` 传递（非标准的 system 字段）

---

## 10. Compaction 上下文压缩

**文件**: `session/compaction.ts` (261 行)

### 何时触发 — `isOverflow()`

```typescript
if config.compaction?.auto === false: return false
if model.limit.context === 0: return false

count = tokens.total || (tokens.input + tokens.output + tokens.cache.read + tokens.cache.write)
reserved = config.compaction?.reserved ?? min(20_000, maxOutputTokens(model))
usable = model.limit.input
  ? model.limit.input - reserved
  : model.limit.context - maxOutputTokens(model)

return count >= usable
```

**COMPACTION_BUFFER** = 20,000 tokens，可通过 `config.compaction.reserved` 配置。

### 压缩过程 — `process()`

```
1. 获取 "compaction" agent（可有自己的 model）
2. 创建 assistant 消息 { summary: true, agent: "compaction" }
3. 创建 SessionProcessor
4. 触发 Plugin "experimental.session.compacting" 钩子
5. 默认 prompt 要求结构化总结：
   - Goal（目标）
   - Instructions（用户指令）
   - Discoveries（发现）
   - Accomplished（已完成）
   - Relevant Files（相关文件）
6. processor.process() 执行压缩
7. 如果 auto=true 且成功 → 创建合成 user 消息：
   "Continue if you have next steps, or stop and ask for clarification..."
8. 发布 Event.Compacted Bus 事件
```

### Compaction 边界

`MessageV2.filterCompacted()` 的查找逻辑：

在消息流中反向搜索，找到最新的 **compaction 边界**：一个 `summary:true` 的 assistant 消息，其 `parentID` 对应的 user 消息包含 `compaction` Part。边界之前的所有内容从 LLM 上下文中排除。

---

## 11. 工具输出裁剪 prune()

### 常量

```typescript
PRUNE_MINIMUM = 20_000    // tokens（低于此不值得裁剪）
PRUNE_PROTECT = 40_000    // tokens（始终保留最近 40K token 的工具输出）
PRUNE_PROTECTED_TOOLS = ["skill"]   // 永不裁剪 skill 工具输出
```

### 算法

在每次 loop 结束后运行：

```
1. 从最新消息反向遍历
2. 跳过直到看到至少 2 个 user turn
3. 到达 summary:true 的 assistant 消息时停止（compaction 边界）
4. 对每个 completed 的 ToolPart（未压缩、非 protected tool）：
   累加 token 估计
5. 累计超过 PRUNE_PROTECT 后：标记为 toPrune
6. 如果总裁剪量 > PRUNE_MINIMUM：
   设置 part.state.time.compacted = Date.now()
   持久化变更
```

被裁剪的工具输出在后续 LLM 消息中显示为 `"[Old tool result content cleared]"`。

---

## 12. Retry 重试机制

**文件**: `session/retry.ts` (101 行)

### 延迟计算

```typescript
RETRY_INITIAL_DELAY = 2000    // 2 秒基础
RETRY_BACKOFF_FACTOR = 2      // 每次翻倍
RETRY_MAX_DELAY_NO_HEADERS = 30_000   // 无 header 时 30 秒上限
RETRY_MAX_DELAY = 2_147_483_647      // 有 header 时约 24.8 天上限
```

优先级：
1. `retry-after-ms` header → 毫秒值（无 30s 上限）
2. `retry-after` header → 秒值或 HTTP 日期格式
3. 有 headers 但无 retry-after → `INITIAL * BACKOFF^(attempt-1)`（无上限）
4. 无 headers → `min(INITIAL * BACKOFF^(attempt-1), 30_000)`

### 可重试判定

| 错误类型 | 是否重试 | 说明 |
|---------|---------|------|
| `ContextOverflowError` | **否** | 永不重试 |
| `APIError` + `isRetryable === false` | **否** | — |
| `APIError` + `FreeUsageLimitError` | **否** | 返回升级链接消息 |
| `APIError` + "Overloaded" | **是** | "Provider is overloaded" |
| `APIError` + 其他 | **是** | 使用错误消息 |
| JSON 中 `code.includes("rate_limit")` | **是** | — |
| JSON 中 `code.includes("exhausted")` | **是** | — |

---

## 13. Revert 消息级撤销

**文件**: `session/revert.ts` (138 行)

### `SessionRevert.revert(input)`

```
1. 断言 session 非忙碌
2. 获取所有消息
3. 正向遍历，收集 revert 点之后的 PatchPart
4. 确定 revert 目标：
   - 整条消息撤销 → revert.messageID = lastUser.id
   - 部分撤销（特定 partID）→ 检查是否有可用 Part 保留
5. 取新的 Git 快照（或复用 session.revert.snapshot）
6. 反向应用补丁：Snapshot.revert(patches)
7. 计算 diff：Snapshot.diff(snapshot)
8. 存储 revert 状态到 DB
```

### `SessionRevert.unrevert(input)`

取消待处理的 revert：恢复快照 + 清除 DB 中的 revert 字段。

### `SessionRevert.cleanup(session)`

在每次新 prompt **开始时**调用（非 revert 操作本身）：

```
读取 session.revert.messageID 作为截止点
- 截止点前的消息：保留
- 截止点消息：
  - 无 partID → 删除
  - 有 partID → 保留到该 part，之后的 Part 删除
- 截止点后的消息：全部删除
清除 session.revert 字段
发布 Removed/PartRemoved 事件
```

**设计要点**：Revert 是**非破坏性的**，直到 cleanup 运行才实际删除数据。这允许 `unrevert()` 在任何时刻取消。

---

## 14. SessionSummary Git 差异统计

**文件**: `session/summary.ts` (161 行)

### `summarize(input)`

并行运行两个统计：

1. **`summarizeSession()`** — 扫描所有消息找到最早 `StepStartPart` snapshot 和最晚 `StepFinishPart` snapshot，调用 `Snapshot.diffFull(from, to)` 获取文件级 diff 统计，存储到 session 和 Storage
2. **`summarizeMessage()`** — 仅计算单个 user turn 的 diffs，存储到 user message 的 `summary.diffs`

### Git 路径反转义

`unquoteGitPath()` 处理 Git 对非 ASCII 文件名的八进制转义（如 `"\303\251t\303\251"` → `"été"`）。

---

## 15. 完整数据流图

```
User 输入
  │
  ▼
SessionPrompt.prompt()
  │
  ├── SessionRevert.cleanup()        ← 应用待撤销操作
  ├── createUserMessage()             ← 持久化 User Message + Parts
  ├── Session.touch()
  │
  ▼
SessionPrompt.loop()
  │
  ├── MessageV2.filterCompacted()    ← 获取 compaction 边界后的消息
  │
  ├─ [溢出检测] → SessionCompaction.create() → continue
  ├─ [subtask]  → TaskTool.execute()           → continue
  ├─ [compaction] → SessionCompaction.process() → continue
  │
  ├── insertReminders()               ← Plan/Build 模式切换
  ├── SessionProcessor.create()        ← 新建 assistant message
  ├── resolveTools()                   ← 内置 + MCP 工具
  │
  ▼
SessionProcessor.process()
  │
  ├── LLM.stream()                    ← Vercel AI SDK streamText
  │   │
  │   ├── for await stream.fullStream:
  │   │   ├── text-*/reasoning-*/tool-*/step-*/finish-*
  │   │   ├── Session.updatePart()    ← DB + Bus 事件
  │   │   ├── doom-loop 检查 @ tool-call
  │   │   └── isOverflow 检查 @ finish-step
  │   │
  │   └── [可重试错误] → sleep → 重试
  │
  ├── return "continue" | "stop" | "compact"
  │
  ▼
[compact] → SessionCompaction.create() → continue
[stop/error] → break
  │
  ▼
SessionCompaction.prune()             ← 裁剪旧工具输出
  │
  ▼
返回最后的 assistant message
```

---

## 16. 关键架构洞察

### 1. PartDelta vs PartUpdated

文本和推理的流式传输使用轻量级 `PartDelta` 事件（仅 Bus 事件，无 DB 写入）。完整 Part 在 `text-end` / `reasoning-end` 时才持久化。这避免了流式传输期间的过度 DB 写入。

### 2. 任务队列是 LIFO

`tasks` 收集 compaction 和 subtask Part，通过 `tasks.pop()` LIFO 处理，每次循环迭代处理一个。

### 3. 结构化输出模式

当 `format.type === "json_schema"` 时：
- 注入 `StructuredOutput` 工具
- 设置 `toolChoice: "required"`
- 通过闭包捕获验证后的 JSON
- 如果 LLM 完成却没调用它 → `StructuredOutputError`

### 4. Session 忙碌锁定

`SessionPrompt.loop()` 通过 `start(sessionID)` 获取锁。如果 session 已在运行，新的调用者被加入 `callbacks` 队列，等待完成后被 resolve。这防止同一 session 的并发处理。

### 5. 压缩后自动恢复

压缩完成后如果 `auto === true`（溢出触发），系统自动创建合成 user 消息 "Continue if you have next steps..."，让 agent 自动恢复原任务而不是停滞。

### 6. Plugin 钩子无处不在

Session 系统在几乎每个关键边界都有 Plugin 钩子：
- `chat.message` — 用户消息创建
- `chat.params` / `chat.headers` — LLM 调用参数
- `tool.execute.before` / `after` — 工具执行前后
- `experimental.chat.system.transform` — 系统提示词
- `experimental.chat.messages.transform` — 消息序列
- `experimental.session.compacting` — 压缩上下文注入
- `experimental.text.complete` — 文本生成完毕
- `shell.env` — Bash 环境变量
- `command.execute.before` — 命令执行前
