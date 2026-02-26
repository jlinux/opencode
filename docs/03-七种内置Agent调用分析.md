# 七种内置 Agent 调用场景、触发条件和价值分析

## 总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    用户可见的 Agent (4个)                         │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  build   │  │   plan   │  │ general  │  │ explore  │       │
│  │ primary  │  │ primary  │  │ subagent │  │ subagent │       │
│  │ 默认Agent │  │ 只读规划  │  │ @通用子代理│  │ @快速搜索 │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │             │
│  Tab切换/默认   Tab切换/手动    @mention       @mention         │
│  用户直接选择   用户直接选择    Task工具调用    Task工具调用       │
├─────────────────────────────────────────────────────────────────┤
│                    系统隐藏的 Agent (3个)                         │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │compaction│  │  title   │  │ summary  │                     │
│  │ 上下文压缩 │  │ 标题生成  │  │ 摘要计算  │                     │
│  │ LLM驱动  │  │ LLM驱动  │  │ 非LLM    │                     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│       │              │              │                           │
│  token溢出时    首条消息时     每步结束时                         │
│  自动触发       fire-and-forget  自动计算diff                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. build — 默认编码 Agent

### 1.1 定义

| 属性 | 值 |
|------|-----|
| mode | `"primary"` |
| hidden | `false` |
| native | `true` |
| temperature | 无覆盖（使用模型默认） |
| 系统提示 | 无自定义（使用 Provider 默认 SystemPrompt） |
| 步数限制 | 无（`Infinity`） |

### 1.2 权限配置

```
基础默认权限:
  "*": "allow"                    ← 所有工具默认允许
  doom_loop: "ask"               ← 死循环检测需确认
  external_directory: { "*": "ask" }  ← 项目外目录需确认
  question: "deny"               ← 默认禁止（下面覆盖）
  plan_enter: "deny"             ← 默认禁止（下面覆盖）
  plan_exit: "deny"              ← 保持禁止
  read: { "*.env": "ask" }       ← .env 文件需确认

build 覆盖:
  question: "allow"              ← 允许向用户提问
  plan_enter: "allow"            ← 允许进入 Plan 模式
```

**关键点**: build 是唯一拥有**完整编辑权限**的默认 Agent。

### 1.3 何时被调用

| 触发场景 | 触发条件 | 代码位置 |
|---------|---------|---------|
| **程序启动** | 用户打开 OpenCode，默认选中 build | `Agent.defaultAgent()` → agent.ts:266-281 |
| **用户发送消息** | 未指定 Agent 时使用默认 | `createUserMessage()` → prompt.ts:955 |
| **从 Plan 切回** | plan_exit 工具完成后 | plan.ts:65 → `agent: "build"` |
| **CLI --agent** | `opencode --agent build` | thread.ts:78-81 |
| **Tab 切换** | 用户按 Tab 循环 Agent | local.tsx:72-83 → `agent.move(1)` |
| **配置指定** | `default_agent: "build"` | config.ts:1063-1068 |

### 1.4 调用流程

```
用户输入文本 → 点击提交/Enter
    ↓
TUI: local.agent.current() === "build"
    ↓
sdk.client.session.prompt({
  agent: "build",
  parts: [{ type: "text", text: "用户输入" }]
})
    ↓
SessionPrompt.prompt() → createUserMessage({ agent: "build" })
    ↓
SessionPrompt.loop():
  Agent.get("build") → 获取完整权限配置
  resolveTools() → 加载所有允许的工具（bash/read/write/edit/grep/glob/task...）
  processor.process() → LLM.stream() 开始流式调用
    ↓
LLM 可以调用任何工具 → 执行 → 返回结果 → 循环
```

### 1.5 核心价值

**build 是用户与 AI 交互的主力 Agent**，具有：
- 完整的文件读写权限 — 可以创建、编辑、删除文件
- Shell 命令执行权限 — 可以运行构建、测试、部署命令
- 子 Agent 调度权限 — 可以调用 general/explore 进行并行研究
- 用户交互权限 — 可以向用户提问（question tool）
- Plan 模式切换权限 — 可以进入只读规划模式

---

## 2. plan — 只读规划 Agent

### 2.1 定义

| 属性 | 值 |
|------|-----|
| mode | `"primary"` |
| hidden | `false` |
| native | `true` |
| temperature | 无覆盖 |
| 系统提示 | 无自定义（使用 Provider 默认 + Plan 提醒注入） |
| 步数限制 | 无 |

