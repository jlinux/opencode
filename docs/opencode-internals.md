# OpenCode 运作原理：从输入到响应的完整生命周期

当你在 OpenCode 中输入一条命令后，会经历以下完整流程：

---

## 1. TUI 捕获输入

**文件**: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

用户在 TUI 的 textarea 中输入文本，按 Enter 后触发 `submit()` 函数（第 528 行）。它会：

- 验证是否已选择模型
- 获取或创建一个 `sessionID`
- 生成一个 `messageID`
- 判断输入类型：普通 prompt、shell 命令、还是 `/command`
- 通过 SDK 客户端发起 HTTP 请求：
  - `sdk.client.session.prompt()` — 普通提示
  - `sdk.client.session.shell()` — shell 命令
  - `sdk.client.session.command()` — `/` 命令

发送的数据包括 `sessionID`、`messageID`、`providerID`、`modelID`、`agent` 名称、以及用户输入的 `parts`（文本/文件）。

---

## 2. 服务端接收 → 创建消息

**文件**: `packages/opencode/src/server/routes/session.ts` → `packages/opencode/src/session/prompt.ts`

HTTP 路由 `POST /:sessionID/message` 接收请求，调用 `SessionPrompt.prompt()`（第 158 行）：

1. 通过 `Session.get(sessionID)` 获取 session
2. 调用 `createUserMessage()` 创建一条 `MessageV2.User`（role: "user"），包含用户的 parts、模型信息、时间戳
3. 将消息写入 **SQLite 数据库**（Drizzle ORM）
4. 调用 `loop({ sessionID })` 进入主处理循环

---

## 3. 主循环 (`loop`)

**文件**: `packages/opencode/src/session/prompt.ts`（第 274 行）

这是核心的 **while(true) 循环**，驱动整个对话：

```
while (true) {
  1. 从数据库读取完整消息历史 (MessageV2.stream)
  2. 检查退出条件：如果最后一条 assistant 消息已完成且不是 tool-calls → 退出循环
  3. 处理特殊任务（subtask / compaction / 上下文溢出）
  4. 获取 agent 配置 (Agent.get)
  5. 解析可用工具 (resolveTools)
  6. 构建系统提示词
  7. 调用 processor.process() → 发起 LLM 请求
  8. 如果 LLM 返回了 tool_calls → 继续循环（执行工具后再问 LLM）
  9. 如果 LLM 返回了最终文本 → 退出循环
}
```

---

## 4. 工具解析 (`resolveTools`)

**文件**: `packages/opencode/src/session/prompt.ts`（第 734 行）+ `packages/opencode/src/tool/registry.ts`

从两个来源收集工具：

- **ToolRegistry**: 内置工具 — `BashTool`, `ReadTool`, `GlobTool`, `GrepTool`, `EditTool`, `WriteTool`, `TaskTool`, `WebFetchTool`, `WebSearchTool`, `TodoWriteTool`, `CodeSearchTool`, `SkillTool`, `ApplyPatchTool` 等
- **MCP 工具**: 通过 Model Context Protocol 加载的外部工具

每个工具会被包装上：
- Zod schema 转换（适配不同 provider）
- **权限检查**（调用前验证）
- 插件钩子（before/after）
- 输出截断处理

---

## 5. Prompt 组装 → LLM 调用

**文件**: `packages/opencode/src/session/llm.ts`（第 46 行）

`LLM.stream()` 负责组装最终发给 LLM 的请求：

```
系统提示词 = [
  Agent 自定义 prompt 或 Provider 默认 prompt,
  自定义 system 指令,
  用户级 system 指令
]

消息历史 = MessageV2[] → 转换为 AI SDK 的 ModelMessage[]

调用 streamText({
  model:    provider 对应的语言模型,
  messages: [system + 历史消息],
  tools:    解析出的所有工具定义,
  temperature, topP, maxOutputTokens,
  abortSignal,
  ...
})
```

