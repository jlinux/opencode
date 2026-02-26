# 05 - Plan Agent 实现详解

## 目录

1. [概述与设计目标](#1-概述与设计目标)
2. [Agent 定义与权限配置](#2-agent-定义与权限配置)
3. [Plan 模式的进入机制](#3-plan-模式的进入机制)
4. [Plan 文件机制](#4-plan-文件机制)
5. [System Prompt 组装 — Plan vs Build](#5-system-prompt-组装--plan-vs-build)
6. [insertReminders() — 模式感知的 Prompt 注入](#6-insertreminders--模式感知的-prompt-注入)
7. [Plan 模式的 5 阶段工作流](#7-plan-模式的-5-阶段工作流)
8. [plan_exit 工具 — 退出机制](#8-plan_exit-工具--退出机制)
9. [plan_enter 工具 — 进入机制（已注释）](#9-plan_enter-工具--进入机制已注释)
10. [Session 循环中的 Plan 检测流程](#10-session-循环中的-plan-检测流程)
11. [UI 层面的 Plan 交互](#11-ui-层面的-plan-交互)
12. [Plan Agent 在整体体系中的作用](#12-plan-agent-在整体体系中的作用)
13. [完整生命周期流程图](#13-完整生命周期流程图)
14. [与其他 Agent 的对比总结](#14-与其他-agent-的对比总结)

---

## 1. 概述与设计目标

### 1.1 Plan Agent 是什么

Plan Agent 是 OpenCode 中的一个 **primary 模式的只读规划 Agent**。它的核心设计理念是**在执行前先思考**——让 LLM 在一个受约束的环境中分析问题、探索代码、设计方案，然后生成一份结构化的实施计划，经用户确认后再切换回 Build Agent 执行。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| **防止盲目执行** | 复杂任务中 LLM 容易直接开始修改代码，Plan 模式强制其先分析再行动 |
| **用户可控性** | 用户在实施前可以审查、修改、批准计划，避免不期望的代码变更 |
| **知识积累** | 计划文件保存在 `.opencode/plans/` 目录，可以作为项目文档和决策记录 |
| **安全隔离** | 权限层面禁止所有编辑操作（除计划文件本身），确保不会意外修改代码 |
| **结构化思考** | 通过 5 阶段工作流引导 LLM 进行系统性的分析和规划 |

### 1.3 当前状态

Plan Agent 是一个**实验性功能**，需要通过环境变量启用：

```typescript
// flag.ts:53
export const OPENCODE_EXPERIMENTAL_PLAN_MODE = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_PLAN_MODE")
```

启用方式：
- 设置 `OPENCODE_EXPERIMENTAL_PLAN_MODE=true`
- 或设置 `OPENCODE_EXPERIMENTAL=true`（启用所有实验功能）

工具注册条件（`tool/registry.ts:122`）：
```typescript
...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [PlanExitTool] : []),
```

**限制**：仅在 CLI 客户端可用（`OPENCODE_CLIENT === "cli"`），不在 Web/Desktop 中注册。

---

## 2. Agent 定义与权限配置

### 2.1 Plan Agent 定义

**文件**：`packages/opencode/src/agent/agent.ts:92-114`

```typescript
plan: {
  name: "plan",
  description: "Plan mode. Disallows all edit tools.",
  options: {},
  permission: PermissionNext.merge(
    defaults,
    PermissionNext.fromConfig({
      question: "allow",
      plan_exit: "allow",
      external_directory: {
        [path.join(Global.Path.data, "plans", "*")]: "allow",
      },
      edit: {
        "*": "deny",
        [path.join(".opencode", "plans", "*.md")]: "allow",
        [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
      },
    }),
    user,
  ),
  mode: "primary",
  native: true,
}
```

### 2.2 Build Agent 定义（对比）

**文件**：`packages/opencode/src/agent/agent.ts:77-91`

```typescript
build: {
  name: "build",
  description: "The default agent. Executes tools based on configured permissions.",
  options: {},
  permission: PermissionNext.merge(
    defaults,
    PermissionNext.fromConfig({
      question: "allow",
      plan_enter: "allow",
    }),
    user,
  ),
  mode: "primary",
  native: true,
}
```

### 2.3 默认权限基线

**文件**：`packages/opencode/src/agent/agent.ts:56-73`

```typescript
const defaults = PermissionNext.fromConfig({
  "*": "allow",
  doom_loop: "ask",
  external_directory: {
    "*": "ask",
    ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
  },
  question: "deny",
  plan_enter: "deny",    // 默认禁止进入 Plan
  plan_exit: "deny",     // 默认禁止退出 Plan
  read: {
    "*": "allow",
    "*.env": "ask",
    "*.env.*": "ask",
    "*.env.example": "allow",
  },
})
```

### 2.4 权限差异对比表

| 权限项 | 默认值 | Build Agent | Plan Agent | 说明 |
|--------|--------|-------------|-----------|------|
| `*`（所有工具） | allow | 继承 allow | 继承 allow | 基础权限 |
| `question` | deny | **allow** | **allow** | 都可以向用户提问 |
| `plan_enter` | deny | **allow** | 继承 deny | 仅 Build 可触发进入 Plan |
| `plan_exit` | deny | 继承 deny | **allow** | 仅 Plan 可触发退出到 Build |
| `edit.*` | allow | 继承 allow | **deny** | Plan 禁止所有编辑 |
| `edit` plan files | allow | 继承 allow | **allow** | Plan 仅允许编辑计划文件 |
| `external_directory` plans | ask | 继承 ask | **allow** | Plan 允许访问计划目录 |
| `read` | allow | 继承 allow | 继承 allow | 两者都可读取文件 |
| `doom_loop` | ask | 继承 ask | 继承 ask | 循环检测 |

**关键设计**：Plan Agent 的权限是一个"白名单 + 黑名单"混合模式：
- 继承默认的 allow 所有工具（可以读文件、搜索、运行 bash 等）
- 覆盖 `edit: { "*": "deny" }` 禁止所有编辑
- 精确允许 `.opencode/plans/*.md` 的编辑
- 精确允许 `plan_exit` 工具

---

## 3. Plan 模式的进入机制

### 3.1 三种进入路径

#### 路径 1：用户通过 UI 切换 Agent

**TUI**：用户在终端 UI 中通过快捷键或 Agent 选择器切换到 "plan" Agent。

**Web UI**：用户在提示输入框中使用 `@plan` 指定 Agent。

```typescript
// app/src/components/prompt-input/slash-popover.tsx
// Agent 显示为 @agent 选项
if (item.type === "agent") {
  return (
    <button>
      <Icon name="brain" size="small" />
      <span>@{item.name}</span>
    </button>
  )
}
```

当用户发送消息时，`agent: "plan"` 被写入用户消息的 `agent` 字段。

#### 路径 2：通过 API 直接指定

```
POST /session/{sessionID}/message
{
  "agent": "plan",
  "parts": [{ "type": "text", "text": "..." }]
}
```

#### 路径 3：plan_enter 工具（已注释，未启用）

Build Agent 有 `plan_enter: "allow"` 权限，原设计是 LLM 可以在 Build 模式中主动调用 `plan_enter` 工具切换到 Plan 模式。但该工具目前已被注释掉。

### 3.2 进入时的消息创建

**文件**：`packages/opencode/src/session/prompt.ts:954-977`

```typescript
async function createUserMessage(input: PromptInput) {
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))

  const info: MessageV2.Info = {
    id: input.messageID ?? Identifier.ascending("message"),
    role: "user",
    sessionID: input.sessionID,
    time: { created: Date.now() },
    agent: agent.name,   // ← "plan" 存入消息
    model,
    // ...
  }
}
```

**关键点**：Agent 名称存储在每条用户消息中，Session 循环通过读取最后一条用户消息的 `agent` 字段来确定当前应使用哪个 Agent。

---

## 4. Plan 文件机制

### 4.1 路径生成

**文件**：`packages/opencode/src/session/index.ts:328-333`

```typescript
export function plan(input: { slug: string; time: { created: number } }) {
  const base = Instance.project.vcs
    ? path.join(Instance.worktree, ".opencode", "plans")
    : path.join(Global.Path.data, "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}
```

**路径规则**：

| 场景 | 路径 | 示例 |
|------|------|------|
| Git 仓库项目 | `{worktree}/.opencode/plans/{timestamp}-{slug}.md` | `.opencode/plans/1735689600-happy-waddling-feigenbaum.md` |
| 非 VCS 项目 | `{Global.Path.data}/plans/{timestamp}-{slug}.md` | `~/.opencode/data/plans/1735689600-slug.md` |

- `timestamp`：Session 创建时间戳
- `slug`：Session 的随机生成 slug（如 `happy-waddling-feigenbaum`）

### 4.2 目录创建

进入 Plan 模式时自动创建目录：

```typescript
// prompt.ts 中 insertReminders()
const plan = Session.plan(input.session)
const exists = await Filesystem.exists(plan)
if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
```

### 4.3 文件内容规范

Plan 文件是普通 Markdown 文件，由 LLM 在 Plan 模式下撰写。系统提示中规定了内容要求：

```
Plan File Guidelines:
- 仅包含最终推荐方案，不包含所有备选方案
- 简洁但足以有效执行
- 包含需要修改的关键文件路径
- 包含验证部分，描述如何端到端测试变更
```

### 4.4 文件的后续使用

当从 Plan 切回 Build 模式时，系统会注入引用计划文件的指令：

```
A plan file exists at {plan}. You should execute on the plan defined within it
```

Build Agent 可以读取该文件并按照计划执行。

---

## 5. System Prompt 组装 — Plan vs Build

### 5.1 关键发现：Plan 和 Build 共享相同的 Provider 提示词

Plan Agent 和 Build Agent 都**没有**设置 `agent.prompt` 字段，这意味着它们都使用 `SystemPrompt.provider(model)` 选择的 Provider 提示词。

```typescript
// llm.ts:72
...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
```

- Plan Agent: `prompt` = undefined → 使用 Provider 提示词（如 anthropic.txt）
- Build Agent: `prompt` = undefined → 使用 Provider 提示词（如 anthropic.txt）

### 5.2 区别在哪里？

Plan 模式的特殊行为不是通过 `agent.prompt` 实现的，而是通过以下两个机制：

1. **权限系统** — `edit: { "*": "deny" }` 在工具解析阶段过滤掉编辑工具
2. **insertReminders()** — 在消息序列中注入 Plan 模式的合成提示

### 5.3 对比图

```
Build Agent 的 System 消息:
┌─────────────────────────────────────────┐
│ Provider 提示词 (如 anthropic.txt)       │ ← 与 Plan 相同
│ + 环境信息                               │ ← 与 Plan 相同
│ + 指令文件 (CLAUDE.md 等)                │ ← 与 Plan 相同
│ + 用户自定义 system                      │
└─────────────────────────────────────────┘
消息序列中: 无特殊注入

Plan Agent 的 System 消息:
┌─────────────────────────────────────────┐
│ Provider 提示词 (如 anthropic.txt)       │ ← 与 Build 相同
│ + 环境信息                               │ ← 与 Build 相同
│ + 指令文件 (CLAUDE.md 等)                │ ← 与 Build 相同
│ + 用户自定义 system                      │
└─────────────────────────────────────────┘
消息序列中: 注入 Plan 模式 <system-reminder>  ← 关键区别
工具列表中: 编辑工具被过滤掉                    ← 关键区别
```

---

## 6. insertReminders() — 模式感知的 Prompt 注入

**文件**：`packages/opencode/src/session/prompt.ts:1321-1459`

这是 Plan Agent 最核心的逻辑所在。`insertReminders()` 函数在每次 Session 循环迭代中被调用，检测 Agent 切换并注入相应的提示。

### 6.1 两种模式：Legacy vs Experimental

```typescript
async function insertReminders(input: {
  messages: MessageV2.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  if (!Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE) {
    // Legacy 模式：简单注入
    // ...
  }

  // Experimental 模式：增强版注入
  // ...
}
```

### 6.2 Legacy 模式（OPENCODE_EXPERIMENTAL_PLAN_MODE = false）

**行号**：1326-1349

```typescript
// 当 Agent 是 plan 时，追加 PROMPT_PLAN
if (input.agent.name === "plan") {
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: PROMPT_PLAN,   // ← plan.txt 的完整内容
    synthetic: true,
  })
}

// 当从 plan 切换回 build 时，追加 BUILD_SWITCH
const wasPlan = input.messages.some(
  (msg) => msg.info.role === "assistant" && msg.info.agent === "plan"
)
if (wasPlan && input.agent.name === "build") {
  userMessage.parts.push({
    type: "text",
    text: BUILD_SWITCH,  // ← build-switch.txt 的完整内容
    synthetic: true,
  })
}
```

**特点**：
- 简单直接，每次进入 plan 都注入 `plan.txt` 的静态内容
- 无计划文件路径信息
- 无 5 阶段工作流指导

### 6.3 Experimental 模式（OPENCODE_EXPERIMENTAL_PLAN_MODE = true）

**行号**：1351-1459

#### 场景 A：从 Plan 切换到 Build（退出 Plan）

```typescript
const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
  const plan = Session.plan(input.session)
  const exists = await Filesystem.exists(plan)
  if (exists) {
    const part = await Session.updatePart({
      type: "text",
      text: BUILD_SWITCH + "\n\n" +
        `A plan file exists at ${plan}. You should execute on the plan defined within it`,
      synthetic: true,
    })
    userMessage.parts.push(part)
  }
  return input.messages
}
```

**注入内容**：`build-switch.txt` + 计划文件路径 + 执行指令

#### 场景 B：进入 Plan 模式（首次）

```typescript
if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
  const plan = Session.plan(input.session)
  const exists = await Filesystem.exists(plan)
  if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })

  const part = await Session.updatePart({
    type: "text",
    text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet...

## Plan File Info:
${exists
  ? `A plan file already exists at ${plan}. You can read it and make incremental edits.`
  : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`
}

## Plan Workflow
### Phase 1: Initial Understanding
...（5 阶段工作流完整内容）...
### Phase 5: Call plan_exit tool
...
</system-reminder>`,
    synthetic: true,
  })
  userMessage.parts.push(part)
}
```

**注入内容**：动态生成的长提示，包含：
- READ-ONLY 约束声明
- 计划文件路径（动态生成）
- 计划文件是否已存在的上下文
- 完整的 5 阶段工作流指导（约 70 行）

#### 场景 C：继续处于 Plan 模式

不注入任何内容，消息序列不变。

### 6.4 合成消息的特点

所有注入都是 `synthetic: true` 的文本 part，这意味着：
- 它们是系统自动生成的，不是用户手动输入的
- 在 UI 中可能被特殊显示或隐藏
- LLM 会在消息序列中看到它们，如同真实的用户输入

---

## 7. Plan 模式的 5 阶段工作流

Experimental 模式下，系统注入一个结构化的 5 阶段工作流来引导 LLM 进行规划。

### Phase 1: Initial Understanding（初步理解）

**目标**：全面理解用户需求，通过阅读代码和提问获取上下文。

**规则**：
- 本阶段仅使用 Explore 子 Agent 类型
- 最多并行启动 3 个 Explore Agent（单条消息、多个工具调用）
- 每个 Agent 负责不同的搜索方向（如：现有实现、相关组件、测试模式）
- 质量重于数量，通常 1 个 Agent 就够了
- 使用 `question` 工具向用户澄清歧义

**Agent 数量决策**：
- 1 个 Agent：任务局限于已知文件、用户提供了具体路径、小范围定向修改
- 多个 Agent：范围不确定、涉及多个代码区域、需要理解现有模式

### Phase 2: Design（设计）

**目标**：基于 Phase 1 的探索结果设计实施方案。

**规则**：
- 启动 General Agent（最多 1 个）进行方案设计
- 提供背景上下文但不预设具体设计
- 请求详细的实施计划
- 默认启动至少 1 个 Plan Agent — 它有助于验证理解和考虑替代方案
- 仅对真正琐碎的任务跳过（拼写错误、单行修改）

### Phase 3: Review（评审）

**目标**：综合 Phase 2 的方案，确保与用户意图对齐。

**规则**：
- 读取 Agent 识别出的关键文件，加深理解
- 确保方案与用户原始请求一致
- 使用 `question` 工具向用户确认权衡

### Phase 4: Final Plan（最终计划）

**目标**：将最终方案写入计划文件。

**内容要求**：
- 仅包含推荐方案和理由，不包含所有备选方案
- 简洁但足以有效执行
- 包含需要修改的关键文件路径
- 包含验证部分（如何测试变更）

### Phase 5: Call plan_exit（退出规划）

**目标**：调用 `plan_exit` 工具通知用户规划完成。

**规则**：
- 转弯应该只在两种情况下结束：向用户提问 或 调用 `plan_exit`
- **重要**：使用 `question` 工具澄清需求/方案，使用 `plan_exit` 请求计划批准
- **不要**用 `question` 工具问"这个计划可以吗？"——这正是 `plan_exit` 的作用

---

## 8. plan_exit 工具 — 退出机制

### 8.1 工具定义

**文件**：`packages/opencode/src/tool/plan.ts:19-72`

```typescript
export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    // ...
  },
})
```

### 8.2 工具描述

**文件**：`packages/opencode/src/tool/plan-exit.txt`

```
Use this tool when you have completed the planning phase and are ready to exit plan agent.

This tool will ask the user if they want to switch to build agent to start implementing the plan.

Call this tool:
- After you have written a complete plan to the plan file
- After you have clarified any questions with the user
- When you are confident the plan is ready for implementation

Do NOT call this tool:
- Before you have created or finalized the plan
- If you still have unanswered questions about the implementation
- If the user has indicated they want to continue planning
```

### 8.3 执行流程

```typescript
async execute(_params, ctx) {
  // 1. 获取 Session 和计划文件路径
  const session = await Session.get(ctx.sessionID)
  const plan = path.relative(Instance.worktree, Session.plan(session))

  // 2. 向用户提问：是否切换到 Build
  const answers = await Question.ask({
    sessionID: ctx.sessionID,
    questions: [{
      question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
      header: "Build Agent",
      custom: false,
      options: [
        { label: "Yes", description: "Switch to build agent and start implementing the plan" },
        { label: "No", description: "Stay with plan agent to continue refining the plan" },
      ],
    }],
    tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
  })

  // 3. 用户选择 "No" → 抛出 RejectedError，留在 Plan 模式
  const answer = answers[0]?.[0]
  if (answer === "No") throw new Question.RejectedError()

  // 4. 用户选择 "Yes" → 创建新的 Build 用户消息
  const model = await getLastModel(ctx.sessionID)
  const userMsg: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID: ctx.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",        // ← 关键：切换到 Build Agent
    model,
  }
  await Session.updateMessage(userMsg)

  // 5. 追加合成文本，指示执行计划
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: userMsg.id,
    sessionID: ctx.sessionID,
    type: "text",
    text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
    synthetic: true,
  })

  // 6. 返回成功
  return {
    title: "Switching to build agent",
    output: "User approved switching to build agent. Wait for further instructions.",
    metadata: {},
  }
}
```

### 8.4 退出后的连锁反应

1. `plan_exit` 创建了 `agent: "build"` 的新用户消息
2. Session 循环的 `while(true)` 继续下一次迭代
3. 读取到 `lastUser.agent = "build"`
4. 调用 `Agent.get("build")` 获取 Build Agent 配置
5. `insertReminders()` 检测到从 plan → build 的切换
6. 注入 `BUILD_SWITCH` + 计划文件路径
7. Build Agent 获得完整编辑权限
8. LLM 读取计划文件并执行

---

## 9. plan_enter 工具 — 进入机制（已注释）

### 9.1 当前状态

**文件**：`packages/opencode/src/tool/plan.ts:74-131`

`PlanEnterTool` 的完整实现存在于代码中但被**注释掉了**（`/* ... */`）。

### 9.2 原始设计

```typescript
export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    // 1. 向用户确认是否进入 Plan 模式
    const answers = await Question.ask({
      questions: [{
        question: `Would you like to switch to the plan agent and create a plan saved to ${plan}?`,
        options: [
          { label: "Yes", description: "Switch to plan agent for research and planning" },
          { label: "No", description: "Stay with build agent to continue making changes" },
        ],
      }],
    })

    if (answer === "No") throw new Question.RejectedError()

    // 2. 创建 agent: "plan" 的新用户消息
    const userMsg = {
      agent: "plan",
      // ...
    }
    await Session.updateMessage(userMsg)

    // 3. 追加合成文本
    await Session.updatePart({
      text: "User has requested to enter plan mode. Switch to plan mode and begin planning.",
      synthetic: true,
    })
  },
})
```

### 9.3 工具描述

**文件**：`packages/opencode/src/tool/plan-enter.txt`

```
Use this tool to suggest switching to plan agent when the user's request would
benefit from planning before implementation.

If they explicitly mention wanting to create a plan ALWAYS call this tool first.

Call this tool when:
- The user's request is complex and would benefit from planning first
- You want to research and design before making changes
- The task involves multiple files or significant architectural decisions

Do NOT call this tool:
- For simple, straightforward tasks
- When the user explicitly wants immediate implementation
```

### 9.4 为什么被注释？

虽然代码中没有明确说明，可能的原因：
- Plan 模式仍处于实验阶段，自动进入可能不够稳定
- 用户手动切换 Agent 已经足够
- 避免 LLM 过度主动地进入 Plan 模式（可能中断用户工作流）

---

## 10. Session 循环中的 Plan 检测流程

### 10.1 核心循环片段

**文件**：`packages/opencode/src/session/prompt.ts`

```
SessionPrompt.loop(sessionID)
│
├─ 加载消息历史（行 298）
│   msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
│
├─ 扫描消息，找到最后的用户/助手消息（行 300-315）
│   lastUser → 包含 agent 字段
│   lastAssistant → 包含上一次的 agent 字段
│
├─ 获取当前 Agent（行 557）
│   agent = await Agent.get(lastUser.agent)
│   // 如果 lastUser.agent = "plan"，获取 Plan Agent 配置
│
├─ 调用 insertReminders()（行 560）
│   messages = insertReminders({ messages, agent, session })
│   // 检测模式变化，注入合成提示
│
├─ 创建助手消息（行 566-595）
│   assistantMessage = { agent: agent.name, ... }
│
├─ 解析工具（行 602-620）
│   tools = await resolveTools({ agent, ... })
│   // Plan Agent: edit 工具被 permission 过滤掉
│   // Build Agent: 所有工具可用
│
├─ 构建 system prompt + 调用 LLM（行 650+）
│   system = [SystemPrompt.environment(), InstructionPrompt.system()]
│   result = await LLM.stream({ messages, tools, system })
│
└─ LLM 生成响应
    └─ Plan Agent 可能调用 plan_exit
        → 创建 build 用户消息
        → 循环回到顶部
```

### 10.2 Agent 追踪机制

Agent 状态没有独立的状态变量，而是通过**消息序列中的 agent 字段**来追踪：

```
消息序列:
[User msg #1: agent="build"]  →  [Assistant msg #1: agent="build"]
[User msg #2: agent="plan"]   →  [Assistant msg #2: agent="plan"]  ← Plan 模式
[User msg #3: agent="plan"]   →  [Assistant msg #3: agent="plan"]  ← 继续 Plan
[User msg #4: agent="build"]  →  [Assistant msg #4: agent="build"] ← 回到 Build
       ↑                                    ↑
  由用户选择或 plan_exit 创建          继承用户消息的 agent
```

`insertReminders()` 通过比较**最后一条用户消息的 agent** 和**最后一条助手消息的 agent** 来检测模式切换。

---

## 11. UI 层面的 Plan 交互

### 11.1 TUI 自动切换

**文件**：`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:206-221`

TUI 监听工具完成事件，自动同步 UI 层的 Agent 状态：

```typescript
let lastSwitch: string | undefined = undefined
sdk.event.on("message.part.updated", (evt) => {
  const part = evt.properties.part
  if (part.type !== "tool") return
  if (part.sessionID !== route.sessionID) return
  if (part.state.status !== "completed") return
  if (part.id === lastSwitch) return

  if (part.tool === "plan_exit") {
    local.agent.set("build")   // ← 自动切换 UI 到 Build
    lastSwitch = part.id
  } else if (part.tool === "plan_enter") {
    local.agent.set("plan")    // ← 自动切换 UI 到 Plan
    lastSwitch = part.id
  }
})
```

**效果**：当 `plan_exit` 工具执行完成后，TUI 的 Agent 选择器自动切换到 Build，用户无需手动操作。

### 11.2 Web UI Agent 管理

**文件**：`packages/app/src/context/local.tsx:36-81`

Web UI 通过响应式 store 管理 Agent 状态：

```typescript
const agent = (() => {
  const list = createMemo(() =>
    sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden)
  )
  const [store, setStore] = createStore<{ current?: string }>({
    current: list()[0]?.name,
  })
  return {
    list,                              // 可用 Agent 列表（排除 subagent 和 hidden）
    current() { /* 获取当前 */ },
    set(name: string | undefined) { /* 设置 Agent */ },
    move(direction: 1 | -1) { /* 循环切换 */ },
  }
})()
```

Plan Agent 因为 `mode: "primary"` 且 `hidden` 未设置（不是 hidden），所以会出现在可选列表中。

### 11.3 Plan 文件的展示

当前没有专用的 Plan 文件查看/比较 UI 组件。Plan 文件作为：
- 普通 Markdown 文件存在于文件系统中
- 通过 read 工具被 LLM 读取
- 在系统提示中以文件路径方式引用
- 用户需要自行打开文件查看（或请 LLM 读取展示）

---

## 12. Plan Agent 在整体体系中的作用

### 12.1 在 7 种 Agent 中的定位

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenCode Agent 体系                         │
│                                                                 │
│  用户交互层（Primary Agents）:                                   │
│  ┌──────────┐  ┌──────────┐                                     │
│  │  Build   │←→│  Plan    │  ← 双向切换（plan_exit / UI选择）    │
│  │ (默认)   │  │ (只读)   │                                     │
│  └────┬─────┘  └────┬─────┘                                     │
│       │              │                                          │
│  子 Agent 层（Subagents）:                                       │
│  ┌──────────┐  ┌──────────┐                                     │
│  │ General  │  │ Explore  │  ← Build 和 Plan 都可调用           │
│  └──────────┘  └──────────┘                                     │
│                                                                 │
│  隐藏 Agent 层（Hidden，系统自动调用）:                            │
│  ┌────────────┐  ┌────────┐  ┌──────────┐                       │
│  │ Compaction │  │ Title  │  │ Summary  │                       │
│  └────────────┘  └────────┘  └──────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 核心价值

#### 价值 1：思考-执行分离

Plan Agent 实现了 **"先思考再行动"** 的范式：

| 阶段 | Agent | 能力 | 不能做 |
|------|-------|------|--------|
| 思考阶段 | Plan | 读代码、搜索、提问、设计方案、写计划 | 修改代码、运行构建、提交 |
| 执行阶段 | Build | 所有操作 | - |

这种分离避免了 LLM 在复杂任务中"边想边改"导致的代码混乱。

#### 价值 2：用户参与决策

Plan 模式在 LLM 和用户之间建立了一个**审批门控**：

```
用户请求 → Plan Agent 分析 → 生成计划 → plan_exit 请求确认
                                              ↓
                                        用户审查计划
                                              ↓
                                   Yes: 切到 Build 执行
                                   No: 继续优化计划
```

用户始终保持对变更方向的控制权。

#### 价值 3：结构化分析

5 阶段工作流将 LLM 的分析过程结构化：

1. **理解** → 使用 Explore Agent 探索代码
2. **设计** → 使用 General Agent 设计方案
3. **评审** → 读关键文件，验证方案
4. **记录** → 写入计划文件
5. **确认** → 与用户对齐

这比直接让 LLM 自由发挥更容易产出高质量方案。

#### 价值 4：计划文件作为文档

`.opencode/plans/` 中的计划文件可以：
- 被 Git 版本管理追踪（在 VCS 项目中）
- 作为架构决策记录（ADR）保存
- 在团队协作中共享设计方案
- 在后续会话中被重新引用

#### 价值 5：安全网

权限系统确保 Plan 模式下**绝对不会**意外修改代码：

```
Plan Agent 权限矩阵:
  edit *.ts       → deny ✗
  edit *.tsx      → deny ✗
  edit *.json     → deny ✗
  edit *.md       → deny ✗ (除 .opencode/plans/*.md)
  write 任意文件  → deny ✗
  bash rm/mv/etc  → 权限系统过滤 ✗
  read 任意文件   → allow ✓
  grep/glob       → allow ✓
  question        → allow ✓
  plan_exit       → allow ✓
```

### 12.3 与 Claude Code Plan Mode 的关系

OpenCode 的 Plan Agent 设计受到了 Claude Code 的影响，在 `plan-reminder-anthropic.txt` 中可以看到类似 Claude Code 的 `ExitPlanMode` 概念。但 OpenCode 的实现有自己的特点：

| 方面 | OpenCode Plan Agent | Claude Code Plan Mode |
|------|--------------------|-----------------------|
| 计划存储 | `.opencode/plans/*.md` 文件 | 内存中的临时计划 |
| 退出机制 | `plan_exit` 工具 + 用户确认 | `ExitPlanMode` 工具 |
| 进入机制 | UI 选择 / API 指定 | `EnterPlanMode` 工具 |
| 工作流 | 5 阶段结构化流程 | 探索 → 设计 → 审批 |
| 持久性 | 计划文件持久保存 | 会话内临时 |
| 实验状态 | 需要 Feature Flag 启用 | 生产就绪 |

---

## 13. 完整生命周期流程图

```
用户："我需要实现一个复杂的新功能"
│
▼ 用户在 UI 选择 @plan Agent
│
├─── createUserMessage({ agent: "plan" })
│    └─ 消息存储: { agent: "plan", model: {...}, parts: [...] }
│
▼ SessionPrompt.loop() 开始
│
├─── Step 1: 进入 Plan 模式
│    │
│    ├─ lastUser.agent = "plan"
│    ├─ lastAssistant = undefined (首次)
│    ├─ agent = Agent.get("plan") → Plan Agent 配置
│    │
│    ├─ insertReminders() 检测:
│    │   ├─ agent.name === "plan" ✓
│    │   ├─ lastAssistant?.agent !== "plan" ✓
│    │   └─ → 注入 Plan 工作流 <system-reminder>
│    │       ├─ READ-ONLY 约束
│    │       ├─ 计划文件路径: .opencode/plans/xxx.md
│    │       └─ 5 阶段工作流指导
│    │
│    ├─ resolveTools():
│    │   ├─ edit 工具被过滤（deny）
│    │   ├─ write 工具被过滤（deny，除 plan file）
│    │   ├─ read/grep/glob/bash(只读) 保留
│    │   ├─ question 保留
│    │   └─ plan_exit 保留
│    │
│    ├─ LLM.stream() → Plan Agent 执行:
│    │   │
│    │   ├─ Phase 1: 启动 Explore Agent 探索代码
│    │   │   └─ "我来分析一下涉及的模块..."
│    │   │
│    │   ├─ Phase 2: 启动 General Agent 设计方案
│    │   │   └─ "基于分析，我建议以下方案..."
│    │   │
│    │   ├─ Phase 3: 向用户确认
│    │   │   └─ question("你倾向于方案 A 还是方案 B?")
│    │   │   ← 用户回答: "方案 A"
│    │   │
│    │   ├─ Phase 4: 写入计划文件
│    │   │   └─ write(".opencode/plans/xxx.md", planContent)
│    │   │
│    │   └─ Phase 5: 调用 plan_exit
│    │       └─ plan_exit()
│    │
│    └─ plan_exit 执行:
│        ├─ 弹窗: "Plan at xxx.md is complete. Switch to build?"
│        ├─ 用户: "Yes"
│        ├─ 创建新消息: { agent: "build", parts: ["Execute the plan"] }
│        └─ 返回工具结果
│
├─── Step 2: 切换到 Build 模式
│    │
│    ├─ lastUser.agent = "build" (新消息)
│    ├─ lastAssistant.agent = "plan" (上一步)
│    ├─ agent = Agent.get("build") → Build Agent 配置
│    │
│    ├─ insertReminders() 检测:
│    │   ├─ agent.name !== "plan" ✓
│    │   ├─ lastAssistant?.agent === "plan" ✓
│    │   └─ → 注入 BUILD_SWITCH + 计划文件路径
│    │       "A plan file exists at xxx.md. Execute the plan."
│    │
│    ├─ resolveTools():
│    │   └─ 所有工具可用 ✓
│    │
│    └─ LLM.stream() → Build Agent 执行:
│        ├─ 读取计划文件
│        ├─ 按计划逐步修改代码
│        ├─ 运行测试验证
│        └─ 完成实施
│
└─── 完成
```

---

## 14. 与其他 Agent 的对比总结

| 维度 | Build | Plan | General | Explore |
|------|-------|------|---------|---------|
| **模式** | primary | primary | subagent | subagent |
| **设计目标** | 执行变更 | 分析规划 | 通用研究 | 文件搜索 |
| **可编辑文件** | 全部 | 仅 plan 文件 | 全部 | 无 |
| **可用工具** | 全部 | 受限（只读+plan_exit） | 全部 | 8 个特定工具 |
| **agent.prompt** | 无（Provider） | 无（Provider） | 无（Provider） | explore.txt |
| **特殊注入** | BUILD_SWITCH（从plan来时） | 5阶段工作流 | 无 | 无 |
| **输出** | 代码变更 | 计划文件(.md) | 研究结果 | 文件路径列表 |
| **用户确认** | 无 | plan_exit 确认 | 无 | 无 |
| **持久化结果** | 代码变更（Git） | 计划文件（.opencode/） | 子会话消息 | 子会话消息 |
| **实验状态** | 生产就绪 | 需要 Feature Flag | 生产就绪 | 生产就绪 |
| **工作流引导** | 无特殊引导 | 5 阶段结构化流程 | 无特殊引导 | 按 thoroughness 调整 |

### 核心总结

Plan Agent 是 OpenCode Agent 体系中**唯一专注于"不做事"的 Agent**——它的价值恰恰在于**限制**而非能力：

1. **限制编辑** → 确保思考阶段不会意外改代码
2. **限制退出** → 通过 plan_exit 门控确保计划经过用户审批
3. **结构化引导** → 5 阶段工作流确保分析的系统性和全面性
4. **持久化计划** → 计划文件作为执行蓝图和决策记录
5. **双向切换** → 与 Build Agent 形成"思考-执行"的完整闭环