### 2.2 权限配置

```
基础默认权限 + plan 覆盖:
  question: "allow"              ← 允许提问
  plan_exit: "allow"             ← 允许退出 Plan 模式
  external_directory:
    [plans目录]: "allow"          ← 允许访问计划文件目录
  edit:
    "*": "deny"                  ← 禁止所有编辑！
    ".opencode/plans/*.md": "allow"  ← 唯一例外：计划文件
```

**关键点**: plan Agent **禁止一切文件编辑**，只能读取、搜索、分析代码，并将计划写入 `.opencode/plans/*.md`。

### 2.3 何时被调用

| 触发场景 | 触发条件 | 代码位置 |
|---------|---------|---------|
| **用户手动切换** | 按 Tab 切换到 plan | local.tsx:72-83 |
| **Agent 选择器** | 从 Agent 对话框选择 plan | dialog-agent.tsx:6-31 |
| **LLM 请求进入** | build Agent 调用 plan_enter 工具 | plan.ts:74-131 (当前已注释) |
| **CLI 指定** | `opencode --agent plan` | thread.ts:78-81 |

### 2.4 Plan 模式切换完整流程

**进入 Plan 模式：**
```
用户选择 plan Agent (Tab 切换或手动选择)
    ↓
TUI: local.agent.set("plan")
    ↓
用户发送消息 → agent: "plan"
    ↓
SessionPrompt.loop() → insertReminders():
  检测到: 当前 agent === "plan" && 上一条 assistant.agent !== "plan"
  → 注入 PROMPT_PLAN 系统提醒:
    ┌─────────────────────────────────────────────────────────┐
    │ CRITICAL: Plan mode ACTIVE - READ-ONLY phase.          │
    │ STRICTLY FORBIDDEN: ANY file edits/modifications.      │
    │                                                         │
    │ 5 阶段工作流:                                           │
    │   Phase 1: Initial Understanding (用 explore agent)     │
    │   Phase 2: Architecture Design                          │
    │   Phase 3: Design Review                                │
    │   Phase 4: Final Plan (写入 .opencode/plans/<id>.md)    │
    │   Phase 5: Exit Plan Mode (调用 plan_exit 工具)          │
    └─────────────────────────────────────────────────────────┘
    ↓
LLM 在只读模式下工作:
  - 可以调用 read/grep/glob/bash(只读命令) 分析代码
  - 可以调用 @explore 并行探索代码库
  - 可以向用户提问
  - 只能写入 .opencode/plans/*.md 文件
    ↓
规划完成后，LLM 调用 plan_exit 工具
```

**退出 Plan 模式 (plan_exit 工具)：**
```
LLM 调用 plan_exit 工具
    ↓
plan.ts: Question.ask({
  "Plan at .opencode/plans/<id>.md is complete.
   Would you like to switch to build agent?"
})
    ↓
用户选择 "Yes"
    ↓
创建合成用户消息: { agent: "build" }
    ↓
TUI 监听 plan_exit 完成事件:
  local.agent.set("build")    ← UI 切回 build
    ↓
下次循环: insertReminders() 检测到 plan → build 切换:
  注入 BUILD_SWITCH 提醒:
    "Your operational mode has changed from plan to build.
     You are permitted to make file changes."
  + 如果计划文件存在: "A plan file exists at ... Execute on the plan."
```

### 2.5 核心价值

**plan Agent 实现"先想后做"的开发模式**：
- **安全分析** — 只读模式避免在理解问题前就修改代码
- **并行探索** — 指导使用 explore agent 并行调查代码库
- **结构化规划** — 产出写入文件的正式计划，可供审查
- **无缝切换** — plan_exit 工具自动切换到 build 并传递计划

---

## 3. general — 通用子 Agent

### 3.1 定义

| 属性 | 值 |
|------|-----|
| mode | `"subagent"` |
| hidden | `false` |
| native | `true` |
| temperature | 无覆盖 |
| 系统提示 | 无自定义 |
| 步数限制 | 无 |
| description | "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel." |

### 3.2 权限配置

```
基础默认权限 + general 覆盖:
  todoread: "deny"              ← 禁止读取 todo
  todowrite: "deny"             ← 禁止写入 todo
  （其余与 build 相同，包括 edit/write/bash 等）
```

**关键点**: general 拥有**几乎与 build 相同的权限**（可读可写可执行），只是禁止了 todo 操作，且不能直接被选为会话 Agent。

