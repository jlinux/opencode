# Agent 系统详解：实现方式和逻辑

## 目录

1. [Agent 定义与类型系统](#1-agent-定义与类型系统)
2. [7 种内置 Agent 详解](#2-7-种内置-agent-详解)
3. [Agent 注册与加载机制](#3-agent-注册与加载机制)
4. [权限系统与 Agent 集成](#4-权限系统与-agent-集成)
5. [核心循环：SessionPrompt.loop()](#5-核心循环sessionpromptloop)
6. [SessionProcessor：流处理引擎](#6-sessionprocessor流处理引擎)
7. [LLM 调用层：LLM.stream()](#7-llm-调用层llmstream)
8. [工具解析：resolveTools()](#8-工具解析resolvetools)
9. [消息格式转换：MessageV2.toModelMessages()](#9-消息格式转换messagev2tomodelmessages)
10. [上下文压缩：Compaction](#10-上下文压缩compaction)
11. [重试与错误处理](#11-重试与错误处理)
12. [Provider 变换层](#12-provider-变换层)
13. [Plan 模式与 Agent 切换](#13-plan-模式与-agent-切换)
14. [自定义 Agent 生成](#14-自定义-agent-生成)
15. [完整数据流总结](#15-完整数据流总结)

---

## 1. Agent 定义与类型系统

**源文件**: `packages/opencode/src/agent/agent.ts`

### 1.1 Agent.Info Zod Schema

```typescript
Agent.Info = z.object({
  name: z.string(),                                    // 唯一标识符
  description: z.string().optional(),                  // 描述（何时使用）
  mode: z.enum(["subagent", "primary", "all"]),       // 运行模式
  native: z.boolean().optional(),                      // 是否内置
  hidden: z.boolean().optional(),                      // 是否隐藏
  topP: z.number().optional(),                         // 模型 topP
  temperature: z.number().optional(),                  // 模型温度
  color: z.string().optional(),                        // UI 颜色
  permission: PermissionNext.Ruleset,                  // 权限规则集
  model: z.object({                                    // 指定模型
    modelID: z.string(),
    providerID: z.string(),
  }).optional(),
  variant: z.string().optional(),                      // 模型变体
  prompt: z.string().optional(),                       // 系统提示词
  options: z.record(z.string(), z.any()),             // 额外配置
  steps: z.number().int().positive().optional(),       // 最大迭代步数
})
```

### 1.2 三种模式语义

| 模式 | 含义 | 可作为默认? | 可通过 @ 调用? |
|------|------|------------|---------------|
| `"primary"` | 主 Agent，用户直接选择 | 是 | 否 |
| `"subagent"` | 子 Agent，通过 @mention 或 task 工具调用 | 否 | 是 |
| `"all"` | 通用模式（配置文件中自定义 Agent 的默认值）| 是 | 是 |

---

## 2. 7 种内置 Agent 详解

### 2.1 build — 默认编码 Agent

```
mode: "primary"  |  native: true  |  hidden: false
```

- **用途**: 默认 Agent，执行代码修改，拥有完整工具权限
- **特殊权限**: `question: "allow"`, `plan_enter: "allow"`
- **系统提示**: 无自定义（使用 Provider 默认提示）
- **温度**: 使用模型默认值

### 2.2 plan — 只读规划 Agent

```
mode: "primary"  |  native: true  |  hidden: false
```

- **用途**: 规划模式，分析代码但**禁止编辑**
- **特殊权限**:
  - `question: "allow"`, `plan_exit: "allow"`
  - `edit`: 全部 deny，**除了** `.opencode/plans/*.md` 和相对路径的计划文件
  - `external_directory`: 允许 plan 路径
- **系统提示**: 无自定义
- **编辑限制**: `edit: { "*": "deny", ".opencode/plans/*.md": "allow" }`

### 2.3 general — 通用子 Agent

```
mode: "subagent"  |  native: true  |  hidden: false
```

- **用途**: 研究复杂问题，执行多步任务，支持并行执行
- **特殊权限**: deny `todoread`, `todowrite`
- **描述**: "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
- **系统提示**: 无自定义

### 2.4 explore — 快速探索子 Agent

```
mode: "subagent"  |  native: true  |  hidden: false
```

- **用途**: 快速搜索文件和代码
- **特殊权限**: **默认全部 deny**，仅允许:
  - `grep`, `glob`, `list`, `bash`, `webfetch`, `websearch`, `codesearch`, `read`
  - `external_directory`: 允许白名单技能目录
- **系统提示** (`prompt/explore.txt`):
  ```
  You are a file search specialist. You excel at thoroughly navigating
  and exploring codebases.

  Guidelines:
  - Use Glob for broad file pattern matching
  - Use Grep for searching file contents with regex
  - Use Read when you know the specific file path
  - Use Bash for file operations like copying, moving, listing
  - Do not create any files or run modifying bash commands
  ```

### 2.5 compaction — 上下文压缩 Agent (隐藏)

```
mode: "primary"  |  native: true  |  hidden: true
```

- **用途**: 自动摘要对话历史，释放上下文空间
- **权限**: 全部 deny（不允许使用任何工具）
- **系统提示** (`prompt/compaction.txt`):
  ```
  You are a helpful AI assistant tasked with summarizing conversations.
  Focus on:
  - What was done
  - What is currently being worked on
  - Which files are being modified
  - What needs to be done next
  - Key user requests, constraints, or preferences
  - Important technical decisions and why they were made
  ```

### 2.6 title — 标题生成 Agent (隐藏)

```
mode: "primary"  |  native: true  |  hidden: true  |  temperature: 0.5
```

- **用途**: 为 Session 生成简短标题
- **权限**: 全部 deny
- **系统提示** (`prompt/title.txt`):
  - 输出单行，≤50 字符
  - 使用用户消息的**相同语言**
  - 不包含工具名，不假设技术栈
  - 聚焦主题，保持简洁

### 2.7 summary — 摘要生成 Agent (隐藏)

```
mode: "primary"  |  native: true  |  hidden: true
```

- **用途**: 生成 Session 摘要（类似 PR 描述）
- **权限**: 全部 deny
- **系统提示** (`prompt/summary.txt`):
  ```
  Summarize what was done in this conversation. Write like a PR description.
  Rules:
  - 2-3 sentences max
  - Describe changes made, not the process
  - Write in first person (I added..., I fixed...)
  ```

---

## 3. Agent 注册与加载机制

### 3.1 初始化流程

`Agent.state()` 使用 `Instance.state()` 进行实例级缓存：

```
1. Config.get() → 加载配置
2. Skill.dirs() → 获取技能目录
3. 构建默认权限集 (defaults):
   ├─ "*": "allow"                    // 默认全部允许
   ├─ doom_loop: "ask"               // 死循环需确认
   ├─ external_directory: { "*": "ask", [skillDirs]: "allow" }
   ├─ question: "deny"               // 默认禁止提问
   ├─ plan_enter: "deny"             // 默认禁止进入 plan
   ├─ plan_exit: "deny"              // 默认禁止退出 plan
   └─ read: { "*": "allow", "*.env": "ask", "*.env.*": "ask" }
4. 构建用户权限集 (user) = fromConfig(cfg.permission)
5. 注册 7 个内置 Agent（各自合并 defaults + 特定权限 + user）
6. 加载配置中的自定义 Agent（cfg.agent）
7. 确保所有 Agent 都允许 Truncate.GLOB 路径
```

### 3.2 自定义 Agent 注册

配置文件中的 `agent` 字段：

```jsonc
{
  "agent": {
    "my-agent": {
      "model": "anthropic/claude-sonnet-4-6",
      "prompt": "You are a security expert...",
      "description": "Use this when auditing code for security issues",
      "mode": "all",
      "temperature": 0.3,
      "steps": 20,
      "permission": { "bash": "deny" }
    }
  }
}
```

处理逻辑：
- `disable: true` → 从注册表中移除该 Agent
- 如果 Agent 名已存在（如覆盖 "build"）→ 合并配置
- 如果是新 Agent → 创建默认配置（mode: "all", native: false）
- 权限逐层合并：`merge(defaults, user, agent_specific)`
- 未知 key 自动归入 `options` 对象

### 3.3 Agent 查询 API

```typescript
Agent.get(name)        // 按名称获取单个 Agent
Agent.list()           // 获取所有 Agent（按默认排序）
Agent.defaultAgent()   // 获取默认 Agent 名称
```

`Agent.defaultAgent()` 优先级：
1. `cfg.default_agent` 指定的 Agent（须非 subagent、非 hidden）
2. 第一个找到的 primary + non-hidden Agent

---

## 4. 权限系统与 Agent 集成

### 4.1 权限规则结构

```typescript
PermissionNext.Rule = {
  permission: string,   // 权限名，如 "bash", "edit", "read"
  pattern: string,      // 匹配模式，如 "*", "/src/**", "*.env"
  action: "allow" | "deny" | "ask"
}

PermissionNext.Ruleset = Rule[]  // 规则数组，最后匹配的规则生效
```

### 4.2 权限评估流程

```
PermissionNext.evaluate(permission, pattern, ...rulesets)
    ↓
合并所有 ruleset 为一个数组
    ↓
遍历所有规则，找最后一个匹配的:
  Wildcard.match(permission, rule.permission) AND
  Wildcard.match(pattern, rule.pattern)
    ↓
├─ 找到 → 返回该规则的 action
└─ 未找到 → 返回默认 { action: "ask" }
```

### 4.3 权限请求流程 (ask)

```
工具调用 ctx.ask({ permission, patterns, always, metadata })
    ↓
PermissionNext.ask():
  对每个 pattern:
    evaluate() 检查 ruleset + 已批准规则
      ├─ "allow" → 继续
      ├─ "deny" → throw DeniedError(匹配的规则)
      └─ "ask" → 创建 pending 请求
                  发布 Event.Asked
                  等待 Promise 解析
    ↓
用户收到 UI 提示:
  ├─ "once"   → 单次批准，resolve promise
  ├─ "always" → 将 patterns 加入 approved 规则集
  │              自动解析同 session 其他可覆盖的 pending 请求
  └─ "reject" → throw RejectedError
                 同时 reject 同 session 所有其他 pending 请求
```

### 4.4 工具禁用判断

`PermissionNext.disabled(tools, ruleset)`:
- 对每个工具名，找到最后匹配的规则
- 如果 `action === "deny"` 且 `pattern === "*"` → 该工具完全禁用
- 用于 `LLM.stream()` 中过滤掉不可用的工具

---

## 5. 核心循环：SessionPrompt.loop()

**源文件**: `packages/opencode/src/session/prompt.ts` (1959 行)

### 5.1 入口：SessionPrompt.prompt()

```typescript
export async function prompt(input: PromptInput): Promise<MessageV2.WithParts> {
  // 1. 获取 Session
  const session = await Session.get(input.sessionID)

  // 2. 清理 revert 状态
  await SessionRevert.cleanup(session)

  // 3. 创建用户消息（处理文件、Agent 引用、文本）
  const message = await createUserMessage(input)

  // 4. 更新 Session 时间戳
  await Session.touch(sessionID)

  // 5. 处理弃用的 tools 字段 → 转换为权限规则
  if (input.tools) {
    const ruleset = Object.entries(input.tools)
      .filter(([_, enabled]) => !enabled)
      .map(([tool]) => ({ permission: tool, action: "deny", pattern: "*" }))
    await Session.setPermission(sessionID, PermissionNext.merge(session.permission, ruleset))
  }

  // 6. 如果 noReply=true，仅保存用户消息不启动循环
  if (input.noReply === true) return message

  // 7. 进入 Agent 循环
  return loop({ sessionID })
}
```

### 5.2 用户消息创建：createUserMessage()

处理三类 Part：

**FilePart 处理**:
- MCP Resource (`mcp://`) → 从 MCP 客户端读取
- Data Protocol (`data:`) → 解析 base64
- File Protocol:
  - 文本文件 → 执行 ReadTool 读取内容
  - 目录 → 执行 ReadTool 列出目录
  - 二进制文件 → base64 编码
  - LSP Symbol → 解析行范围

**AgentPart 处理**:
- 检查 task 权限（如果 deny 则提示）
- 返回 AgentPart + 合成文本提醒

**TextPart 处理**:
- 直接返回

### 5.3 循环主体：loop()

```
loop({ sessionID, resume_existing? })
```

**初始化**:
```typescript
const abort = resume_existing ? resume(sessionID) : start(sessionID)
// start() → 创建新的 AbortController
// resume() → 返回现有的 AbortSignal 或 undefined

// 如果 abort === undefined（有等待中的 callbacks）
//   → 返回 Promise，等待 callbacks 解析

using _ = defer(() => cancel(sessionID))  // 作用域退出时自动取消

let structuredOutput = undefined  // JSON Schema 模式的输出
let step = 0                     // 迭代计数器
```

**主循环（while true）**:

```
┌────────────────────────────────────────────────────────────────┐
│ STEP 1: 状态设置 & 消息加载                                      │
│                                                                │
│ SessionStatus.set(sessionID, { type: "busy" })                │
│ if (abort.aborted) break                                       │
│                                                                │
│ msgs = MessageV2.filterCompacted(MessageV2.stream(sessionID)) │
│ 遍历 msgs，收集:                                                │
│   - lastUser: 最后的用户消息                                     │
│   - lastAssistant: 最后的助手消息                                │
│   - lastFinished: 最后有 finish reason 的助手消息                │
│   - tasks: CompactionPart 或 SubtaskPart                       │
├────────────────────────────────────────────────────────────────┤
│ STEP 2: 退出条件检查                                             │
│                                                                │
│ if (!lastUser) throw Error("No user message found")            │
│ if (lastAssistant 已完成 && 非 "tool-calls"/"unknown"           │
│     && lastUser.id < lastAssistant.id) → break                 │
├────────────────────────────────────────────────────────────────┤
│ STEP 3: 步数递增 & 标题生成                                      │
│                                                                │
│ step++                                                         │
│ if (step === 1) ensureTitle(...)  // 异步生成标题               │
├────────────────────────────────────────────────────────────────┤
│ STEP 4: 模型解析                                                │
│                                                                │
│ model = Provider.getModel(lastUser.model.providerID,           │
│                           lastUser.model.modelID)              │
├────────────────────────────────────────────────────────────────┤
│ STEP 5: 任务分支处理                                             │
│                                                                │
│ ┌─ A) task?.type === "subtask"                                 │
│ │   → 创建助手消息 + ToolPart                                   │
│ │   → 构建 Tool.Context (bypassAgentCheck=true)                │
│ │   → 执行 TaskTool.execute()                                  │
│ │   → 更新 Part 状态 (completed/error)                          │
│ │   → 如果有 command，创建合成用户消息                            │
│ │   → continue（重新开始循环）                                   │
│ │                                                              │
│ ├─ B) task?.type === "compaction"                              │
│ │   → SessionCompaction.process()                              │
│ │   → 如果返回 "stop" → break                                  │
│ │   → 否则 continue                                            │
│ │                                                              │
│ └─ C) 上下文溢出检查                                            │
│     → if (lastFinished && !summary &&                          │
│          SessionCompaction.isOverflow({tokens, model}))        │
│     → SessionCompaction.create({...})                          │
│     → continue                                                 │
├────────────────────────────────────────────────────────────────┤
│ STEP 6: 正常处理分支                                             │
│                                                                │
│ 6a. Agent & 步数限制                                            │
│   agent = Agent.get(lastUser.agent)                            │
│   maxSteps = agent.steps ?? Infinity                           │
│   isLastStep = step >= maxSteps                                │
│                                                                │
│ 6b. 插入提醒 (Plan 模式切换等)                                   │
│   msgs = insertReminders({ messages, agent, session })         │
│                                                                │
│ 6c. 创建 SessionProcessor                                      │
│   processor = SessionProcessor.create({                        │
│     assistantMessage: { id, parentID, role: "assistant",       │
│       agent, model, tokens, cost, time },                      │
│     sessionID, model, abort                                    │
│   })                                                           │
│                                                                │
│ 6d. 检查是否 bypass Agent 检查                                   │
│   bypassAgentCheck = 最后用户消息包含 AgentPart                  │
│                                                                │
│ 6e. 解析工具                                                    │
│   tools = resolveTools({                                       │
│     agent, session, model, tools: lastUser.tools,              │
│     processor, bypassAgentCheck, messages                      │
│   })                                                           │
│   if (JSON Schema 模式):                                       │
│     tools["StructuredOutput"] = createStructuredOutputTool()   │
│                                                                │
│ 6f. 触发摘要 (step === 1)                                       │
│   SessionSummary.summarize({ sessionID, messageID })           │
│                                                                │
│ 6g. 用户消息提醒包装 (step > 1)                                  │
│   将排队的用户消息包裹在 <system-reminder> 标签中                │
│                                                                │
│ 6h. Plugin 消息变换                                              │
│   Plugin.trigger("experimental.chat.messages.transform")       │
│                                                                │
│ 6i. 构建系统提示                                                 │
│   system = [                                                   │
│     ...SystemPrompt.environment(model),  // 环境信息            │
│     ...InstructionPrompt.system(),       // CLAUDE.md 等       │
│     STRUCTURED_OUTPUT_SYSTEM_PROMPT?,    // JSON Schema 提示   │
│   ]                                                            │
│                                                                │
│ 6j. 调用处理器                                                   │
│   result = processor.process({                                 │
│     user: lastUser, agent, abort, sessionID,                   │
│     system, model, tools,                                      │
│     messages: [                                                │
│       ...MessageV2.toModelMessages(msgs, model),               │
│       ...(isLastStep ? [MAX_STEPS 提醒] : [])                  │
│     ],                                                         │
│     toolChoice: (JSON Schema ? "required" : undefined),        │
│   })                                                           │
├────────────────────────────────────────────────────────────────┤
│ STEP 7: 后处理 & 循环控制                                        │
│                                                                │
│ if (structuredOutput !== undefined) → 捕获输出, break           │
│ if (模型完成 && 非 tool-calls && JSON Schema 但无输出) → 错误   │
│ if (result === "stop") → break                                 │
│ if (result === "compact") → SessionCompaction.create(), cont.  │
│ → continue（进入下一次迭代）                                    │
├────────────────────────────────────────────────────────────────┤
│ STEP 8: 循环退出 & 返回                                         │
│                                                                │
│ SessionCompaction.prune({ sessionID })  // 清理旧工具输出       │
│ 遍历消息流，返回最后的助手消息                                    │
│ 解析等待中的 callbacks                                           │
└────────────────────────────────────────────────────────────────┘
```

### 5.4 循环退出条件一览

| 条件 | 来源 | 说明 |
|------|------|------|
| `abort.aborted` | 用户取消 | AbortController 被触发 |
| 自然完成 | 消息检查 | lastAssistant 已完成且 finish ≠ "tool-calls"/"unknown" |
| `structuredOutput !== undefined` | JSON Schema 模式 | StructuredOutput 工具被调用，捕获到输出 |
| JSON Schema 无输出 | 模型完成但未调用工具 | 设置 StructuredOutputError 后 break |
| `result === "stop"` | Processor 返回 | 错误或权限拒绝 |
| Compaction "stop" | 压缩处理 | 压缩失败 |

---

## 6. SessionProcessor：流处理引擎

**源文件**: `packages/opencode/src/session/processor.ts`

### 6.1 创建与返回值

```typescript
SessionProcessor.create({
  assistantMessage,  // 正在填充的助手消息
  sessionID,
  model,
  abort,
}) → {
  message: MessageV2.Assistant,       // getter
  partFromToolCall(callID): ToolPart, // 按 callID 查找 Part
  process(streamInput): Promise<"continue" | "stop" | "compact">,
}
```

### 6.2 流事件处理

`process()` 调用 `LLM.stream()` 后遍历 `fullStream` 迭代器：

| 事件类型 | 处理逻辑 |
|---------|---------|
| `"reasoning-start"` | 创建 ReasoningPart，存入 reasoningMap |
| `"reasoning-delta"` | 追加文本，发布 PartDelta |
| `"reasoning-end"` | 终止推理，移除 map 条目 |
| `"tool-input-start"` | 创建 ToolPart (status: pending) |
| `"tool-input-delta"` | （无操作） |
| `"tool-input-end"` | （无操作） |
| `"tool-call"` | 更新为 running，**触发死循环检测** |
| `"tool-result"` | 更新为 completed，提取输出和附件 |
| `"tool-error"` | 更新为 error，检查是否权限拒绝 |
| `"text-start"` | 创建 TextPart |
| `"text-delta"` | 追加文本，发布 PartDelta |
| `"text-end"` | 终止文本，触发 Plugin "experimental.text.complete" |
| `"start-step"` | 记录文件系统快照 |
| `"finish-step"` | 计算 token/cost，检查溢出，生成 patch，触发摘要 |
| `"error"` | 抛出错误（由外层 catch 处理） |

### 6.3 死循环检测 (Doom Loop)

```typescript
// 常量
const DOOM_LOOP_THRESHOLD = 3

// tool-call 事件中:
const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)
if (lastThree.length === 3 &&
    lastThree.every(p =>
      p.type === "tool" &&
      p.tool === value.toolName &&
      p.state.status !== "pending" &&
      JSON.stringify(p.state.input) === JSON.stringify(value.input)
    )) {
  // 连续 3 次以相同参数调用相同工具
  await PermissionNext.ask({
    permission: "doom_loop",
    patterns: [value.toolName],
    metadata: { tool: value.toolName, input: value.input },
    always: [value.toolName],
  })
}
```

### 6.4 权限拒绝处理

```typescript
// tool-error 事件中:
if (value.error instanceof PermissionNext.RejectedError ||
    value.error instanceof Question.RejectedError) {
  blocked = shouldBreak  // 来自 Config.experimental?.continue_loop_on_deny
}

// process() 返回时:
if (blocked) return "stop"
```

### 6.5 process() 返回值决策

```
needsCompaction === true  → return "compact"
blocked === true          → return "stop"
assistantMessage.error    → return "stop"
以上都不是              → return "continue"
```

---

## 7. LLM 调用层：LLM.stream()

**源文件**: `packages/opencode/src/session/llm.ts`

### 7.1 输入参数

```typescript
LLM.StreamInput = {
  user: MessageV2.User,           // 当前用户消息
  sessionID: string,
  model: Provider.Model,          // 模型完整配置
  agent: Agent.Info,              // Agent 配置
  system: string[],               // 系统提示数组
  abort: AbortSignal,             // 取消信号
  messages: ModelMessage[],       // AI SDK 格式的消息历史
  small?: boolean,                // 简化推理模式
  tools: Record<string, Tool>,    // 可用工具
  retries?: number,               // 最大重试次数（默认 0）
  toolChoice?: "auto"|"required"|"none",
}
```

### 7.2 处理流程

```
1. 系统提示组装:
   ├─ Agent.prompt（如果有）
   ├─ 或 SystemPrompt.provider(model)（Provider 默认提示）
   ├─ input.system（环境信息 + CLAUDE.md 等）
   ├─ input.user.system（消息级自定义 system）
   └─ Plugin "experimental.chat.system.transform" 变换

2. 参数组装:
   ├─ temperature: Agent 指定 或 model 默认
   ├─ topP: Agent 指定
   ├─ topK: ProviderTransform.topK(model)
   ├─ maxOutputTokens: ProviderTransform.maxOutputTokens(model)
   ├─ 合并选项: provider → model → agent → variant
   └─ Plugin "chat.params" 变换

3. Headers 组装:
   ├─ x-opencode-* (OpenCode 模型)
   ├─ 或 User-Agent: opencode/version
   ├─ model.headers (Provider 特定)
   └─ Plugin "chat.headers" 变换

4. 工具过滤:
   ├─ PermissionNext.disabled(tools, agent.permission) → 移除 deny 的工具
   ├─ user.tools[name] === false → 移除用户禁用的工具
   └─ LiteLLM 兼容: 如果 tools 为空且使用代理 → 添加 _noop 虚拟工具

5. streamText() 调用:
   model = wrapLanguageModel({
     model: language,
     middleware: [ProviderTransform.message(model)]
   })
   → 返回 StreamTextResult<ToolSet>
```

### 7.3 关键 streamText 参数

```typescript
streamText({
  model: wrappedLanguageModel,
  messages: [
    ...system.map(text => ({ role: "system", content: text })),
    ...input.messages,
  ],
  tools: filteredTools,
  toolChoice,
  maxRetries: input.retries ?? 0,
  temperature, topP, topK, maxOutputTokens,
  headers,
  providerOptions,  // Provider 特定选项
  experimental_telemetry,
  experimental_repairToolCall,
  onError: ProviderError.parseAPICallError,
})
```

---

## 8. 工具解析：resolveTools()

**源文件**: `packages/opencode/src/session/prompt.ts` (734-922 行)

### 8.1 Tool.Context 工厂

每次工具调用时创建上下文：

```typescript
const context = (args, options) => ({
  sessionID,
  abort: options.abortSignal,
  messageID: processor.message.id,
  callID: options.toolCallId,         // AI SDK 分配的调用 ID
  extra: { model, bypassAgentCheck },
  agent: agent.name,
  messages: messages,                 // 完整消息历史
  metadata: async (val) => {
    // 更新 ToolPart 的 metadata 和 title
    await Session.updatePart(...)
  },
  ask: async (req) => {
    // 合并 Agent 权限 + Session 权限
    await PermissionNext.ask({
      ...req,
      sessionID,
      tool: { messageID, callID },
      ruleset: PermissionNext.merge(agent.permission, session.permission),
    })
  },
})
```

### 8.2 内置工具注册

```
ToolRegistry.tools(model, agent)
    ↓
对每个工具:
  1. ProviderTransform.schema(model, schema) → 转换 JSON Schema
  2. 包装为 AI SDK tool({
       id, description, inputSchema,
       execute: async (args, options) => {
         ctx = context(args, options)
         Plugin.trigger("tool.execute.before", ...)
         result = item.execute(args, ctx)
         Plugin.trigger("tool.execute.after", ...)
         return { ...result, attachments: withIDs }
       }
     })
```

### 8.3 MCP 工具注册

```
MCP.tools()
    ↓
对每个 MCP 工具:
  1. ProviderTransform.schema(model, schema) → 转换
  2. 包装 execute:
     - Plugin.trigger("tool.execute.before", ...)
     - ctx.ask({ permission: toolName, patterns: ["*"], always: ["*"] })
     - 原始 execute(args, opts) → CallToolResult
     - 解析 content[]:
       ├─ "text" → 拼接文本
       ├─ "image" → base64 附件
       └─ "resource" → 文本或 blob 附件
     - Truncate.output() → 截断
     - Plugin.trigger("tool.execute.after", ...)
     - 返回格式化结果
```

### 8.4 ToolRegistry 过滤规则

| 工具 | 条件 |
|------|------|
| `websearch`/`codesearch` | 仅 providerID === "opencode" 或 `OPENCODE_ENABLE_EXA` |
| `apply_patch` | 仅 OpenAI GPT 模型（非 OSS，非 gpt-4） |
| `edit`/`write` | 排除使用 apply_patch 的模型 |
| `question` | 需要 `OPENCODE_CLIENT` 或 `OPENCODE_ENABLE_QUESTION_TOOL` |
| `lsp` | 需要 `OPENCODE_EXPERIMENTAL_LSP_TOOL` |
| `batch` | 需要 `cfg.experimental?.batch_tool === true` |
| `plan` (exit) | 需要 Plan 模式 + CLI 客户端 |

---

## 9. 消息格式转换：MessageV2.toModelMessages()

**源文件**: `packages/opencode/src/session/message-v2.ts`

### 9.1 Provider 媒体支持判断

```typescript
支持在 tool results 中嵌入媒体的 Provider:
  - @ai-sdk/anthropic
  - @ai-sdk/openai
  - @ai-sdk/amazon-bedrock
  - @ai-sdk/google-vertex/anthropic
  - @ai-sdk/google (仅 gemini-3.x, 不含 gemini-2.x)
```

不支持的 Provider → 从工具结果中提取媒体 → 注入独立的 user 消息携带媒体。

### 9.2 用户消息转换

| Part 类型 | → ModelMessage 内容 |
|-----------|-------------------|
| text (非 ignored) | `{type: "text", text}` |
| file (非纯文本/非目录) | `{type: "file", url, mediaType, filename}` |
| compaction | `{type: "text", text: "What did we do so far?"}` |
| subtask | `{type: "text", text: "The following tool was executed by the user"}` |

### 9.3 助手消息转换

| Part 类型 | → ModelMessage 内容 |
|-----------|-------------------|
| text | `{type: "text", text, providerMetadata?}` |
| reasoning | `{type: "reasoning", text, providerMetadata?}` |
| step-start | `{type: "step-start"}` |
| tool (completed) | `{type: "tool-call", toolCallId, input, output}` |
| tool (error) | `{type: "tool-call", state: "output-error", errorText}` |
| tool (pending/running) | `{type: "tool-call", state: "output-error", errorText: "[interrupted]"}` |

### 9.4 Provider 特定消息规范化

| Provider | 处理 |
|----------|------|
| **Anthropic** | 过滤空消息，移除空文本/推理部分 |
| **Claude** | toolCallId 只保留字母数字和 -/_ |
| **Mistral** | toolCallId 截取为 9 字符字母数字；修复 tool 后接 user 的序列 |
| **推理模型** | 将 reasoning parts 移至消息的 reasoning 字段（非独立消息） |

---

## 10. 上下文压缩：Compaction

**源文件**: `packages/opencode/src/session/compaction.ts`

### 10.1 溢出检测

```typescript
SessionCompaction.isOverflow({ tokens, model }):
  threshold = model.context - reservedBuffer (默认 20K)
  return tokens.total >= threshold
```

### 10.2 创建压缩任务

```typescript
SessionCompaction.create({ sessionID, agent, model, auto }):
  // 创建 CompactionPart 存入消息
  // 循环将在下次迭代时处理
```

### 10.3 裁剪阶段 (Prune)

```typescript
SessionCompaction.prune({ sessionID }):
  // 从后向前扫描消息历史
  // 标记旧的已完成工具输出为 "compacted"
  // 保留至少最近 2 个 turn 和技能
  // 释放 token 空间
```

### 10.4 压缩处理

```typescript
SessionCompaction.process({ sessionID, agent, model }):
  // 1. 使用 compaction Agent 生成摘要
  // 2. 摘要存为新的助手消息（summary: true）
  // 3. 创建合成用户消息："Continue if you have next steps..."
  // 4. 返回 "continue" 或 "stop"
```

### 10.5 自动触发时机

在 `finish-step` 事件中检查：
```typescript
if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model })) {
  needsCompaction = true
  // process() 返回 "compact"
  // loop() 创建 CompactionPart，继续循环
}
```

---

## 11. 重试与错误处理

**源文件**: `packages/opencode/src/session/retry.ts`, `processor.ts`

### 11.1 错误分类

```typescript
MessageV2.fromError(error, { providerID }):
  ├─ Auth 错误 → AuthError
  ├─ API 调用错误:
  │   ├─ 上下文溢出（正则匹配 10+ Provider 的错误格式）→ ContextOverflowError
  │   └─ 其他 → APIError { retryable, statusCode, responseBody }
  ├─ 连接错误 → APIError { retryable: true }
  └─ 其他 → Unknown
```

### 11.2 重试逻辑

```typescript
SessionRetry.retryable(error):
  ├─ APIError && retryable === true → 返回重试消息
  └─ 其他 → undefined（不可重试）

SessionRetry.delay(attempt, apiError?):
  ├─ 如果有 Retry-After / Retry-After-Ms header → 使用 header 值
  ├─ 否则: 2s × 2^(attempt-1)
  └─ 上限: 无 header 时 30s，有 header 时 2^31-1ms
```

### 11.3 重试流程（processor 中）

```
catch (e):
  error = MessageV2.fromError(e)
  retry = SessionRetry.retryable(error)

  if (retry !== undefined):
    attempt++
    delay = SessionRetry.delay(attempt, error)
    SessionStatus.set(sessionID, {
      type: "retry",
      attempt,
      message: retry,
      next: Date.now() + delay,
    })
    await SessionRetry.sleep(delay, abort)
    continue  // 重试 LLM.stream()

  else:
    assistantMessage.error = error
    Bus.publish(Session.Event.Error, {...})
    SessionStatus.set(sessionID, { type: "idle" })
    // process() 返回 "stop"
```

---

## 12. Provider 变换层

**源文件**: `packages/opencode/src/provider/transform.ts`

### 12.1 消息变换 (ProviderTransform.message)

作为 `wrapLanguageModel` 的中间件应用：

```
1. unsupportedParts() → 检测模型不支持的输入模态，替换为错误文本
2. normalizeMessages() → Provider 特定消息规范化
3. applyCaching() → 添加缓存控制头
```

### 12.2 缓存控制

| Provider | 缓存格式 |
|----------|---------|
| Anthropic/OpenRouter | `{cacheControl: {type: "ephemeral"}}` |
| Bedrock | `{cachePoint: {type: "default"}}` |
| OpenAI Compatible | `{cache_control: {type: "ephemeral"}}` |
| Copilot | `{copilot_cache_control: {type: "ephemeral"}}` |

应用位置：系统提示 + 最后 2 条消息。

### 12.3 Schema 变换

```typescript
ProviderTransform.schema(model, jsonSchema):
  ├─ Gemini: 将 integer enum 转换为 string enum，过滤 required 字段
  ├─ 移除非 object 类型的 properties/required
  └─ 确保 array items 有 type
```

### 12.4 模型变体 (Variants)

| Provider | 模型 | 变体 |
|----------|------|------|
| Anthropic | opus-4.6, sonnet-4.6 | low/medium/high/max (adaptive thinking) |
| OpenAI | gpt-5-* | low/medium/high/xhigh/none (reasoning effort) |
| Google | gemini-2.5/3.1 | low/high (thinking budget/level) |
| xAI | grok-3-* | low/high (reasoning effort) |
| DeepSeek | deepseek-* | low/medium/high (thinking effort) |

---

## 13. Plan 模式与 Agent 切换

### 13.1 切换到 Plan 模式

当 Agent 从非 plan 切换到 plan 时，`insertReminders()` 注入：
- Plan 文件位置：`.opencode/plans/<sessionID>.md`
- 5 阶段工作流：理解 → 设计 → 审查 → 最终计划 → 退出
- 只读约束提醒
- Agent 启动指南
- 验证指令

### 13.2 切换到 Build 模式

当 Agent 从 plan 切换到 build 时，注入：
- `BUILD_SWITCH` 文本（提醒查看计划文件）
- 计划文件路径和内容

### 13.3 MAX_STEPS 提醒

当 `step >= agent.steps` 时，注入助手消息作为最后一步的提醒，强制模型收尾。

---

## 14. 自定义 Agent 生成

**源文件**: `packages/opencode/src/agent/agent.ts` (Agent.generate)

```typescript
Agent.generate({ description, model? }):
  // 1. 使用 PROMPT_GENERATE 模板
  // 2. 温度 0.3
  // 3. 提供已有 Agent 列表（防止名称冲突）
  // 4. 使用 generateObject() 或 streamObject()
  // 5. 返回:
  {
    identifier: string,    // 小写字母+连字符，2-4 词
    whenToUse: string,     // "Use this agent when..."
    systemPrompt: string,  // 完整系统提示词
  }
```

生成后，用户需将结果写入配置文件的 `agent` 字段。

---

## 15. 完整数据流总结

```
用户输入 "修复 login.ts 中的认证 bug"
    │
    ▼
[SessionPrompt.prompt()]
    │ 创建用户消息（TextPart: "修复 login.ts 中的认证 bug"）
    │ Session.touch()
    │
    ▼
[SessionPrompt.loop()] ─── step=0 ───
    │
    ├─ step=1: SessionStatus → "busy"
    │  加载消息历史 → lastUser 找到
    │  Agent.get("build") → 获取 build Agent
    │  ensureTitle() → 异步生成标题
    │  Provider.getModel() → 获取 claude-sonnet-4-6
    │
    ├─ resolveTools():
    │  ├─ ToolRegistry.tools() → bash, read, write, edit, grep, glob, task...
    │  ├─ MCP.tools() → 外部 MCP 工具
    │  ├─ 每个工具包装: Plugin hooks + 权限检查 + 输出截断
    │  └─ ProviderTransform.schema() → 规范化 JSON Schema
    │
    ├─ 系统提示组装:
    │  ├─ SystemPrompt.environment() → 环境信息
    │  ├─ InstructionPrompt.system() → CLAUDE.md 内容
    │  └─ Agent.prompt → （build 无自定义）
    │
    ├─ MessageV2.toModelMessages():
    │  └─ 历史消息 → AI SDK ModelMessage 格式
    │
    ▼
[SessionProcessor.process()]
    │
    ├─ LLM.stream():
    │  ├─ 组装 system + messages + tools
    │  ├─ wrapLanguageModel() + ProviderTransform 中间件
    │  └─ streamText() → 流式调用 Anthropic API
    │
    ├─ 流处理:
    │  ├─ text-start → 创建 TextPart: "让我先阅读 login.ts..."
    │  ├─ text-delta → 追加文本
    │  ├─ text-end → 终止文本
    │  ├─ tool-call: read → status: "running"
    │  │   └─ Tool.execute(read, {path: "login.ts"})
    │  │       ├─ ctx.ask({permission: "read", patterns: ["login.ts"]})
    │  │       │   └─ evaluate → "allow" (默认允许读取)
    │  │       └─ 读取文件内容，返回 output
    │  ├─ tool-result: read → status: "completed"
    │  ├─ tool-call: edit → status: "running"
    │  │   └─ Tool.execute(edit, {path: "login.ts", old_string, new_string})
    │  │       ├─ ctx.ask({permission: "edit", patterns: ["login.ts"]})
    │  │       │   └─ evaluate → "ask" → UI 提示用户
    │  │       │       用户选择 "always" → 加入 approved
    │  │       └─ 执行编辑，返回 diff
    │  ├─ tool-result: edit → status: "completed"
    │  ├─ finish-step:
    │  │   ├─ 计算 token/cost
    │  │   ├─ 检查溢出 → 未溢出
    │  │   └─ 生成 patch (git diff)
    │  └─ finish: reason="stop"
    │
    └─ return "continue"

[loop 继续检查]
    │ lastAssistant.finish === "stop" → 不是 "tool-calls"
    │ lastUser.id < lastAssistant.id → true
    │ → break 退出循环
    │
    ▼
SessionCompaction.prune() → 清理旧输出
返回助手消息 { info, parts: [TextPart, ToolPart(read), ToolPart(edit), ...] }
    │
    ▼
通过 SSE/RPC → SyncProvider → SolidJS Store → TUI 60FPS 渲染
```

### 关键设计特点

| 特点 | 实现 |
|------|------|
| **渐进式权限** | 首次 ask → 记住 → 后续自动 allow |
| **死循环防护** | 连续 3 次相同工具+参数 → 请求用户确认 |
| **自动压缩** | token 接近上限 → prune 旧输出 → LLM 摘要 → 继续 |
| **步数限制** | `agent.steps` 到达后注入 MAX_STEPS 提醒 |
| **错误恢复** | 指数退避重试，支持 Retry-After header |
| **取消传播** | AbortController → 传递到 LLM/Tool/Shell/Sleep 各层 |
| **Plugin 钩子** | before/after 工具执行、系统提示变换、消息变换、参数变换 |
| **结构化输出** | 注入 StructuredOutput 工具 + toolChoice:"required" |
| **多 Provider** | 中间件层统一变换消息格式、Schema、缓存控制 |