底层使用 **Vercel AI SDK** 的 `streamText()` 发起流式请求到 Anthropic / OpenAI / Google 等 provider。

---

## 6. 流式响应处理

**文件**: `packages/opencode/src/session/processor.ts`（第 45 行）

`SessionProcessor.process()` 消费 LLM 返回的流式事件：

| 事件 | 处理 |
|------|------|
| `text-start/delta/end` | 创建 TextPart，增量更新文本 |
| `reasoning-start/delta/end` | 创建 ReasoningPart（推理模型） |
| `tool-input-start/delta/end` | 创建 ToolPart，状态设为 `pending` |
| `tool-call` | ToolPart 状态 → `running`，**执行工具** |
| `tool-result` | ToolPart 状态 → `completed`，记录输出 |
| `tool-error` | ToolPart 状态 → `error`，记录错误 |
| `finish-step` | 记录 token 用量、成本、文件 diff |

每个 part 变更都会：
1. 写入 SQLite 数据库
2. 通过 `Bus.publish(MessageV2.Event.PartUpdated)` 发布事件
3. TUI 订阅这些事件，**实时渲染**到界面

---

## 7. 工具执行 → 权限检查

**文件**: `packages/opencode/src/permission/next.ts`（第 131 行）

每次工具调用前，都会经过 `PermissionNext.ask()` 检查：

```
遍历请求的 patterns:
  evaluate(permission, pattern, ruleset, approved)
    → "allow": 直接执行
    → "deny":  抛出 DeniedError
    → "ask":   暂停，发布 Event.Asked，等待用户确认
```

不同 Agent 有不同的默认权限：
- **build**（默认 agent）：允许所有工具，但重复调用会触发 "doom loop" 确认
- **plan**：拒绝所有写操作，只允许读取
- **explore**（子 agent）：只允许 grep、glob、read、bash、web 搜索等

还有一个 **doom loop 检测**：如果同一个工具用相同输入连续调用 3 次，会暂停并询问用户。

---

## 8. 循环直到完成

工具执行结果会作为 `tool-result` 追加到消息历史中，然后循环回到第 3 步，再次调用 LLM。LLM 看到工具结果后，可能会：

- 继续调用更多工具 → 继续循环
- 返回最终文本响应 → 退出循环

---

## 完整流程图

```
用户输入 (TUI textarea)
    │
    ▼
submit() → HTTP POST /session/{id}/message
    │
    ▼
SessionPrompt.prompt() → 创建 User 消息 → 存入 SQLite
    │
    ▼
SessionPrompt.loop() ◄──────────────────────────┐
    │                                             │
    ▼                                             │
resolveTools() → 收集内置工具 + MCP 工具          │
    │                                             │
    ▼                                             │
LLM.stream() → 组装 system + messages + tools     │
    │                                             │
    ▼                                             │
Provider API (Anthropic/OpenAI/Google/...)         │
    │                                             │
    ▼                                             │
SessionProcessor.process() 消费流式响应            │
    │                                             │
    ├─ 文本响应 → TextPart → 存入DB → TUI渲染      │
    │                                             │
    └─ 工具调用 → PermissionNext.ask()             │
                    │                             │
                    ├─ allow → 执行工具 → 结果存DB ─┘
                    ├─ deny  → 抛出错误
                    └─ ask   → 等待用户确认 → 继续/取消
```

核心关键点：**整个过程是一个流式的、带工具调用的循环**。LLM 每次可以返回文本或工具调用，工具执行后结果反馈给 LLM，直到 LLM 给出最终回答。

---

## 关键文件索引