### 3.3 何时被调用

| 触发场景 | 触发条件 | 代码位置 |
|---------|---------|---------|
| **用户 @mention** | 在输入框中输入 `@general` | autocomplete.tsx:334-354 |
| **LLM 自主调度** | build Agent 判断需要并行子任务 | LLM 调用 Task tool → task.ts:27-165 |
| **命令调用** | 命令配置 agent 为 general | prompt.ts:1833-1834 |

### 3.4 调用流程

**方式 A: 用户 @mention**
```
用户输入 "@general 帮我研究 X 和 Y"
    ↓
autocomplete.tsx: insertPart("general", { type: "agent", name: "general" })
    ↓
提交时: parts = [
  { type: "agent", name: "general" },
  { type: "text", text: "帮我研究 X 和 Y" }
]
    ↓
createUserMessage() → 处理 AgentPart:
  添加合成文本:
  "Use the above message and context to generate a prompt and
   call the task tool with subagent: general"
    ↓
build Agent 收到指令 → 调用 Task tool:
  { subagent_type: "general", prompt: "研究 X 和 Y", description: "..." }
    ↓
Task tool (task.ts):
  1. bypassAgentCheck = true（用户显式调用，跳过权限检查）
  2. 创建子 Session: title = "研究 X 和 Y (@general subagent)"
  3. 子 Session 运行 general Agent 的完整循环
  4. 结果返回给父 Session 的 build Agent
```

**方式 B: LLM 自主调度**
```
build Agent 在处理复杂任务时判断需要并行研究
    ↓
LLM 自行调用 Task tool:
  { subagent_type: "general",
    prompt: "Research the authentication system...",
    description: "Research auth system" }
    ↓
Task tool:
  1. bypassAgentCheck = false → 需要权限检查
  2. ctx.ask({ permission: "task", patterns: ["general"] })
     → evaluate → "allow"（build Agent 默认允许 task）
  3. 创建子 Session，运行 general Agent
  4. general Agent 可以：读写文件、执行命令、搜索代码
  5. 结果返回
```

### 3.5 核心价值

**general 是"全能助手"子 Agent**：
- **并行执行** — build Agent 可同时启动多个 general 子任务
- **独立上下文** — 每个子任务在独立 Session 中运行，不污染主对话
- **完整能力** — 拥有几乎所有工具，可以实际修改代码
- **可恢复** — 通过 `task_id` 参数可恢复之前的子任务

---

## 4. explore — 快速探索子 Agent

### 4.1 定义

| 属性 | 值 |
|------|-----|
| mode | `"subagent"` |
| hidden | `false` |
| native | `true` |
| temperature | 无覆盖 |
| 系统提示 | `PROMPT_EXPLORE`（专用探索提示） |
| 步数限制 | 无 |
| description | "Fast agent specialized for exploring codebases..." |

### 4.2 权限配置

```
explore 特殊权限（默认全部 deny，白名单制）:
  "*": "deny"                   ← 默认禁止所有！
  grep: "allow"                 ← 允许搜索内容
  glob: "allow"                 ← 允许匹配文件
  list: "allow"                 ← 允许列目录
  bash: "allow"                 ← 允许 Shell（只读命令）
  webfetch: "allow"             ← 允许抓取网页
  websearch: "allow"            ← 允许网页搜索
  codesearch: "allow"           ← 允许代码搜索
  read: "allow"                 ← 允许读取文件
  （edit/write/task 等全部 deny）
```

**关键点**: explore 是**严格只读**的，不能编辑文件、不能创建子任务、不能写 todo。

### 4.3 系统提示 (explore.txt)

```
You are a file search specialist. You excel at thoroughly navigating
and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path
- Use Bash for file operations like copying, moving, or listing
- Adapt your search approach based on the thoroughness level
  specified by the caller
- Return file paths as absolute paths
- Do not create any files, or run bash commands that modify
  the user's system state in any way
```

### 4.4 何时被调用

| 触发场景 | 触发条件 | 代码位置 |
|---------|---------|---------|
| **用户 @mention** | 输入 `@explore` | autocomplete.tsx:334-354 |
| **LLM 自主调度** | build Agent 需要快速查找代码 | LLM → Task tool |
| **Plan 模式指导** | plan.txt Phase 1 明确要求用 explore | prompt.ts:1390-1401 |

### 4.5 explore vs general 的选择指导

LLM 在系统提示中收到的指导（来自 Task tool 描述和 Agent description）：

