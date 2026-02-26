# 04 - SystemPrompt 组装详解

## 目录

1. [概述](#1-概述)
2. [Prompt 文件总览](#2-prompt-文件总览)
3. [SystemPrompt 命名空间](#3-systemprompt-命名空间)
4. [InstructionPrompt 命名空间](#4-instructionprompt-命名空间)
5. [LLM.stream() 中的最终组装](#5-llmstream-中的最终组装)
6. [SessionPrompt 中的 system 数组构建](#6-sessionprompt-中的-system-数组构建)
7. [各 Agent 的 Prompt 组装差异](#7-各-agent-的-prompt-组装差异)
8. [Provider 系统提示词完整内容](#8-provider-系统提示词完整内容)
9. [Agent 专属提示词完整内容](#9-agent-专属提示词完整内容)
10. [模式切换与特殊提示词完整内容](#10-模式切换与特殊提示词完整内容)
11. [结构化输出处理](#11-结构化输出处理)
12. [Plan Mode Reminder 注入机制](#12-plan-mode-reminder-注入机制)
13. [完整组装流程图](#13-完整组装流程图)
14. [总结对比表](#14-总结对比表)

---

## 1. 概述

OpenCode 的 System Prompt 组装是一个**多层级、条件化**的过程。最终发送给 LLM 的系统提示由以下几个来源组合而成：

1. **Provider 系统提示词** — 根据模型 ID 选择对应的提示词文件（anthropic.txt / beast.txt / gemini.txt 等）
2. **Agent 专属提示词** — 子 Agent（compaction/title/summary/explore）有自己的 prompt，会替代 Provider 提示词
3. **环境信息** — 模型名称、工作目录、平台、日期等运行时信息
4. **指令文件** — CLAUDE.md / AGENTS.md / CONTEXT.md 等项目级和全局级指令文件
5. **模式提示词** — Plan 模式、Build 切换、Max Steps 等状态相关提示
6. **用户自定义系统提示** — 用户消息中携带的自定义 system prompt
7. **插件变换** — 通过 Plugin.trigger 允许插件修改 system 数组

核心代码文件：
- `packages/opencode/src/session/system.ts` — SystemPrompt 命名空间（54 行）
- `packages/opencode/src/session/instruction.ts` — InstructionPrompt 命名空间（~192 行）
- `packages/opencode/src/session/llm.ts` — LLM.stream() 最终组装（~256 行）
- `packages/opencode/src/session/prompt.ts` — SessionPrompt 循环与 system 数组构建

---

## 2. Prompt 文件总览

### 2.1 Provider 系统提示词文件（被 SystemPrompt.provider() 引用）

| 文件 | 变量名 | 匹配条件 | 行数 | 风格特点 |
|------|--------|----------|------|----------|
| `session/prompt/codex_header.txt` | PROMPT_CODEX | `model.api.id.includes("gpt-5")` | 80 | OpenAI Codex 风格，编辑约束、Git 规范、前端设计 |
| `session/prompt/beast.txt` | PROMPT_BEAST | `includes("gpt-")` 或 `includes("o1")` 或 `includes("o3")` | 148 | 激进自主 Agent，互联网研究、递归 URL 抓取、Memory 系统 |
| `session/prompt/gemini.txt` | PROMPT_GEMINI | `includes("gemini-")` | 156 | 详细工作流（5 阶段）、安全规范、新应用创建流程 |
| `session/prompt/anthropic.txt` | PROMPT_ANTHROPIC | `includes("claude")` | 106 | TodoWrite 强调、Task 工具策略、代码引用 |
| `session/prompt/trinity.txt` | PROMPT_TRINITY | `toLowerCase().includes("trinity")` | 98 | 极简风格，每消息一个工具，lint/typecheck 强调 |
| `session/prompt/qwen.txt` | PROMPT_ANTHROPIC_WITHOUT_TODO | 默认兜底 | 109 | 简洁直接，无 TodoWrite，安全恶意代码检查 |

### 2.2 未被 SystemPrompt 直接引用但存在的提示词文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `session/prompt/anthropic-20250930.txt` | 167 | Claude Code 兼容版本（归档），包含 TodoWrite、hooks、professional objectivity |
| `session/prompt/copilot-gpt-5.txt` | 144 | GitHub Copilot GPT-5 风格，结构化工作流、代码搜索指令 |

### 2.3 Agent 专属提示词文件

| 文件 | 变量名 | 所属 Agent | 行数 |
|------|--------|-----------|------|
| `agent/prompt/compaction.txt` | PROMPT_COMPACTION | compaction | 14 |
| `agent/prompt/explore.txt` | PROMPT_EXPLORE | explore | 18 |
| `agent/prompt/summary.txt` | PROMPT_SUMMARY | summary | 11 |
| `agent/prompt/title.txt` | PROMPT_TITLE | title | 44 |

### 2.4 模式切换与特殊提示词文件

| 文件 | 用途 | 行数 |
|------|------|------|
| `session/prompt/plan.txt` | Plan 模式 READ-ONLY 约束 | 26 |
| `session/prompt/plan-reminder-anthropic.txt` | Plan 模式增强版 5 阶段工作流 | 67 |
| `session/prompt/build-switch.txt` | 从 Plan 切换回 Build 模式通知 | 5 |
| `session/prompt/max-steps.txt` | 达到最大步数限制提示 | 16 |

---

## 3. SystemPrompt 命名空间

**文件**：`packages/opencode/src/session/system.ts`（54 行）

### 3.1 导入的提示词文件

```typescript
// system.ts:5-11
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
```

注意：`PROMPT_ANTHROPIC_WITHOUT_TODO` 实际上是 `qwen.txt` 的内容。

### 3.2 SystemPrompt.instructions()

```typescript
// system.ts:15-17
export function instructions() {
  return PROMPT_CODEX.trim()
}
```

**用途**：仅用于 Codex（OpenAI OAuth）会话，通过 `options.instructions` 参数传递而非 system messages。

### 3.3 SystemPrompt.provider(model)

```typescript
// system.ts:19-27
export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
  if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  return [PROMPT_ANTHROPIC_WITHOUT_TODO]
}
```

**选择决策流**（按评估顺序，命中即返回）：

```
model.api.id 检查
├─ 包含 "gpt-5"？ → PROMPT_CODEX (codex_header.txt)
├─ 包含 "gpt-" / "o1" / "o3"？ → PROMPT_BEAST (beast.txt)
├─ 包含 "gemini-"？ → PROMPT_GEMINI (gemini.txt)
├─ 包含 "claude"？ → PROMPT_ANTHROPIC (anthropic.txt)
├─ 包含 "trinity"（不区分大小写）？ → PROMPT_TRINITY (trinity.txt)
└─ 默认兜底 → PROMPT_ANTHROPIC_WITHOUT_TODO (qwen.txt)
```

**返回值**：包含单个字符串元素的数组 `[promptContent]`。

### 3.4 SystemPrompt.environment(model)

```typescript
// system.ts:29-53
export async function environment(model: Provider.Model) {
  const project = Instance.project
  return [
    [
      `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,
      `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      `  Today's date: ${new Date().toDateString()}`,
      `</env>`,
      `<directories>`,
      `  ${
        project.vcs === "git" && false
          ? await Ripgrep.tree({ cwd: Instance.directory, limit: 50 })
          : ""
      }`,
      `</directories>`,
    ].join("\n"),
  ]
}
```

**注入的信息**：
- 模型名称（`model.api.id`）
- 完整模型 ID（`providerID/modelID`）
- 当前工作目录
- 是否为 Git 仓库
- 运行平台（darwin/linux/win32）
- 当前日期

**注意**：目录树功能当前被硬编码禁用（`&& false` 条件始终为假）。

**返回值**：包含单个拼接字符串的数组。

---

## 4. InstructionPrompt 命名空间

**文件**：`packages/opencode/src/session/instruction.ts`

### 4.1 识别的文件类型

```typescript
// instruction.ts:14-18
const FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"]  // CONTEXT.md 已弃用
```

### 4.2 InstructionPrompt.systemPaths()

**行号**：72-115

**搜索顺序**：

1. **项目级指令**（若 `OPENCODE_DISABLE_PROJECT_CONFIG` 为 false）：
   - 从 `Instance.directory` 向上遍历目录树，寻找第一个匹配的 `AGENTS.md`、`CLAUDE.md` 或 `CONTEXT.md`
   - 使用 `Filesystem.findUp()` 向上查找

2. **全局级指令**（按优先级顺序）：
   - 检查 `OPENCODE_CONFIG_DIR/AGENTS.md`（若环境变量已设置）
   - 回退到 `Global.Path.config/AGENTS.md`（全局配置目录）
   - 检查 `~/.claude/CLAUDE.md`（除非 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` 为 true）

3. **配置文件中的指令**（`config.instructions` 数组）：
   - `~/` 前缀：展开为用户主目录
   - 绝对路径：使用 `Glob.scan()` 扫描
   - 相对路径：使用 `Filesystem.globUp()` 向上搜索
   - URL 路径：此处过滤掉（在 `system()` 中单独处理）

**返回值**：`Set<string>` — 绝对文件路径集合。

### 4.3 InstructionPrompt.system()

**行号**：117-142

```typescript
export async function system() {
  const config = await Config.get()
  const paths = await systemPaths()

  // 加载文件指令
  const files = Array.from(paths).map(async (p) => {
    const content = await Filesystem.readText(p).catch(() => "")
    return content ? "Instructions from: " + p + "\n" + content : ""
  })

  // 加载 URL 指令（HTTP/HTTPS）
  const urls: string[] = []
  if (config.instructions) {
    for (const instruction of config.instructions) {
      if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
        urls.push(instruction)
      }
    }
  }
  const fetches = urls.map((url) =>
    fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.text() : ""))
      .catch(() => "")
      .then((x) => (x ? "Instructions from: " + url + "\n" + x : ""))
  )

  return Promise.all([...files, ...fetches]).then((result) => result.filter(Boolean))
}
```

**关键行为**：
- 每个指令文件内容前加 `"Instructions from: <path>"` 标头
- URL 指令有 5 秒超时
- 返回过滤掉空值后的字符串数组

### 4.4 InstructionPrompt.resolve()

**行号**：168-191

**用途**：当 Read 工具读取文件时，自动发现该文件所在目录向上的指令文件，动态注入为 `<system-reminder>`。

**去重机制**（三重保护）：
1. `isClaimed()` — 同一消息 ID 内不重复加载
2. `loaded()` — 检查消息历史中已加载的文件
3. System paths — 排除已在全局级加载的指令

### 4.5 相关环境变量

| 变量 | 效果 |
|------|------|
| `OPENCODE_CONFIG_DIR` | 优先于全局配置目录搜索 AGENTS.md |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | 跳过项目级文件发现 |
| `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` | 跳过加载 `~/.claude/CLAUDE.md` |

---

## 5. LLM.stream() 中的最终组装

**文件**：`packages/opencode/src/session/llm.ts`

### 5.1 StreamInput 类型定义

```typescript
// llm.ts:30-42
export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  model: Provider.Model
  agent: Agent.Info
  system: string[]          // ← 从 SessionPrompt 传入的系统提示数组
  abort: AbortSignal
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
}
```

### 5.2 System 数组组装逻辑

```typescript
// llm.ts:65-93
const isCodex = provider.id === "openai" && auth?.type === "oauth"

const system = []
system.push(
  [
    // 如果 Agent 有自定义 prompt，使用它；否则使用 Provider 提示词
    // Codex 会话跳过 SystemPrompt.provider()（通过 options.instructions 发送）
    ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
    // 从 SessionPrompt 传入的自定义 prompt（环境信息 + 指令文件）
    ...input.system,
    // 最后一条用户消息中的自定义 system prompt
    ...(input.user.system ? [input.user.system] : []),
  ]
    .filter((x) => x)
    .join("\n"),
)

// 插件变换钩子
const header = system[0]
await Plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model },
  { system },
)
// 如果 header 未变，重新合并以保持 2 元素结构（用于缓存优化）
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

### 5.3 组装优先级（关键规则）

```
if agent.prompt 存在:
  → 使用 agent.prompt（替代 Provider 提示词）
else if isCodex:
  → 不使用 Provider 提示词（通过 options.instructions 单独传递）
else:
  → 使用 SystemPrompt.provider(model) 选择的提示词
```

### 5.4 Codex 特殊处理

```typescript
// llm.ts:111
if (isCodex) {
  options.instructions = SystemPrompt.instructions()
}
```

Codex 会话（OpenAI OAuth）将 `codex_header.txt` 内容通过 `options.instructions` 参数传递，而不是放在 system messages 中。

### 5.5 最终消息结构

```typescript
// llm.ts:225-232
messages: [
  ...system.map(
    (x): ModelMessage => ({
      role: "system",
      content: x,
    }),
  ),
  ...input.messages,
],
```

system 数组中的每个元素都成为一个 `role: "system"` 的 ModelMessage，排在用户/助手消息之前。

### 5.6 工具解析

```typescript
// llm.ts:258-266
async function resolveTools(input) {
  const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
  for (const tool of Object.keys(input.tools)) {
    if (input.user.tools?.[tool] === false || disabled.has(tool)) {
      delete input.tools[tool]
    }
  }
  return input.tools
}
```

工具通过两层过滤：用户权限 + Agent 权限规则。

---

## 6. SessionPrompt 中的 system 数组构建

**文件**：`packages/opencode/src/session/prompt.ts`

### 6.1 构建位置

```typescript
// prompt.ts:650-677
const system = [...(await SystemPrompt.environment(model)), ...(await InstructionPrompt.system())]
const format = lastUser.format ?? { type: "text" }
if (format.type === "json_schema") {
  system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
}

const result = await processor.process({
  user: lastUser,
  agent,
  abort,
  sessionID,
  system,        // ← 传给 LLM.stream()
  messages: [...],
  tools,
  model,
  toolChoice: format.type === "json_schema" ? "required" : undefined,
})
```

### 6.2 system 数组元素组成

| 顺序 | 来源 | 内容 |
|------|------|------|
| 1 | `SystemPrompt.environment(model)` | 模型信息 + 环境信息（1 个元素） |
| 2+ | `InstructionPrompt.system()` | 指令文件内容（N 个元素，每个文件 1 个） |
| 可选 | `STRUCTURED_OUTPUT_SYSTEM_PROMPT` | 结构化输出指令（仅当 format.type === "json_schema"） |

这个 system 数组传入 `processor.process()`，再传入 `LLM.stream()` 的 `input.system` 字段。

### 6.3 在 LLM.stream() 中的再组装

SessionPrompt 构建的 system 数组在 `LLM.stream()` 中被合并到最终的 system 中：

```
最终 system[0] = [
  Agent.prompt 或 SystemPrompt.provider(model),  // 主要提示词
  + input.system（即 SessionPrompt 的 system 数组 join("\n")）,  // 环境 + 指令
  + input.user.system  // 用户自定义
].join("\n")
```

---

## 7. 各 Agent 的 Prompt 组装差异

### 7.1 Build Agent（默认主 Agent）

| 属性 | 值 |
|------|-----|
| mode | primary |
| prompt | 无（使用 Provider 提示词） |
| system 来源 | Provider 提示词 + 环境信息 + 指令文件 |
| 工具 | 全部（受权限过滤） |
| 使用小模型 | 否 |

**组装结果**：
```
system = [
  SystemPrompt.provider(model) + 环境信息 + 指令文件 + 用户自定义
]
```

### 7.2 Plan Agent（只读规划 Agent）

| 属性 | 值 |
|------|-----|
| mode | primary |
| prompt | 无（使用 Provider 提示词） |
| system 来源 | Provider 提示词 + 环境信息 + 指令文件 + Plan Reminder |
| 工具 | 受限（只读） |
| 特殊处理 | insertReminders() 注入 Plan 工作流指令 |

**特殊注入**（通过 `insertReminders()` 函数，`prompt.ts:1321-1459`）：
- 进入 Plan 模式时：注入 `plan.txt` 或 `plan-reminder-anthropic.txt`（200+ 行 5 阶段工作流）
- 从 Plan 切回 Build 时：注入 `build-switch.txt`

### 7.3 Compaction Agent（上下文压缩）

| 属性 | 值 |
|------|-----|
| mode | primary（hidden） |
| prompt | PROMPT_COMPACTION（compaction.txt） |
| system 来源 | **仅** Agent prompt（system 数组为空 `[]`） |
| 工具 | 无 |
| 使用小模型 | 否 |

**组装结果**：
```
LLM.stream({
  agent: { prompt: PROMPT_COMPACTION },
  system: [],    // ← 空！不注入环境信息和指令文件
  tools: {},     // ← 空！无工具
})
```

**输入模板**（`compaction.ts:151-177`）：
```
Summarize the conversation so far...
Focus on: Goal, Instructions, Discoveries, Accomplished, Relevant files
```

**结果处理**：文本直接存入助手消息，不使用结构化输出。

### 7.4 Title Agent（标题生成）

| 属性 | 值 |
|------|-----|
| mode | primary（hidden） |
| prompt | PROMPT_TITLE（title.txt） |
| system 来源 | **仅** Agent prompt（system 数组为空 `[]`） |
| 工具 | 无 |
| 使用小模型 | 是（`small: true`） |
| 重试次数 | 2 |

**组装结果**：
```
LLM.stream({
  agent: { prompt: PROMPT_TITLE },
  system: [],
  tools: {},
  small: true,
  retries: 2,
})
```

**输入**：`"Generate a title for this conversation:\n"` + 上下文消息

**结果后处理**（`prompt.ts:1948-1956`）：
1. 去除 thinking 标签（`<think>...</think>`）
2. 提取第一个非空行
3. 截断到 100 字符
4. 存入 `Session.title`

### 7.5 Summary Agent（摘要生成）

| 属性 | 值 |
|------|-----|
| mode | primary（hidden） |
| prompt | PROMPT_SUMMARY（summary.txt） |
| system 来源 | **仅** Agent prompt |
| 工具 | 无 |
| 使用小模型 | 否 |

**结果处理**：纯文本摘要，存入消息 parts。

### 7.6 General Subagent（通用子 Agent）

| 属性 | 值 |
|------|-----|
| mode | subagent |
| prompt | 无（使用 Provider 提示词） |
| system 来源 | Provider 提示词 + 环境信息 + 指令文件 |
| 工具 | 全部（受权限过滤，todoread/todowrite 在子会话中受限） |

**组装方式**：与 Build Agent 相同，使用 Provider 提示词。

### 7.7 Explore Subagent（文件搜索专家）

| 属性 | 值 |
|------|-----|
| mode | subagent |
| prompt | PROMPT_EXPLORE（explore.txt） |
| system 来源 | Agent prompt + 环境信息 + 指令文件 |
| 工具 | 仅 grep, glob, list, bash, webfetch, websearch, codesearch, read |

**权限规则**：明确拒绝所有未列出的工具。

---

## 8. Provider 系统提示词完整内容

### 8.1 anthropic.txt（Claude 模型 — 106 行）

**核心指令要点**：
- 自称 "OpenCode, the best coding agent on the planet"
- 强调 Professional objectivity — 技术准确性优先于用户感受验证
- **TodoWrite 工具强调** — 要求非常频繁地使用 TodoWrite 追踪任务，每完成一个立即标记
- Task 工具策略 — 文件搜索优先用 Task 工具减少上下文，主动使用专业 Agent
- 代码风格 — **不添加任何注释**除非被要求
- 代码引用格式 — `file_path:line_number`
- 并行工具调用 — 多个独立工具调用应并行发送
- WebFetch 重定向 — 遇到重定向应立即用新 URL 重试

**完整内容摘要**：
```
You are OpenCode, the best coding agent on the planet.
- Tone: concise, direct, markdown formatting
- Professional objectivity: technical accuracy over validation
- Task Management: TodoWrite 工具 VERY frequently
- Tool usage: Task tool for file search, parallel calls
- Code style: NO COMMENTS unless asked
- Code References: file_path:line_number pattern
```

### 8.2 beast.txt（OpenAI GPT-4/o1/o3 模型 — 148 行）

**核心指令要点**：
- 激进自主风格 — "keep going until the user's query is completely resolved"
- **互联网研究要求** — "THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH"
- 递归 URL 抓取 — 必须用 webfetch 递归获取所有相关链接
- Memory 系统 — 使用 `.github/instructions/memory.instruction.md` 存储用户偏好
- 结构化工作流 — 8 步流程（Fetch → Understand → Investigate → Research → Plan → Implement → Debug → Test）
- 从不终止 — "NEVER end your turn without having truly and completely solved the problem"
- Todo 列表 — 用 emoji 显示状态的 markdown todo 列表

### 8.3 gemini.txt（Google Gemini 模型 — 156 行）

**核心指令要点**：
- 交互式 CLI Agent 专注软件工程
- Core Mandates — 严格遵循项目约定、库/框架验证、风格模仿
- 双工作流：Software Engineering Tasks（5 步）和 New Applications（6 步）
- 安全规则 — 执行修改命令前必须说明目的和影响
- 绝对路径 — 工具调用必须使用绝对路径
- 交互式命令 — 尽量避免需要用户交互的 shell 命令
- 简洁输出 — 每次回复少于 3 行文本

### 8.4 qwen.txt（默认兜底 / Qwen 等模型 — 109 行）

**核心指令要点**：
- 与 anthropic.txt 类似但无 TodoWrite 强调
- 恶意代码检查 — 拒绝编写或解释可能被恶意使用的代码
- 极简输出 — 4 行以内，单词回答最佳
- 无 emoji — 除非用户明确要求
- 安全检查 — 编辑前根据文件名和目录结构判断代码是否恶意

### 8.5 trinity.txt（Trinity 模型 — 98 行）

**核心指令要点**：
- 极简风格 — 4 行以内回复
- **每消息一个工具** — "Use exactly one tool per assistant message"
- lint/typecheck 强调 — 完成任务后必须运行
- 不添加注释
- 代码引用 `file_path:line_number`

### 8.6 codex_header.txt（GPT-5 / Codex OAuth — 80 行）

**核心指令要点**：
- 编辑约束 — 默认 ASCII，仅必要时使用 Unicode
- Git 和工作区卫生 — 不得 revert 非自己做的更改，不得 `git reset --hard`
- 前端设计规则 — 避免通用布局，要有明确视觉方向
- 输出格式化 — 简洁友好的编码队友风格
- 文件引用 — 内联代码使路径可点击，支持行号/列号

### 8.7 anthropic-20250930.txt（归档版 — 167 行）

**核心指令要点**：
- Claude Code 兼容版本
- TodoWrite 强调（与 anthropic.txt 类似）
- hooks 支持 — 识别 `<user-prompt-submit-hook>` 反馈
- Professional objectivity — 技术准确性优先
- 更详细的回复风格指导

### 8.8 copilot-gpt-5.txt（未引用 — 144 行）

**核心指令要点**：
- GitHub Copilot GPT-5 风格
- `<gptAgentInstructions>` 标签包裹的 Agent 指令
- `<structuredWorkflow>` 结构化工作流
- `<codeSearchInstructions>` 代码搜索指令
- 代码块使用 4 个反引号 + `// filepath:` 注释

---

## 9. Agent 专属提示词完整内容

### 9.1 compaction.txt（14 行）

```
You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation.
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context but concise enough
to be quickly understood.

Do not respond to any questions in the conversation, only output the summary.
```

### 9.2 explore.txt（18 行）

```
You are a file search specialist. You excel at thoroughly navigating and exploring
codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash for file operations like copying, moving, or listing directory contents
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state
  in any way

Complete the user's search request efficiently and report your findings clearly.
```

### 9.3 summary.txt（11 行）

```
Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that
  exact question
- If the conversation ends with an imperative statement or request to the user
  (e.g. "Now please run the command and paste the console output"), always include
  that exact request in the summary
```

### 9.4 title.txt（44 行）

```
You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title
- Focus on the main topic or question
- Vary your phrasing - avoid repetitive patterns
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE
- Always output something meaningful, even if the input is minimal
- Short/conversational inputs → reflect tone (Greeting, Quick check-in, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
...
</examples>
```

---

## 10. 模式切换与特殊提示词完整内容

### 10.1 plan.txt（26 行）— Plan 模式 READ-ONLY 约束

```xml
<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files - commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. Any modification attempt
is a critical violation. ZERO exceptions.

---

## Responsibility

Your current responsibility is to think, read, search, and delegate explore agents
to construct a well-formed plan...

Ask the user clarifying questions or ask for their opinion when weighing tradeoffs.

## Important

The user indicated that they do not want you to execute yet -- you MUST NOT make
any edits...
</system-reminder>
```

### 10.2 plan-reminder-anthropic.txt（67 行）— 增强版 5 阶段工作流

包含 5 个阶段的详细指导：

- **Phase 1: Initial Understanding** — 启动最多 3 个 Explore Agent 并行探索代码库
- **Phase 2: Planning** — 启动 Plan 子 Agent 制定方案
- **Phase 3: Synthesis** — 综合各 Agent 结果，向用户确认权衡
- **Phase 4: Final Plan** — 更新计划文件，包含推荐方案和关键文件
- **Phase 5: Call ExitPlanMode** — 调用 ExitPlanMode 表示规划完成

还包含 Plan File 信息（动态生成的计划文件路径）。

### 10.3 build-switch.txt（5 行）— Plan → Build 模式切换

```xml
<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and utilize your
arsenal of tools as needed.
</system-reminder>
```

### 10.4 max-steps.txt（16 行）— 最大步数限制

```
CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are
disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.
```

---

## 11. 结构化输出处理

### 11.1 触发条件

当用户消息的 `format.type === "json_schema"` 时触发。

### 11.2 处理流程

```typescript
// prompt.ts 中的处理
if (format.type === "json_schema") {
  system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)  // 追加到 system 数组

  tools["StructuredOutput"] = createStructuredOutputTool({
    schema: lastUser.format.schema,
    onSuccess(output) {
      structuredOutput = output
    },
  })
}
```

**关键行为**：
- 创建名为 `StructuredOutput` 的临时工具
- 该工具接受符合指定 JSON Schema 的输入
- 成功调用后捕获输出并退出循环
- 结果存入 `processor.message.structured` 字段

### 11.3 注意

Title、Summary、Compaction 这些子 Agent **不使用**结构化输出，它们都是纯文本提取。

---

## 12. Plan Mode Reminder 注入机制

**文件**：`prompt.ts:1321-1459`，`insertReminders()` 函数

### 12.1 注入时机

在 `SessionPrompt.loop()` 每次迭代中，消息发送给 LLM 之前调用 `insertReminders()`。

### 12.2 注入逻辑

```
检查当前 Agent 类型
├─ Agent == "plan"
│   ├─ 首次进入 Plan 模式
│   │   ├─ 是否为实验性模式？
│   │   │   ├─ 是 → 注入 plan-reminder-anthropic.txt（5 阶段工作流）
│   │   │   └─ 否 → 注入 plan.txt（基本 READ-ONLY 约束）
│   │   └─ 作为合成的文本 part 注入消息序列
│   └─ 非首次进入（已有 Plan 上下文）
│       └─ 不重复注入
├─ Agent == "build" 且之前处于 Plan 模式
│   └─ 注入 build-switch.txt（模式变更通知）
│       └─ 包含计划文件位置，建议执行计划
└─ 其他
    └─ 不注入
```

### 12.3 合成消息特点

Reminder 被作为**合成消息**（synthetic text part）注入到消息序列中，不是真实的用户或助手消息。这使得 LLM 看到的消息流中自然地包含了模式切换指令。

---

## 13. 完整组装流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    SessionPrompt.loop()                         │
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │ 1. SystemPrompt.environment() │──→ [环境信息字符串]           │
│  └──────────────────────────────┘                               │
│                 +                                               │
│  ┌──────────────────────────────┐                               │
│  │ 2. InstructionPrompt.system() │──→ [指令1, 指令2, ...]       │
│  └──────────────────────────────┘                               │
│                 +                                               │
│  ┌──────────────────────────────┐                               │
│  │ 3. STRUCTURED_OUTPUT_PROMPT   │──→ (仅 json_schema 格式时)   │
│  └──────────────────────────────┘                               │
│                 ↓                                               │
│         system = [环境信息, 指令1, 指令2, ..., 结构化输出指令?]  │
│                 ↓                                               │
│  ┌──────────────────────────────┐                               │
│  │ 4. insertReminders()          │──→ Plan/Build 模式注入消息序列│
│  └──────────────────────────────┘                               │
│                 ↓                                               │
│         processor.process({ system, ... })                      │
└─────────────────────────────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                      LLM.stream()                               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 5. system[] 重新组装:                                     │   │
│  │                                                          │   │
│  │    if (agent.prompt) {                                   │   │
│  │      → agent.prompt  ← 子Agent专属提示词                  │   │
│  │    } else if (isCodex) {                                 │   │
│  │      → []  ← 通过 options.instructions 另外传递           │   │
│  │    } else {                                              │   │
│  │      → SystemPrompt.provider(model)  ← Provider提示词     │   │
│  │    }                                                     │   │
│  │                                                          │   │
│  │    + input.system  ← SessionPrompt 的 system 数组         │   │
│  │    + input.user.system  ← 用户自定义 system               │   │
│  │                                                          │   │
│  │    → 全部 join("\n") 成一个字符串                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 6. Plugin.trigger("experimental.chat.system.transform")   │   │
│  │    → 允许插件修改 system 数组                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 7. 缓存优化: 保持 2 元素结构 [header, rest.join("\n")]    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 8. streamText() 调用:                                     │   │
│  │    messages: [                                           │   │
│  │      ...system.map(x => { role:"system", content: x }),  │   │
│  │      ...input.messages                                   │   │
│  │    ]                                                     │   │
│  │    tools: resolvedTools                                  │   │
│  │    toolChoice: auto / required / none                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 14. 总结对比表

### 14.1 各 Agent 系统提示组装对比

| 方面 | Build | Plan | Compaction | Title | Summary | General | Explore |
|------|-------|------|-----------|-------|---------|---------|---------|
| **模式** | Primary | Primary | Primary(hidden) | Primary(hidden) | Primary(hidden) | Subagent | Subagent |
| **Agent Prompt** | 无(Provider) | 无(Provider) | compaction.txt | title.txt | summary.txt | 无(Provider) | explore.txt |
| **Provider 提示词** | 按模型选择 | 按模型选择 | 不使用 | 不使用 | 不使用 | 按模型选择 | 不使用 |
| **环境信息** | 有 | 有 | 无 | 无 | 无 | 有 | 有 |
| **指令文件** | 有 | 有 | 无 | 无 | 无 | 有 | 有 |
| **工具** | 全部 | 受限(只读) | 无 | 无 | 无 | 全部 | 8个特定工具 |
| **小模型** | 否 | 否 | 否 | 是 | 否 | 否 | 否 |
| **重试次数** | 配置默认 | 配置默认 | 配置默认 | 2 | 配置默认 | 配置默认 | 配置默认 |
| **结构化输出** | 可选 | 可选 | 否 | 否(文本提取) | 否(文本) | 可选 | 可选 |
| **模式Reminder** | 无 | Plan工作流注入 | 无 | 无 | 无 | 无 | 无 |

### 14.2 Provider 提示词选择对比

| Provider | 匹配模式 | 风格 | 行数 | TodoWrite | 互联网研究 | 工具并行 |
|----------|---------|------|------|-----------|-----------|---------|
| GPT-5 | `"gpt-5"` | Codex 编辑约束 | 80 | 否 | 否 | 是 |
| GPT-4/o1/o3 | `"gpt-"/"o1"/"o3"` | 激进自主 | 148 | Markdown列表 | 强制 | 否(隐含) |
| Gemini | `"gemini-"` | 详细工作流 | 156 | 否 | 否 | 是 |
| Claude | `"claude"` | TodoWrite 强调 | 106 | 强制 | 否 | 是 |
| Trinity | `"trinity"` | 极简单工具 | 98 | 否 | 否 | 否(每消息1个) |
| 默认(Qwen等) | 兜底 | 简洁安全 | 109 | 否 | 否 | 是 |

### 14.3 Prompt 内容层次结构

```
最终发送给 LLM 的 system messages:
│
├── Message 1 (主体，所有内容 join 成一个字符串):
│   ├── [Agent.prompt] 或 [Provider 提示词]     ← 根据 Agent 类型选择
│   ├── [环境信息]                              ← SystemPrompt.environment()
│   ├── [指令文件 1: CLAUDE.md]                 ← InstructionPrompt.system()
│   ├── [指令文件 2: AGENTS.md]                 ← InstructionPrompt.system()
│   ├── [指令文件 N: ...]                       ← InstructionPrompt.system()
│   ├── [结构化输出指令]                         ← 仅 json_schema 时
│   └── [用户自定义 system]                      ← 用户消息携带
│
├── (可能的) Message 2:
│   └── [缓存优化拆分的剩余部分]
│
└── 消息序列中的合成 Reminder:
    ├── [Plan 模式指令]                          ← insertReminders()
    └── [Build 切换通知]                         ← insertReminders()
```