| 组件 | 文件路径 | 关键函数 |
|------|----------|----------|
| TUI 输入 | `cli/cmd/tui/component/prompt/index.tsx` | `submit()` - 第 528 行 |
| HTTP 路由 | `server/routes/session.ts` | `POST /:sessionID/message` - 第 694 行 |
| 会话/消息 | `session/prompt.ts` | `prompt()` - 第 158 行, `loop()` - 第 274 行, `resolveTools()` - 第 734 行 |
| 流式处理 | `session/processor.ts` | `create().process()` - 第 45 行 |
| LLM 调用 | `session/llm.ts` | `stream()` - 第 46 行 |
| 工具注册 | `tool/registry.ts` | `tools()` - 第 129 行, `all()` - 第 96 行 |
| 权限检查 | `permission/next.ts` | `ask()` - 第 131 行 |
| 数据存储 | `session/index.ts` | `updateMessage()` - 第 670 行, `updatePart()` - 第 735 行 |
| Agent 配置 | `agent/agent.ts` | `list()`, `get()`, `defaultAgent()` |

> 以上文件路径均相对于 `packages/opencode/src/`

---

## 深入解析：resolveTools() 工具解析机制

### 整体结构

`resolveTools()` 位于 `session/prompt.ts:734`，签名如下：

```ts
async function resolveTools(input: {
  agent: Agent.Info        // 当前 agent 配置
  model: Provider.Model    // 当前使用的 LLM 模型
  session: Session.Info    // 当前会话
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
})
```

返回 `Record<string, AITool>` — 以工具 ID 为 key 的字典，最终传给 Vercel AI SDK 的 `streamText()`。

### 第一步：构造 Tool.Context 工厂

在加载工具之前，先创建一个 `context()` 工厂函数（第 746-779 行），每次工具被调用时用它生成 `Tool.Context`：

```ts
const context = (args, options) => ({
  sessionID,               // 当前会话 ID
  abort,                   // AbortSignal（可取消）
  messageID,               // 当前 assistant 消息 ID
  callID,                  // 本次工具调用的唯一 ID
  agent,                   // agent 名称
  messages,                // 完整消息历史
  metadata(val),           // 更新 ToolPart 的 title/metadata（实时更新到 UI）
  ask(req),                // 权限检查，调用 PermissionNext.ask()
})
```

`ask()` 内部将 agent 的权限规则和 session 的权限规则 **合并**（`PermissionNext.merge`）后一起评估。

### 第二步：加载内置工具（ToolRegistry）

`prompt.ts:781-826` 遍历 `ToolRegistry.tools()` 的结果。

#### ToolRegistry.all() — 收集所有工具定义

位于 `tool/registry.ts:96`，返回 `Tool.Info[]`，包含三类：

**A. 硬编码的内置工具：**

```ts
[
  InvalidTool,        // 处理无效工具调用
  QuestionTool,       // 向用户提问（仅 app/cli/desktop 客户端）
  BashTool,           // 执行 shell 命令
  ReadTool,           // 读文件
  GlobTool,           // 文件名模式匹配
  GrepTool,           // 内容搜索
  EditTool,           // 编辑文件
  WriteTool,          // 写文件
  TaskTool,           // 启动子 agent
  WebFetchTool,       // 抓取网页
  TodoWriteTool,      // Todo 管理
  WebSearchTool,      // 网页搜索
  CodeSearchTool,     // 代码搜索
  SkillTool,          // 技能调用
  ApplyPatchTool,     // 应用 patch
]
```

**B. 实验性/条件工具（通过 Feature Flag 控制）：**

```ts
// LSP 工具 — 需要 OPENCODE_EXPERIMENTAL_LSP_TOOL
...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
// 批量工具 — 需要 config.experimental.batch_tool
...(config.experimental?.batch_tool === true ? [BatchTool] : []),
// Plan 模式工具 — 需要 OPENCODE_EXPERIMENTAL_PLAN_MODE 且 CLI 客户端
...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli"
    ? [PlanExitTool, PlanEnterTool] : []),
```

**C. 自定义工具（动态加载）：**

`ToolRegistry.state()` 在初始化时扫描两个来源：