| 维度 | explore | general |
|------|---------|---------|
| **用途** | 快速搜索文件、查找代码 | 复杂多步任务、深入研究 |
| **工具** | 只有搜索和读取工具 | 几乎全部工具（可读可写） |
| **速度** | 快（工具集小，响应快） | 慢（工具集大，可能多步） |
| **风险** | 零风险（不修改任何文件） | 有风险（可修改文件） |
| **典型场景** | "找到所有 API 端点" | "重构认证模块" |

Plan 模式中的明确指导（prompt.ts Plan phase）：
```
Phase 1: Initial Understanding
→ "Launch up to 3 explore agents IN PARALLEL to efficiently explore"
```

### 4.6 核心价值

**explore 是"安全侦察兵"子 Agent**：
- **零风险** — 严格只读，绝不修改文件系统
- **快速定位** — 专注于 grep/glob/read 三大搜索工具
- **并行友好** — Plan 模式推荐同时启动 3 个 explore 并行搜索
- **轻量上下文** — 工具集小，不浪费 token 在无关工具描述上

---

## 5. compaction — 上下文压缩 Agent (隐藏)

### 5.1 定义

| 属性 | 值 |
|------|-----|
| mode | `"primary"` |
| hidden | `true` |
| native | `true` |
| temperature | 无覆盖 |
| 系统提示 | `PROMPT_COMPACTION` |
| 步数限制 | 无 |
| 工具 | **无**（`"*": "deny"`） |

### 5.2 系统提示 (compaction.txt)

```
You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary.
Focus on information helpful for continuing the conversation:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Do not respond to any questions in the conversation,
only output the summary.
```

### 5.3 何时被调用

**唯一触发条件：上下文 token 溢出**

```
触发检测点 1: SessionProcessor finish-step 事件
  → SessionCompaction.isOverflow({ tokens, model })
  → processor 返回 "compact"

触发检测点 2: loop() 每次迭代开头
  → if (lastFinished && !summary && isOverflow())
  → SessionCompaction.create()

API 手动触发:
  → POST /session/:sessionID/summarize
```

### 5.4 溢出检测公式

```typescript
const COMPACTION_BUFFER = 20_000  // 保留 20K token 缓冲

isOverflow({ tokens, model }):
  reserved = config.compaction?.reserved
            ?? Math.min(COMPACTION_BUFFER, maxOutputTokens(model))
  usable = model.limit.input - reserved
  return tokens.total >= usable
```

**示例**: Claude Sonnet (200K context, 32K max output)
- reserved = min(20000, 32000) = 20000
- usable = 200000 - 20000 = 180000
- 当 token 用量 ≥ 180K 时触发

### 5.5 完整处理流程

```
[检测] token 溢出
    ↓
[创建] SessionCompaction.create():
  在消息历史中插入 CompactionPart
    ↓
[循环] loop() 下次迭代发现 task.type === "compaction"
    ↓
[裁剪] SessionCompaction.prune():
  PRUNE_MINIMUM = 20,000 tokens
  PRUNE_PROTECT = 40,000 tokens

  从后向前扫描消息:
    保护: 最近 40K token 的内容
    跳过: summary=true 的消息（之前的压缩摘要）
    跳过: 状态为 pending/running 的工具
    跳过: "skill" 类型工具的输出（保护技能上下文）
    裁剪: 旧的已完成工具输出
      → part.state.time.compacted = Date.now()
      → 清空输出内容但保留元数据
    ↓
[压缩] SessionCompaction.process():
  1. 创建助手消息: { agent: "compaction", summary: true }
  2. 构建压缩 prompt:
     ┌──────────────────────────────────────────────────┐
     │ Provide a comprehensive summary:                 │
     │ 1. Goal we are trying to achieve                │
     │ 2. Instructions/constraints from user            │
     │ 3. Discoveries learned                          │
     │ 4. Accomplished / In-progress / Remaining work  │
     │ 5. Relevant file/directory list                 │
     └──────────────────────────────────────────────────┘
  3. LLM.stream():
     - model: 用户当前模型（非 small）
     - tools: {} （无工具）
     - system: [] （无额外系统提示）
     - messages: 完整历史（含已裁剪标记的消息）
  4. LLM 生成摘要文本
    ↓
[后续] 如果 auto=true 且 result === "continue":
  创建合成用户消息:
    agent: 原始用户 Agent（如 "build"）
    text: "Continue if you have next steps,
           or stop and ask for clarification..."
    ↓
[继续] loop() 继续正常处理，以压缩后的上下文继续对话
```

