# 07 - Tool 系统架构详解

## 目录

1. [概览](#1-概览)
2. [核心接口 tool.ts](#2-核心接口-toolts)
3. [工具注册表 registry.ts](#3-工具注册表-registryts)
4. [24 个内置工具完整清单](#4-24-个内置工具完整清单)
5. [BashTool 深度分析](#5-bashtool-深度分析)
6. [EditTool 与模糊匹配链](#6-edittool-与模糊匹配链)
7. [ReadTool 文件读取](#7-readtool-文件读取)
8. [WriteTool 与 ApplyPatchTool](#8-writetool-与-applypatchtool)
9. [TaskTool 子 Agent 桥接](#9-tasktool-子-agent-桥接)
10. [搜索类工具 Grep/Glob/Ls/CodeSearch](#10-搜索类工具-grepgloblscodesearch)
11. [网络类工具 WebFetch/WebSearch](#11-网络类工具-webfetchwebsearch)
12. [辅助工具 Skill/Todo/Question/Plan/Lsp/Batch](#12-辅助工具-skilltodoquestionplanlspbatch)
13. [输出截断机制 truncation.ts](#13-输出截断机制-truncationts)
14. [外部目录权限守卫](#14-外部目录权限守卫)
15. [Plugin 集成点](#15-plugin-集成点)
16. [MCP 工具集成](#16-mcp-工具集成)
17. [关键设计洞察与非显而易见细节](#17-关键设计洞察与非显而易见细节)

---

## 1. 概览

Tool 系统是 OpenCode Agent 与外部世界交互的唯一通道。位于 `packages/opencode/src/tool/`，共 **24 个 .ts 文件 + 20 个 .txt 描述文件**，约 **3,676 行** TypeScript 代码。

核心设计：
- **统一工厂**：所有工具通过 `Tool.define(id, initFn)` 创建
- **Zod 参数验证**：执行前自动校验
- **自动输出截断**：超过 2000 行 / 50KB 自动截断并写入磁盘
- **权限守卫**：每个工具通过 `ctx.ask()` 调用 `PermissionNext` 系统
- **Plugin 可扩展**：注册、定义、执行前后均有钩子

---

## 2. 核心接口 tool.ts

**文件**: `tool/tool.ts` (89 行)

### 关键类型

```typescript
export namespace Tool {
  export interface InitContext {
    agent?: Agent.Info   // 可选的 agent 上下文，用于过滤/定制
  }

  export type Context<M> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: Record<string, any>
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<PermissionNext.Request, "id"|"sessionID"|"tool">): Promise<void>
  }

  export interface Info<Parameters, M> {
    id: string
    init: (ctx?: InitContext) => Promise<{
      description: string
      parameters: Parameters
      execute(args, ctx: Context): Promise<{ title, metadata, output, attachments? }>
      formatValidationError?(error: z.ZodError): string
    }>
  }
}
```

### `Tool.define()` 工厂函数

每个工具必须通过此函数创建。工厂自动包装 `execute` 方法，增加两个职责：

1. **Zod 验证**：调用 `tool.parameters.parse(args)`，失败时如果工具定义了 `formatValidationError` 则调用它，否则抛出标准错误
2. **自动截断**：执行后如果 `result.metadata.truncated === undefined`（即工具未自行处理截断），调用 `Truncate.output()` 并将 `{ truncated, outputPath }` 合并到 metadata

`init` 参数既可以是函数也可以是普通对象（简写形式，多数简单工具使用）。

---

## 3. 工具注册表 registry.ts

**文件**: `tool/registry.ts` (173 行)

### 状态初始化

`ToolRegistry.state` 是 per-Instance 的懒加载单例：

1. **扫描配置目录**：查找 `{tool,tools}/*.{js,ts}` 文件，动态导入。名为 `"default"` 的导出用文件名作 ID；其他用 `"filename_exportname"`
2. **加载插件工具**：调用 `Plugin.list()`，对每个插件的 `tool` 属性通过 `fromPlugin()` 适配

### 注册顺序

`all()` 函数返回的工具列表（严格顺序）：

| 序号 | 工具 | 条件 |
|------|------|------|
| 1 | `InvalidTool` | 始终首位 |
| 2 | `QuestionTool` | 仅 `OPENCODE_CLIENT` 为 `app`/`cli`/`desktop`，或设置了 `OPENCODE_ENABLE_QUESTION_TOOL` |
| 3 | `BashTool` | 始终 |
| 4 | `ReadTool` | 始终 |
| 5 | `GlobTool` | 始终 |
| 6 | `GrepTool` | 始终 |
| 7 | `EditTool` | 始终 |
| 8 | `WriteTool` | 始终 |
| 9 | `TaskTool` | 始终 |
| 10 | `WebFetchTool` | 始终 |
| 11 | `TodoWriteTool` | 始终 |
| 12 | `WebSearchTool` | 始终 |
| 13 | `CodeSearchTool` | 始终 |
| 14 | `SkillTool` | 始终 |
| 15 | `ApplyPatchTool` | 始终 |
| 16 | `LspTool` | 仅 `OPENCODE_EXPERIMENTAL_LSP_TOOL` |
| 17 | `BatchTool` | 仅 `config.experimental.batch_tool === true` |
| 18 | `PlanExitTool` | 仅 `OPENCODE_EXPERIMENTAL_PLAN_MODE` AND `OPENCODE_CLIENT === "cli"` |
| 19+ | 自定义工具 | Plugin/配置目录工具，追加在末尾 |

> **注意**: `TodoReadTool` 在代码中**已注释掉**，永远不会被注册。

### `tools()` — Model/Agent 感知过滤

```typescript
async function tools(model: { providerID, modelID }, agent?: Agent.Info)
```

过滤规则：
- **websearch / codesearch**: 仅在 `providerID === "opencode"` 或设置了 `OPENCODE_ENABLE_EXA` 时暴露
- **apply_patch vs edit/write**: GPT 系列模型（排除 `"oss"` 和 `"gpt-4"` 变体）用 `apply_patch` 替换 `edit`/`write`
- 对每个工具调用 `t.init({ agent })` 获取实时定义
- 调用 `Plugin.trigger("tool.definition", { toolID }, output)` 允许插件修改描述/参数

---

## 4. 24 个内置工具完整清单

| 文件 | 行数 | 工具 ID | 用途 |
|------|------|---------|------|
| `tool.ts` | 89 | — | 核心接口定义 |
| `registry.ts` | 173 | — | 注册和分发 |
| `invalid.ts` | 17 | `invalid` | 捕获畸形工具调用 |
| `question.ts` | 33 | `question` | 人机交互问答 |
| `bash.ts` | 274 | `bash` | Shell 执行 + tree-sitter 解析 |
| `read.ts` | 293 | `read` | 文件读取 + 分页 |
| `glob.ts` | 78 | `glob` | 文件模式匹配 |
| `grep.ts` | 156 | `grep` | Ripgrep 内容搜索 |
| `edit.ts` | 654 | `edit` | 文件编辑 + 模糊匹配 |
| `write.ts` | 84 | `write` | 新文件创建 |
| `task.ts` | 165 | `task` | 子 Agent 生成 |
| `webfetch.ts` | 206 | `webfetch` | 网页内容抓取 |
| `todo.ts` | 53 | `todowrite` / `todoread` | Session 级 Todo 管理 |
| `websearch.ts` | 150 | `websearch` | Exa 网络搜索 |
| `codesearch.ts` | 132 | `codesearch` | Exa 代码搜索 |
| `skill.ts` | 123 | `skill` | SKILL.md 加载器 |
| `apply_patch.ts` | 281 | `apply_patch` | 统一 diff 补丁 |
| `lsp.ts` | 97 | `lsp` | LSP 诊断（实验性） |
| `batch.ts` | 181 | `batch` | 并行工具执行（实验性） |
| `plan.ts` | 131 | `plan_exit` / `plan_enter`(已注释) | Plan 模式切换 |
| `multiedit.ts` | 46 | `multiedit` | 多次编辑（**死代码**，未注册） |
| `truncation.ts` | 107 | — | 输出截断 + 磁盘卸载 |
| `external-directory.ts` | 32 | — | 项目外目录权限辅助 |
| `ls.ts` | 121 | `list` | 目录树列表 |

---

## 5. BashTool 深度分析

**文件**: `tool/bash.ts` (274 行)

BashTool 是整个工具系统中最复杂的工具，因为它涉及 **AST 解析 + 权限检查 + 进程管理** 三个维度。

### 参数

```typescript
z.object({
  command: z.string(),
  timeout: z.number().optional(),       // 默认 120s
  workdir: z.string().optional(),
  description: z.string()               // 必填：5-10 字描述
})
```

### 执行流程（完整步骤）

```
1. 验证 timeout（负数立即抛出）
2. 设置 cwd = workdir || Instance.directory
3. tree-sitter 解析命令 AST
4. 提取路径 → 判断是否外部目录 → 权限检查
5. 提取命令模式 → bash 权限检查
6. Plugin shell.env 钩子注入环境变量
7. spawn 进程（detached 模式）
8. 实时流式更新 metadata（上限 30KB）
9. timeout/abort 管理
10. 结果组装
```

### Tree-Sitter AST 解析

这是 BashTool 最精妙的设计。使用 WebAssembly 版本的 `web-tree-sitter` + `tree-sitter-bash` 语法，将每条 bash 命令解析为 AST：

```
命令文本 → Parser.parse() → Tree → rootNode.descendantsOfType("command") → 逐个分析
```

对每个 `command` AST 节点：
- 提取完整命令文本（含重定向，如果父节点是 `redirected_statement`）
- 从 `command_name`, `word`, `string`, `raw_string`, `concatenation` 子节点提取 token
- **路径检查**（仅针对特定命令）：`cd`, `rm`, `cp`, `mv`, `mkdir`, `touch`, `chmod`, `chown`, `cat`
  - 对非 flag 参数执行 `realpath` 解析
  - 判断解析后路径是否在 `Instance.worktree` 之外
  - 若在外部，加入 `directories` 集合

### 双维度权限检查

```
directories.size > 0 → ctx.ask({ permission: "external_directory", patterns: globs, always: globs })
patterns.size > 0    → ctx.ask({ permission: "bash", patterns: [...], always: [...] })
```

`patterns` = 完整命令文本（如 `"git commit -m 'fix bug'"`)
`always` = BashArity 归一化后的模式（如 `"git commit *"`）

### BashArity 字典（arity.ts, 163 行）

160+ 条命令前缀到"元数"的映射。`prefix()` 函数从最长前缀开始匹配，返回规范化的命令签名：

| 输入 | 字典匹配 | arity | 归一化结果 |
|------|----------|-------|-----------|
| `git commit -m "fix"` | `"git": 2` | 2 | `"git commit *"` |
| `npm run dev` | `"npm run": 3` | 3 | `"npm run dev *"` |
| `aws s3 cp file s3://` | `"aws": 3` | 3 | `"aws s3 cp *"` |
| `cat foo.txt` | `"cat": 1` | 1 | `"cat *"` |

这意味着用户点击 "Always Allow" 时，批准的是 `"git commit *"` 这种泛化模式。

### 进程管理

```typescript
spawn(command, {
  shell,                              // Shell.acceptable() 排除 fish/nu
  cwd,
  env: { ...process.env, ...pluginEnv },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",  // 启用进程组杀死
})
```

- **进程组杀死**：`detached: true` 允许 `process.kill(-pid, "SIGTERM/SIGKILL")`，杀死整个进程树而不只是 shell
- **超时管理**：`setTimeout(() => kill(), timeout + 100)` 在请求超时后 100ms 触发
- **Abort 处理**：监听 `ctx.abort` 信号，触发时设置 `aborted = true` 并调用 `kill()`
- **实时 metadata**：每个 stdout/stderr 数据块都更新 `ctx.metadata()`（上限 30KB，仅用于 UI 显示）

### Shell 选择

`Shell.acceptable()` 逻辑：
- 黑名单：`fish`, `nu`（语法不兼容）
- 回退链：`$SHELL` → Windows: Git Bash/cmd.exe → macOS: `/bin/zsh` → Linux: `bash` / `/bin/sh`

---

## 6. EditTool 与模糊匹配链

**文件**: `tool/edit.ts` (654 行)

EditTool 是行数最多的工具，其核心在于 **9 级模糊匹配替换链**。

### 参数

```typescript
z.object({
  filePath: z.string(),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional()
})
```

### 执行流程

1. Guard: `oldString === newString` 立即抛出
2. 解析绝对路径；调用 `assertExternalDirectory`
3. **FileTime 文件锁** `FileTime.withLock(filePath, ...)`：
   - `oldString === ""`：创建新文件
   - 否则：断言文件存在 → `FileTime.assert()` 防止覆写外部修改 → 读取内容 → `replace()` → 权限检查 → 写入
4. 计算 additions/deletions
5. 触发 LSP，收集诊断（最多 20 条 severity=1 的错误）

### 9 级模糊匹配链（`replace()` 函数）

按顺序尝试，第一个匹配成功的替换器即终止：

| 级别 | 替换器 | 匹配策略 |
|------|--------|---------|
| 1 | `SimpleReplacer` | **精确匹配** — 直接在内容中查找 `oldString` |
| 2 | `LineTrimmedReplacer` | 逐行 `.trim()` 后比较，计算字符偏移 |
| 3 | `BlockAnchorReplacer` | 首尾行锚定 + Levenshtein 相似度判定中间行。阈值：单候选 0.0，多候选 0.3 |
| 4 | `WhitespaceNormalizedReplacer` | 所有连续空白折叠为单空格后比较 |
| 5 | `IndentationFlexibleReplacer` | 剥离最小公共缩进后比较 |
| 6 | `EscapeNormalizedReplacer` | 反转义 `\n`, `\t`, `\r`, `\\` 等后比较 |
| 7 | `TrimmedBoundaryReplacer` | 首尾空白裁剪后比较 |
| 8 | `ContextAwareReplacer` | 首尾行作为上下文锚点，中间行 ≥50% 精确匹配即接受 |
| 9 | `MultiOccurrenceReplacer` | 枚举所有精确出现位置（用于 `replaceAll` 歧义消解） |

**唯一性校验**：
- 如果非 `replaceAll`：必须 `content.indexOf(search) === content.lastIndexOf(search)`
- 如果 `replaceAll`：直接 `content.replaceAll(search, newString)`
- 所有替换器都找不到 → 抛出 "not found"
- 找到但出现多次且非 `replaceAll` → 抛出 "multiple matches"

### FileTime 文件锁

- `FileTime.withLock(filePath, ...)` — 每文件互斥锁，确保并发编辑同一文件时被串行化
- `FileTime.assert(sessionID, filePath)` — 检查文件自上次 Agent 读取以来是否被外部修改，防止覆写

---

## 7. ReadTool 文件读取

**文件**: `tool/read.ts` (293 行)

### 参数

```typescript
z.object({
  filePath: z.string(),
  offset: z.coerce.number().optional(),   // 1-indexed 起始行
  limit: z.coerce.number().optional()     // 默认 2000
})
```

### 执行流程

1. 路径解析 + `assertExternalDirectory`（支持 `bypassCwdCheck`）
2. 权限检查：`ctx.ask({ permission: "read", patterns: [filepath], always: ["*"] })`
3. **文件不存在**：从父目录建议相似文件名
4. **目录**：`fs.readdir` + 排序 + offset/limit 分页，XML 格式输出
5. **MIME 检测**：图片（非 SVG/FBS）和 PDF 返回 base64 `attachments`
6. **二进制检测**：扩展名白名单（zip, tar, gz, exe, dll 等）+ 首 4096 字节采样（含 null 字节 = 二进制，>30% 不可打印字符 = 二进制）
7. **文本读取**：`readline` 流式读取，上限 `limit` 行 / `MAX_BYTES = 50KB`
8. 输出格式：`<path>`, `<type>`, `<content>` 带行号
9. 触发 `LSP.touchFile()` 预热 + `FileTime.read()` 记录读取时间
10. 追加 `InstructionPrompt.resolve()` 结果（沿目录树向上查找 AGENTS.md/CLAUDE.md）

---

## 8. WriteTool 与 ApplyPatchTool

### WriteTool (`tool/write.ts`, 84 行)

```typescript
z.object({ content: z.string(), filePath: z.string() })
```

1. 路径解析 + `assertExternalDirectory`
2. 如果文件存在：`FileTime.assert()` + 读取旧内容计算 diff
3. 权限检查：`ctx.ask({ permission: "edit", ... })`
4. 写入 `Filesystem.write()` + 发布 Bus 事件
5. `LSP.touchFile(filepath, true)` 强制打开
6. 收集**所有项目**诊断（不仅当前文件），最多 20 条/文件，最多 5 个其他文件

### ApplyPatchTool (`tool/apply_patch.ts`, 281 行)

仅 GPT 系列模型激活，使用统一 diff 格式：

```
*** Begin Patch
*** Add File: <path>
+content lines
*** Update File: <path>
@@ context line
-removed
+added
*** Delete File: <path>
*** End Patch
```

关键特性：
- 一次性处理多文件变更
- **单次权限检查**覆盖所有文件：`ctx.ask({ permission: "edit", patterns: relativePaths })`
- 支持 Add / Update / Move / Delete 四种操作
- 对每个非删除文件触发 LSP

---

## 9. TaskTool 子 Agent 桥接

**文件**: `tool/task.ts` (165 行)

### 参数

```typescript
z.object({
  description: z.string(),        // 3-5 字描述
  prompt: z.string(),
  subagent_type: z.string(),
  task_id: z.string().optional(), // 恢复已有 session
  command: z.string().optional()  // slash 命令上下文
})
```

### 初始化时（init-time）

- 列出所有 `mode !== "primary"` 的 Agent（仅 subagent）
- 如果有 `ctx.agent`：按 `PermissionNext.evaluate("task", agentName, caller.permission)` 进一步过滤
- 构建描述时注入 `{agents}` 占位符

### 执行逻辑

```
1. ctx.ask({ permission: "task", patterns: [subagent_type] })
2. Agent.get(subagent_type) — 找不到则抛出
3. 检查子 Agent 是否有 "task" 权限（防止递归无限生成）
4. 创建或恢复 session：
   - task_id 存在 → Session.get(task_id) 恢复
   - 否则 → Session.create() 创建子 session，带限制性权限：
     - todowrite: deny
     - todoread: deny
     - task: deny（除非子 Agent 显式允许）
5. 获取 model（从 agent 配置或当前消息模型）
6. SessionPrompt.prompt() 运行完整 agent turn
7. 提取最后的 text part → 包装在 <task_result> XML 中
8. 返回 task_id 供后续恢复
```

---

## 10. 搜索类工具 Grep/Glob/Ls/CodeSearch

### GrepTool (`tool/grep.ts`, 156 行)

```typescript
z.object({
  pattern: z.string(),
  path: z.string().optional(),
  include: z.string().optional()   // glob 过滤
})
```

- 使用 Ripgrep 二进制：`rg -nH --hidden --no-messages --field-match-separator=|`
- 退出码：0=匹配, 1=无匹配, 2=错误
- 解析 `filepath|linenum|linetext` 格式
- **按文件修改时间降序排序**（最近修改优先）
- 上限 100 条匹配，每行截断 2000 字符
- 按文件分组输出

### GlobTool (`tool/glob.ts`, 78 行)

```typescript
z.object({ pattern: z.string(), path: z.string().optional() })
```

- 调用 `Ripgrep.files({ cwd, glob: [pattern] })` 异步生成器
- 上限 100 文件
- 按 mtime 降序排序
- 返回完整绝对路径

### ListTool (`tool/ls.ts`, 121 行)

```typescript
z.object({
  path: z.string().optional(),
  ignore: z.array(z.string()).optional()
})
```

默认忽略模式：`node_modules/`, `__pycache__/`, `.git/`, `dist/`, `build/`, `target/`, `vendor/`, `.venv/` 等 25 种。

输出为缩进树形结构。

### CodeSearchTool (`tool/codesearch.ts`, 132 行)

同 WebSearch 架构，调用 Exa MCP 的 `get_code_context_exa` 工具。30s 超时。

---

## 11. 网络类工具 WebFetch/WebSearch

### WebFetchTool (`tool/webfetch.ts`, 206 行)

```typescript
z.object({
  url: z.string(),
  format: z.enum(["text", "markdown", "html"]).default("markdown"),
  timeout: z.number().optional()   // 秒，最大 120
})
```

关键特性：
- Chrome User-Agent 伪装
- **Cloudflare 403 绕过**：首次 Chrome UA 被拦截后，用 `"opencode"` UA 重试
- 5MB 大小限制
- 图片 MIME → base64 attachment
- HTML → Markdown 转换使用 `TurndownService`（ATX 标题、fenced 代码块）
- HTML → Text 转换使用 Bun `HTMLRewriter`（跳过 script/style/noscript）

### WebSearchTool (`tool/websearch.ts`, 150 行)

```typescript
z.object({
  query: z.string(),
  numResults: z.number().optional(),    // 默认 8
  livecrawl: z.enum(["fallback", "preferred"]).optional(),
  type: z.enum(["auto", "fast", "deep"]).optional()
})
```

- 发送 MCP JSON-RPC 2.0 请求到 `https://mcp.exa.ai/mcp`，调用 `web_search_exa` 工具
- 25s 超时
- 动态注入当前年份到描述中
- 仅 `opencode` 提供商或 `OPENCODE_ENABLE_EXA` 标志时可用

---

## 12. 辅助工具 Skill/Todo/Question/Plan/Lsp/Batch

### SkillTool (`tool/skill.ts`, 123 行)

初始化时调用 `Skill.all()` 获取所有可用 skill，按 agent 权限过滤。

执行时：
1. `Skill.get(name)` 查找
2. 权限检查
3. 获取 skill 目录中最多 10 个非 SKILL.md 文件
4. 返回 `<skill_content>` 包装的完整内容 + 文件列表

### TodoWriteTool (`tool/todo.ts`, 53 行)

全量替换模式：`Todo.update({ sessionID, todos })` 删除旧列表 + 批量插入新列表。

> `TodoReadTool` 已定义但在 registry 中**被注释掉**，永远不会被注册。

### QuestionTool (`tool/question.ts`, 33 行)

调用 `Question.ask()` 阻塞等待用户回答。格式化答案为 `"question"="answer1, answer2"`。

### PlanExitTool (`tool/plan.ts`, 131 行)

参数为空。执行时调用 `Question.ask()` 确认用户意愿切换到 build agent，创建合成的 user message。

> `PlanEnterTool` 作为注释代码保留。

### LspTool (`tool/lsp.ts`, 97 行)

```typescript
z.object({
  operation: z.enum(["goToDefinition", "findReferences", "hover",
    "documentSymbol", "workspaceSymbol", "goToImplementation",
    "prepareCallHierarchy", "incomingCalls", "outgoingCalls"]),
  filePath: z.string(),
  line: z.number().int().min(1),
  character: z.number().int().min(1)
})
```

- 1-based 转 0-based（LSP 协议）
- 检查 `LSP.hasClients(file)`
- 仅在 `OPENCODE_EXPERIMENTAL_LSP_TOOL` 启用时可用

### BatchTool (`tool/batch.ts`, 181 行)

```typescript
z.object({
  tool_calls: z.array(z.object({
    tool: z.string(),
    parameters: z.object({}).loose()
  })).min(1)
})
```

- 上限 25 个并行调用，超出的返回错误状态
- 禁止 `batch` 自身（防递归）
- `Promise.all` 并行执行
- 仅在 `config.experimental.batch_tool === true` 时可用

---

## 13. 输出截断机制 truncation.ts

**文件**: `tool/truncation.ts` (107 行)

### 常量

```typescript
MAX_LINES = 2000
MAX_BYTES = 50 * 1024   // 50 KB
DIR = ~/.local/share/opencode/tool-output/
```

### `Truncate.output()` 算法

```
输入文本
  ↓ 计算行数和字节数
  ↓ 在限制内 → 返回原文 { truncated: false }
  ↓ 超出限制：
    ↓ 从头部（或尾部如果 direction="tail"）累积行，直到达到行数/字节限制
    ↓ 完整文本写入 ~/.local/share/opencode/tool-output/tool_{ulid}
    ↓ 构建提示信息：
       - Agent 有 task 权限 → "Use the Task tool to have explore agent process this file"
       - 否则 → "Use Grep to search or Read with offset/limit"
    ↓ 返回截断内容 + 提示 { truncated: true, outputPath }
```

### 自动清理

注册为 `Scheduler` 作业 `"tool.truncation.cleanup"`，每小时运行一次，删除 7 天以上的旧文件。

---

## 14. 外部目录权限守卫

**文件**: `tool/external-directory.ts` (32 行)

```typescript
export async function assertExternalDirectory(ctx, target?, options?)
```

- `target` 未定义 → 无操作
- `options.bypass` → 无操作
- `Instance.containsPath(target)` → 无操作（在项目内）
- 否则 → 构造 glob 如 `/outside/path/*` → `ctx.ask({ permission: "external_directory", patterns: [glob], always: [glob] })`

被以下工具调用：`edit`, `read`, `write`, `apply_patch`, `grep`, `glob`, `ls`, `lsp`。

---

## 15. Plugin 集成点

Plugin 可在以下 6 个层面与 Tool 系统交互：

| 集成点 | 触发时机 | 能力 |
|--------|---------|------|
| 自定义工具文件 | 启动时扫描 `{tool,tools}/*.{js,ts}` | 注册全新工具 |
| Plugin tool 定义 | `Plugin.list()` | 通过 `ToolDefinition` 注册工具 |
| `tool.definition` 钩子 | 工具注册时（per model） | 修改描述/参数 |
| `tool.execute.before` 钩子 | 执行前 | 修改参数 |
| `tool.execute.after` 钩子 | 执行后 | 修改结果 |
| `shell.env` 钩子 | Bash 执行时 | 注入环境变量 |

---

## 16. MCP 工具集成

在 `session/prompt.ts` 的 `resolveTools()` 中：

1. 通过 `MCP.tools()` 获取 MCP 工具
2. Schema 经过 `ProviderTransform.schema()` 转换
3. 每个 MCP 工具都需要权限检查：`ctx.ask({ permission: key, patterns: ["*"], always: ["*"] })`
4. 执行前后应用 `tool.execute.before` / `tool.execute.after` Plugin 钩子
5. 输出经 `Truncate.output()` 截断

---

## 17. 关键设计洞察与非显而易见细节

### 死代码

1. **`MultiEditTool`** — 在 `multiedit.ts` 中定义但从未导入 `registry.ts`
2. **`TodoReadTool`** — 在 `todo.ts` 中定义和导出，但在 registry 的 `all()` 中已注释
3. **`PlanEnterTool`** — 在 `plan.ts` 中作为注释代码保留

### Tree-Sitter 局限性

Tree-sitter 仅检查特定命令的路径参数：`cd, rm, cp, mv, mkdir, touch, chmod, chown, cat`。其他可写入任意路径的命令（如 `tee`, `echo >`）**不被拦截**。

### FileTime 互斥锁

`FileTime.withLock()` 提供每文件互斥锁，确保并发编辑同一文件时串行化。`FileTime.assert()` 确保 Agent 不会覆写外部修改。

### 动态年份注入

`WebSearchTool` 使用 getter `get description()` 在每次初始化时调用 `new Date().getFullYear()`，确保提示词中的年份始终为当前年。

### Batch 工具的截断自管理

`BatchTool` 显式设置 `result.metadata.truncated`，因此跳过 `Tool.define` 中的自动截断包装。

### 进程组杀死

Bash 以 `detached: true` 启动进程（非 Windows），允许 `process.kill(-pid)` 杀死整个进程组，而不仅是 shell 本身。

### WebFetch Cloudflare 绕过

两次尝试策略：首次 Chrome UA → 如果 Cloudflare 403 + `cf-mitigated: challenge` 头 → 用 `"opencode"` UA 重试。

### InvalidTool 的存在理由

`InvalidTool` 不调用任何权限检查（无 `ctx.ask()`），仅返回错误信息。它作为 Vercel AI SDK 畸形工具调用的优雅降级捕获器。