1. **文件系统目录**：扫描 `Config.directories()` 返回的所有目录（`~/.config/opencode/`、`.opencode/` 等）下的 `{tool,tools}/*.{js,ts}` 文件，`import` 后将导出的 `ToolDefinition` 转为 `Tool.Info`
2. **插件系统**：`Plugin.list()` 返回所有已加载插件的 `tool` 定义

两者都通过 `fromPlugin()` 转换，把 `@opencode-ai/plugin` 的 `ToolDefinition` 包装成统一的 `Tool.Info`。

#### ToolRegistry.tools() — 过滤 + 初始化

位于 `registry.ts:129`，对 `all()` 的结果做两件事：

**过滤（按模型适配）：**

```ts
.filter((t) => {
  // websearch/codesearch 只对 opencode provider 或启用了 Exa 的用户开放
  if (t.id === "codesearch" || t.id === "websearch")
    return model.providerID === "opencode" || Flag.OPENCODE_ENABLE_EXA

  // GPT 模型使用 apply_patch 而不是 edit/write（与 Codex 格式一致）
  const usePatch = model.modelID.includes("gpt-") && ...
  if (t.id === "apply_patch") return usePatch
  if (t.id === "edit" || t.id === "write") return !usePatch

  return true
})
```

**初始化（调用 `init`）：**

对每个通过过滤的工具调用 `t.init({ agent })`，得到：
- `description` — 工具描述（会注入动态变量，如当前目录路径）
- `parameters` — Zod schema（参数验证）
- `execute` — 执行函数

然后触发 `Plugin.trigger("tool.definition", ...)` 插件钩子，允许插件修改工具的 description 和 parameters。

#### Tool.define() 的包装逻辑

每个工具都通过 `Tool.define()` 定义（`tool/tool.ts:48`）。它在 `init` 中包装了 `execute`：

1. **参数验证**：用 Zod 解析 `args`，失败时抛出格式化错误
2. **执行原始逻辑**
3. **输出截断**：如果工具自己没处理截断，自动调用 `Truncate.output()`（限制 2000 行 / 50KB），超出部分写入临时文件

#### 回到 resolveTools() — 包装成 AI SDK 的 tool

`prompt.ts:786-826` 对每个 ToolRegistry 工具：

```ts
tools[item.id] = tool({
  id: item.id,
  description: item.description,
  inputSchema: jsonSchema(ProviderTransform.schema(model, z.toJSONSchema(item.parameters))),
  async execute(args, options) {
    const ctx = context(args, options)
    // 1. 触发 "tool.execute.before" 插件钩子
    await Plugin.trigger("tool.execute.before", {...}, { args })
    // 2. 执行工具
    const result = await item.execute(args, ctx)
    // 3. 处理附件（图片等）
    // 4. 触发 "tool.execute.after" 插件钩子
    await Plugin.trigger("tool.execute.after", {...}, output)
    return output
  },
})
```

关键步骤 `ProviderTransform.schema()`（`provider/transform.ts:879`）：针对不同 provider 转换 JSON Schema。比如 **Google/Gemini** 不支持 integer 枚举，会把 `enum: [1, 2]` 转成 `enum: ["1", "2"]`，类型也从 `integer` 改成 `string`。

### 第三步：加载 MCP 工具

`prompt.ts:828-919` 遍历 `MCP.tools()` 的结果。

#### MCP.tools() — 从 MCP 服务端获取工具

位于 `mcp/index.ts:566`：

1. 获取所有 **已连接的** MCP client（状态 `status === "connected"`）
2. 对每个 client 调用 `client.listTools()` 获取工具列表
3. 用 `convertMcpTool()` 将 MCP 工具转为 AI SDK 的 `Tool` 格式
4. 工具名称格式：`{clientName}_{toolName}`（特殊字符替换为 `_`）

MCP client 在启动时根据 `config.mcp` 配置初始化，支持三种传输方式：
- **stdio** — 启动子进程
- **sse** — Server-Sent Events
- **streamable-http** — HTTP 流