### 5.6 核心价值

**compaction 是"记忆管理员"Agent**：
- **防止溢出** — 自动检测上下文接近极限并触发压缩
- **渐进裁剪** — 先清理旧工具输出，保留最近内容
- **语义保留** — 通过 LLM 生成高质量摘要，而非简单截断
- **无缝继续** — 压缩后自动创建后续消息，对话不中断
- **可配置** — 支持禁用自动压缩、调整保留 token 数

---

## 6. title — 标题生成 Agent (隐藏)

### 6.1 定义

| 属性 | 值 |
|------|-----|
| mode | `"primary"` |
| hidden | `true` |
| native | `true` |
| **temperature** | **0.5**（唯一有温度覆盖的 Agent） |
| 系统提示 | `PROMPT_TITLE` |
| 步数限制 | 无 |
| 工具 | **无** |

### 6.2 系统提示 (title.txt) 关键规则

```
You are a title generator. You output ONLY a thread title.

规则:
- 使用与用户消息相同的语言
- ≤50 字符
- 单行
- 不包含工具名 (read tool, bash tool 等)
- 聚焦主题，不用 "Analyzing" 等重复词
- 保持精确: 技术术语、数字、文件名、HTTP 状态码
- 删除冠词: the, this, my, a, an
- 不假设技术栈
- 输入很短(如 "hello")时也要生成有意义的标题
```

### 6.3 何时被调用

**唯一触发条件: Session 第一步 (step === 1)**

```typescript
// prompt.ts:329
if (step === 1) ensureTitle({ sessionID, msgs, model, lastUser })
```

**注意**: `ensureTitle()` 是 **fire-and-forget** 的异步调用，不会阻塞主循环。

### 6.4 完整调用流程

```
loop() → step === 1
    ↓
ensureTitle():
  1. 查找第一条真实用户消息（非 synthetic）
  2. 验证这是 Session 的首条消息（isFirst check）
  3. 如果不是首条 → 跳过（不重复生成标题）
    ↓
  4. 模型选择（优先级从高到低）:
     a. Agent.get("title").model → title Agent 的自定义模型
     b. Provider.getSmallModel(providerID) → 该 Provider 的小模型
     c. Provider.getModel(providerID, modelID) → 用户当前模型
    ↓
  5. LLM.stream():
     - model: 小模型优先
     - small: true（触发 smallOptions: reasoningEffort="minimal" 等）
     - agent: title Agent (temperature: 0.5)
     - tools: {} （无工具）
     - retries: 2 （允许重试 2 次）
     - messages:
       [system]: "Generate a title for this conversation:\n"
       [user messages]: 上下文消息历史
    ↓
  6. 后处理:
     - 去除 <think>...</think> 标签
     - 取第一个非空行
     - 截断到 100 字符（加 "..."）
    ↓
  7. Session.setTitle(sessionID, title)
```

### 6.5 核心价值

**title 是"即时标签员"Agent**：
- **快速命名** — 使用小模型，fire-and-forget，不阻塞对话
- **多语言** — 自动使用用户语言生成标题
- **可检索** — 生成的标题帮助用户在 Session 列表中快速找到对话
- **经济高效** — 使用 small model + temperature 0.5，token 消耗极低

---

## 7. summary — 摘要计算 Agent (隐藏)

### 7.1 定义

| 属性 | 值 |
|------|-----|
| mode | `"primary"` |
| hidden | `true` |
| native | `true` |
| temperature | 无覆盖 |
| 系统提示 | `PROMPT_SUMMARY` |
| 步数限制 | 无 |
| 工具 | **无** |

### 7.2 系统提示 (summary.txt)

```
Summarize what was done in this conversation.
Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or validation
- Don't explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions
- Preserve unanswered questions at end
- Include final imperatives if present
```

### 7.3 关键发现: summary Agent 实际上**不是 LLM 驱动的**

虽然 summary Agent 被定义了系统提示，但实际的 `SessionSummary.summarize()` 函数**不调用 LLM**，而是执行 **git diff 计算**：

```typescript
// summary.ts:69-81
SessionSummary.summarize({ sessionID, messageID }):
  1. 计算 Session 级别的 diff（所有消息的文件变更汇总）
  2. 计算 Message 级别的 diff（单条用户消息的变更）
  3. 存储到 Session 字段:
     - summary_additions: 总新增行数
     - summary_deletions: 总删除行数
     - summary_files: 变更文件数
     - summary_diffs: FileDiff[] 数组
```