#### convertMcpTool() — 转换

位于 `mcp/index.ts:120`：将 MCP 工具的 inputSchema 规范化为 JSON Schema（强制 `type: "object"`, `additionalProperties: false`），用 `dynamicTool()` 创建 AI SDK tool，execute 直接调用 `client.callTool()`。

#### MCP 工具的包装

`prompt.ts:835-918`，MCP 工具的包装比内置工具**多了两个重要步骤**：

1. **强制权限检查**：每次 MCP 工具调用前都执行 `ctx.ask({ permission: key, patterns: ["*"] })`。内置工具在自己的 `execute` 内部按需调用 `ctx.ask()`，但 MCP 工具是外部的，所以在外部统一拦截。

2. **输出格式转换**：MCP 工具返回的是 `content[]`（可能包含 `text`、`image`、`resource`），需要统一处理：
   - `text` → 合并为字符串
   - `image` → 转为 `data:` URL 的 FilePart 附件
   - `resource` → 文本提取 + blob 转附件
   - 最终经过 `Truncate.output()` 截断

同样会触发 `Plugin.trigger("tool.execute.before/after")` 钩子。

### resolveTools() 完整流程

```
resolveTools()
│
├── 1. 创建 context() 工厂（封装 sessionID, abort, permission.ask 等）
│
├── 2. ToolRegistry.tools(model, agent)
│   │
│   ├── ToolRegistry.all()
│   │   ├── 硬编码工具 (Bash, Read, Edit, Write, Glob, Grep, Task, ...)
│   │   ├── 条件工具 (Lsp, Batch, PlanEnter/Exit — 由 Flag 控制)
│   │   └── 自定义工具
│   │       ├── 文件扫描: .opencode/{tool,tools}/*.{js,ts}
│   │       └── 插件: Plugin.list() → plugin.tool
│   │
│   ├── 过滤（按模型适配: GPT 用 apply_patch, 其他用 edit/write）
│   │
│   └── 初始化: t.init({ agent })
│       ├── 生成 description (注入动态变量)
│       ├── 生成 parameters (Zod schema)
│       └── 包装 execute (参数校验 + 自动截断)
│
│   对每个工具:
│   ├── ProviderTransform.schema() — 适配不同 provider 的 JSON Schema
│   ├── 包装 execute:
│   │   ├── Plugin.trigger("tool.execute.before")
│   │   ├── item.execute(args, ctx)  ← 工具内部自行调用 ctx.ask() 检查权限
│   │   └── Plugin.trigger("tool.execute.after")
│   └── → tools[item.id] = AI SDK tool
│
├── 3. MCP.tools()
│   │
│   ├── 获取所有已连接的 MCP client
│   ├── 对每个 client: client.listTools()
│   └── convertMcpTool() — 转为 AI SDK dynamicTool
│
│   对每个 MCP 工具:
│   ├── ProviderTransform.schema() — 适配 JSON Schema
│   ├── 包装 execute:
│   │   ├── Plugin.trigger("tool.execute.before")
│   │   ├── ctx.ask() — 强制权限检查（MCP 工具统一拦截）
│   │   ├── execute(args, opts) — 调用 MCP server
│   │   ├── 输出格式转换 (text/image/resource → string + attachments)
│   │   ├── Truncate.output() — 截断
│   │   └── Plugin.trigger("tool.execute.after")
│   └── → tools[key] = AI SDK tool
│
└── return tools  ← Record<string, AITool>
```

**关键设计差异：**
- **内置工具**的权限检查在各自 `execute` 内部调用 `ctx.ask()`（比如 `ReadTool` 检查 `read` 权限、检查外部目录）
- **MCP 工具**的权限检查在外部统一拦截（`prompt.ts:850-855`），因为外部工具无法控制内部实现
- **ProviderTransform.schema()** 对 Google/Gemini 做特殊处理（enum 类型转换、清理多余字段），保证 schema 兼容性
- 所有工具输出都经过 **截断处理**（2000 行 / 50KB），超出部分存到 `~/.opencode/tool-output/` 临时文件