### 7.4 何时被调用

| 触发场景 | 触发条件 | 代码位置 |
|---------|---------|---------|
| **每步结束** | SessionProcessor finish-step 事件 | processor.ts:278 |
| **首步** | loop() step === 1 时 | prompt.ts:623 |

### 7.5 diff 计算流程

```
finish-step 事件触发 (每次 LLM 完成一步)
    ↓
SessionSummary.summarize({ sessionID, messageID })
    ↓
computeDiff():
  1. 从后向前扫描消息
  2. 找到最早的 step-start snapshot（基线快照）
  3. 找到最新的 step-finish snapshot（结束快照）
  4. Snapshot.diffFull(start, end) → 计算 git diff
  5. 返回 FileDiff[] 数组
    ↓
Session.setSummary({ additions, deletions, files })
    ↓
发布事件: Session.Event.Diff
```

### 7.6 摘要的使用场景

| 使用位置 | 用途 |
|---------|------|
| Session 列表 | 显示每个 Session 的变更统计 |
| Session 分享 | 分享 URL 中包含变更摘要 |
| ACP 协议 | 将变更统计返回给客户端 |
| 导出 | export 命令导出 Session 时包含摘要 |

### 7.7 核心价值

**summary 是"变更统计员"**：
- **实时追踪** — 每步都自动计算文件变更差异
- **零 LLM 成本** — 通过 git diff 计算，不消耗 token
- **可视化** — 在 UI 中展示 +/- 行数和变更文件数
- **分享支持** — 为 Session 分享提供变更概览

> **注**: summary Agent 的 `PROMPT_SUMMARY` 系统提示目前未在主流程中使用。它被定义为 Agent 可能是为将来的 LLM 驱动摘要功能预留。当前通过 Session share 的 API 或其他流程可能会利用该 prompt 调用 LLM 生成文字摘要。

---

## 8. 七种 Agent 对比总览

### 8.1 能力矩阵

| Agent | 读文件 | 写文件 | Shell | 搜索 | 子任务 | 提问 | Web | LLM调用 |
|-------|--------|--------|-------|------|--------|------|-----|---------|
| **build** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **plan** | ✅ | ⚠️仅计划文件 | ✅只读 | ✅ | ✅ | ✅ | ✅ | ✅ |
| **general** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **explore** | ✅ | ❌ | ✅只读 | ✅ | ❌ | ❌ | ✅ | ✅ |
| **compaction** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **title** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅(小模型) |
| **summary** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌(git diff) |

### 8.2 调用关系图

```
用户
 │
 ├─→ build (默认) ─┬─→ LLM ─→ 工具执行 ─→ 返回结果
 │                  ├─→ @general (Task tool) ─→ 独立 Session
 │                  ├─→ @explore (Task tool) ─→ 独立 Session
 │                  └─→ plan_enter → plan Agent
 │
 ├─→ plan (手动) ──┬─→ LLM ─→ 只读工具 ─→ 分析结果
 │                  ├─→ @explore (Phase 1 推荐)
 │                  └─→ plan_exit → build Agent
 │
 │  [系统自动触发]
 │
 ├── compaction ←── token 溢出检测 (每步 finish-step 后)
 ├── title ←─────── Session 首步 (step === 1, fire-and-forget)
 └── summary ←───── 每步结束 (非 LLM, git diff 计算)
```

### 8.3 价值定位总结

| Agent | 角色定位 | 一句话价值 |
|-------|---------|-----------|
| **build** | 主力执行者 | 具备完整能力的 AI 编程助手，可以读写代码、执行命令、调度子任务 |
| **plan** | 安全规划师 | 在只读模式下分析代码并产出正式计划，防止未经思考的代码修改 |
| **general** | 全能助手 | 可并行的独立工作者，在独立上下文中执行复杂多步任务 |
| **explore** | 安全侦察兵 | 零风险的代码搜索专家，快速定位文件和代码片段 |
| **compaction** | 记忆管理员 | 在上下文接近溢出时自动压缩，通过 LLM 摘要保留关键信息 |
| **title** | 即时标签员 | 用小模型快速生成会话标题，帮助用户管理多个对话 |
| **summary** | 变更统计员 | 通过 git diff 实时追踪文件变更，提供 +/- 行数统计 |