---

## ToolRegistry 工具案例

每个工具都通过 `Tool.define(id, init)` 定义，`init` 可以是一个对象（静态定义）或一个异步函数（动态定义）。

### 案例一：GlobTool — 静态定义（最简单）

`tool/glob.ts` — init 直接传对象：

```ts
export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,          // 从 glob.txt 加载，给 LLM 看的说明
  parameters: z.object({             // Zod schema 定义参数
    pattern: z.string(),
    path: z.string().optional(),
  }),
  async execute(params, ctx) {
    // 1. 权限检查
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: { pattern: params.pattern, path: params.path },
    })

    // 2. 业务逻辑：用 Ripgrep 搜索文件
    let search = params.path ?? Instance.directory
    await assertExternalDirectory(ctx, search, { kind: "directory" })
    const files = []
    for await (const file of Ripgrep.files({ cwd: search, glob: [params.pattern] })) {
      if (files.length >= 100) break
      files.push({ path: full, mtime: stats })
    }
    files.sort((a, b) => b.mtime - a.mtime)

    // 3. 返回结果
    return {
      title: path.relative(Instance.worktree, search),  // UI 显示
      metadata: { count: files.length, truncated },      // 结构化元数据
      output: output.join("\n"),                          // 文本回传给 LLM
    }
  },
})
```

**模式要点：**
- `description` 从 `.txt` 文件加载（给 LLM 看的工具说明）
- `parameters` 是 Zod schema，会被转成 JSON Schema 传给 LLM
- `execute` 内部先调 `ctx.ask()` 做权限检查，再执行逻辑
- 返回 `{ title, metadata, output }` — title 显示在 UI，output 回传给 LLM

### 案例二：TaskTool — 动态定义（init 是异步函数）

`tool/task.ts` — init 需要运行时数据来生成 description：

```ts
export const TaskTool = Tool.define("task", async (ctx) => {
  // init 阶段：获取可用的子 agent 列表，动态生成 description
  const agents = await Agent.list().then(x => x.filter(a => a.mode !== "primary"))
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter(a =>
        PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny"
      )
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents.map(a => `- ${a.name}: ${a.description}`).join("\n"),
  )

  return {
    description,                     // 动态生成，包含当前可用 agent 列表
    parameters,                      // z.object({ description, prompt, subagent_type, ... })
    async execute(params, ctx) {
      await ctx.ask({ permission: "task", patterns: [params.subagent_type], ... })
      const agent = await Agent.get(params.subagent_type)
      const session = await Session.create({ parentID: ctx.sessionID, ... })
      // 创建子会话，启动子 agent 处理 ...
    },
  }
})
```

**与 GlobTool 的区别：**
- `init` 是 `async (ctx) => { ... }` 函数，而不是静态对象
- `ctx?.agent` 可以拿到当前调用者 agent 的信息
- **description 是动态的** — 根据当前 agent 的权限过滤出可用的子 agent，嵌入到描述中。不同 agent 看到的工具描述不一样

### 案例三：EditTool — 完整的复杂工具

`tool/edit.ts` — 展示完整模式，包含多个层次的逻辑：

```ts
export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string(),
    oldString: z.string(),
    newString: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  async execute(params, ctx) {
    // 1. 参数校验
    if (params.oldString === params.newString)
      throw new Error("No changes to apply")

    // 2. 外部目录检查
    await assertExternalDirectory(ctx, filePath)

    // 3. 文件锁定 + 执行
    await FileTime.withLock(filePath, async () => {
      contentOld = await Filesystem.readText(filePath)
      contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll)
      diff = createTwoFilesPatch(...)

      // 4. 权限检查 — 在计算完 diff 之后才 ask
      //    这样 UI 可以展示具体的 diff 让用户确认
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: { filepath: filePath, diff },
      })

      // 5. 写入文件
      await Filesystem.write(filePath, contentNew)

      // 6. 发布事件（通知 FileWatcher、Snapshot 等）
      await Bus.publish(File.Event.Edited, { file: filePath })
      await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })
    })

    // 7. 更新 UI 元数据
    ctx.metadata({ metadata: { diff, filediff, diagnostics: {} } })

    // 8. LSP 诊断 — 编辑后检查语法错误
    await LSP.touchFile(filePath, true)
    const diagnostics = await LSP.diagnostics()
    const errors = diagnostics[filePath]?.filter(item => item.severity === 1)
    if (errors.length > 0) {
      output += `\nLSP errors detected:\n${errors.map(LSP.Diagnostic.pretty).join("\n")}`
    }

    return { metadata: { diagnostics, diff, filediff }, title: "...", output }
  },
})
```

**亮点：**
- `ctx.ask()` 的 `metadata.diff` 让 UI 能展示 diff 供用户审批
- `ctx.metadata()` 实时更新 ToolPart 的显示信息
- `Bus.publish()` 发布事件到事件总线，触发文件监控和快照
- `LSP.diagnostics()` 编辑后自动检查语法错误，追加到输出让 LLM 自行修复
- `replace()` 函数内部有 **9 层 Replacer 链**（精确匹配 → 空白容错 → 缩进容错 → 锚点匹配 → ...），提高 LLM 编辑的容错率

### 案例四：自定义工具（通过文件系统加载）

用户在 `.opencode/tools/my_tool.ts` 中定义工具，被 `ToolRegistry.state()` 自动扫描加载：

```ts
// .opencode/tools/my_tool.ts
import z from "zod"
import type { ToolDefinition } from "@opencode-ai/plugin"

export default {
  description: "My custom tool",
  args: { query: z.string() },
  async execute(args, ctx) {
    return `Result for: ${args.query}`
  },
} satisfies ToolDefinition
```

`ToolRegistry` 中的 `fromPlugin()` 将其包装成 `Tool.Info`：

```ts
function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
  return {
    id,     // 文件名（不含扩展名），如 "my_tool"
    init: async (initCtx) => ({
      parameters: z.object(def.args),
      description: def.description,
      execute: async (args, ctx) => {
        const result = await def.execute(args, ctx)
        const out = await Truncate.output(result, {}, initCtx?.agent)
        return { title: "", output: out.content, metadata: { truncated: out.truncated } }
      },
    }),
  }
}
```

### 工具从定义到被 LLM 调用的完整生命周期

```
Tool.define("glob", { description, parameters, execute })
       │
       ▼
ToolRegistry.all()  ←  收集所有 Tool.Info（内置 + 条件 + 自定义）
       │
       ▼
ToolRegistry.tools(model, agent)
       │
       ├── .filter()  ←  按模型过滤（GPT 用 apply_patch，其他用 edit/write）
       │
       └── .map(t => t.init({ agent }))  ←  初始化，得到 { description, parameters, execute }
              │
              └── Plugin.trigger("tool.definition")  ←  插件可修改 description/parameters
                     │
                     ▼
resolveTools()
       │
       ├── z.toJSONSchema(parameters)  ←  Zod → JSON Schema
       ├── ProviderTransform.schema()  ←  适配 Gemini 等的 schema 格式
       │
       └── tool({
              id, description,
              inputSchema: jsonSchema(...),
              execute(args, opts) {
                ctx = context(args, opts)
                Plugin.trigger("tool.execute.before")
                result = item.execute(args, ctx)     ←  内部 ctx.ask() 权限检查
                Plugin.trigger("tool.execute.after")
                return result
              }
           })
              │
              ▼
       tools["glob"] = AI SDK Tool
              │
              ▼
       传给 streamText({ tools })  →  LLM 看到工具定义并决定是否调用
```
