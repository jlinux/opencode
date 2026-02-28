# 09 - Permission 权限系统详解

## 目录

1. [概览](#1-概览)
2. [双系统并存架构](#2-双系统并存架构)
3. [PermissionNext — 新权限系统](#3-permissionnext-新权限系统)
4. [规则模型与求值逻辑](#4-规则模型与求值逻辑)
5. [ask() — 权限请求生命周期](#5-ask-权限请求生命周期)
6. [reply() — 三种回应与级联效应](#6-reply-三种回应与级联效应)
7. [disabled() — 工具预过滤](#7-disabled-工具预过滤)
8. [三种错误类型](#8-三种错误类型)
9. [Permission（遗留系统）](#9-permission遗留系统)
10. [BashArity 命令元数字典](#10-basharity-命令元数字典)
11. [权限在工具系统中的应用](#11-权限在工具系统中的应用)
12. [Agent 级权限定义](#12-agent-级权限定义)
13. [Config 层权限配置](#13-config-层权限配置)
14. [完整权限求值流程图](#14-完整权限求值流程图)
15. [关键设计洞察](#15-关键设计洞察)

---

## 1. 概览

Permission 系统是 OpenCode 的安全屏障，位于 `packages/opencode/src/permission/`，共 **659 行** TypeScript，3 个文件。

它控制 Agent 的每一次外部交互：Bash 命令、文件编辑、外部目录访问、工具调用、子 Agent 生成等。

核心设计原则：
- **最后匹配规则优先**（类 CSS 特异性）
- **配置 + 运行时 + Agent 三层规则集合并**
- **异步 Promise 阻塞**：`ask()` 阻塞直到用户回复
- **级联批准/拒绝**：一次 `always` 可解锁所有等待中的匹配请求

### 文件概览

| 文件 | 行数 | 职责 |
|------|------|------|
| `next.ts` | 286 | **新权限系统**：规则求值、ask/reply 生命周期 |
| `index.ts` | 210 | **遗留权限系统**：session 级 approved 记忆 |
| `arity.ts` | 163 | Bash 命令元数字典（`git` → 2, `npm run` → 3） |

---

## 2. 双系统并存架构

代码中存在两套权限系统：

| 维度 | `Permission`（遗留） | `PermissionNext`（新） |
|------|---------------------|----------------------|
| 命名空间 | `permission/index.ts` | `permission/next.ts` |
| 规则模型 | Session 级 `approved` 字典 | 有序规则数组（Ruleset） |
| 模式匹配 | `Wildcard.match` | `Wildcard.match` |
| 持久化 | 内存（per-session） | SQLite `PermissionTable` |
| 被谁调用 | MCP 工具（遗留路径） | 所有内置工具（via `ctx.ask`） |
| Plugin 钩子 | `Plugin.trigger("permission.ask")` | 无（纯规则求值） |
| 拒绝语义 | 仅 `RejectedError` | 三种：`Rejected`/`Corrected`/`Denied` |

**工具系统（`tool/`）通过 `ctx.ask()` 调用的是 `PermissionNext`。MCP 工具通过 `Permission.ask()` 走遗留路径。**

---

## 3. PermissionNext — 新权限系统

**文件**: `permission/next.ts` (286 行)

### Zod Schema 定义

```typescript
Action = z.enum(["allow", "deny", "ask"])

Rule = z.object({
  permission: z.string(),   // 权限类别（如 "bash", "edit", "read", "external_directory"）
  pattern: z.string(),      // 匹配模式（如 "git commit *", "/path/*"）
  action: Action,           // allow / deny / ask
})

Ruleset = Rule.array()       // 有序规则数组

Request = z.object({
  id: Identifier,
  sessionID: Identifier,
  permission: z.string(),
  patterns: z.string().array(),   // 要检查的所有模式
  metadata: z.record(z.any()),
  always: z.string().array(),     // "Always Allow" 时批准的泛化模式
  tool: z.object({ messageID, callID }).optional(),
})

Reply = z.enum(["once", "always", "reject"])
```

### 状态初始化

```typescript
const state = Instance.state(() => {
  // 从 DB 加载项目级 approved 规则
  const row = Database.use(db =>
    db.select().from(PermissionTable).where(eq(project_id)).get()
  )
  return {
    pending: {},       // Record<requestID, { info, resolve, reject }>
    approved: row?.data ?? []   // 运行时累积的 Ruleset
  }
})
```

- **Per-Instance 隔离**：不同项目的权限状态完全独立
- **初始化时加载**：从 `PermissionTable` 读取已持久化的规则集

### `fromConfig()` — 配置转规则

将 `Config.Permission` 格式转为 `Ruleset`：

```typescript
// 输入格式 1: 简写
{ "bash": "allow" }
→ [{ permission: "bash", pattern: "*", action: "allow" }]

// 输入格式 2: 详细模式
{ "edit": { "/src/*": "allow", "/node_modules/*": "deny" } }
→ [
    { permission: "edit", pattern: "/src/*", action: "allow" },
    { permission: "edit", pattern: "/node_modules/*", action: "deny" }
  ]
```

`expand()` 函数处理路径前缀：`~/` → `os.homedir()`, `$HOME/` → `os.homedir()`。

---

## 4. 规则模型与求值逻辑

### `evaluate(permission, pattern, ...rulesets)` — 核心求值

```typescript
export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  const merged = merge(...rulesets)   // 简单 flat 合并
  const match = merged.findLast(
    rule => Wildcard.match(permission, rule.permission)
        && Wildcard.match(pattern, rule.pattern)
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
```

关键设计：
- **最后匹配规则优先**：`findLast()` 而非 `find()`
- **双维度匹配**：permission 类别 + pattern 模式同时匹配
- **默认 ask**：无匹配规则 → 询问用户
- **Wildcard.match**：简单 glob 匹配（`*` 匹配任意字符序列）

### 合并顺序

```
evaluate(permission, pattern, configRuleset, sessionApprovedRuleset)
```

由于 `findLast()`，session 级 approved 规则（数组末尾）比 config 规则（数组前端）具有更高优先级。

---

## 5. `ask()` — 权限请求生命周期

```typescript
export const ask = fn(
  Request.partial({ id: true }).extend({ ruleset: Ruleset }),
  async (input) => {
    const s = await state()
    for (const pattern of request.patterns ?? []) {
      const rule = evaluate(request.permission, pattern, ruleset, s.approved)

      if (rule.action === "deny")
        throw new DeniedError(ruleset.filter(...))   // 立即拒绝

      if (rule.action === "ask") {
        return new Promise<void>((resolve, reject) => {
          s.pending[id] = { info, resolve, reject }
          Bus.publish(Event.Asked, info)              // 通知 UI
        })
      }

      if (rule.action === "allow") continue           // 静默通过
    }
  }
)
```

**流程**：
1. 对 `patterns` 数组中的每个模式逐一求值
2. `deny` → 立即抛出 `DeniedError`（整个工具调用终止）
3. `ask` → 创建 Promise，挂起在 `s.pending` 中，发布 Bus 事件通知 UI
4. `allow` → 继续下一个模式
5. 所有模式都 `allow` → 静默返回（无 UI 交互）

---

## 6. `reply()` — 三种回应与级联效应

```typescript
export const reply = fn(z.object({
  requestID, reply: Reply, message: z.string().optional()
}), async (input) => {
  const existing = s.pending[input.requestID]
  delete s.pending[input.requestID]

  if (input.reply === "reject") {
    // 带消息 → CorrectedError（Agent 收到反馈继续运行）
    // 无消息 → RejectedError（Agent 停止）
    existing.reject(input.message
      ? new CorrectedError(input.message)
      : new RejectedError())

    // ⚡ 级联拒绝：同一 session 的所有 pending 请求全部被拒绝
    for (const [id, pending] of Object.entries(s.pending)) {
      if (pending.info.sessionID === sessionID) {
        delete s.pending[id]
        pending.reject(new RejectedError())
      }
    }
    return
  }

  if (input.reply === "once") {
    existing.resolve()   // 一次性批准，无记忆
    return
  }

  if (input.reply === "always") {
    // 将泛化模式加入 approved 规则集
    for (const pattern of existing.info.always) {
      s.approved.push({
        permission: existing.info.permission,
        pattern,
        action: "allow"
      })
    }
    existing.resolve()

    // ⚡ 级联批准：检查同一 session 的所有 pending 请求
    for (const [id, pending] of Object.entries(s.pending)) {
      if (pending.info.sessionID !== sessionID) continue
      const ok = pending.info.patterns.every(
        pattern => evaluate(pending.info.permission, pattern, s.approved).action === "allow"
      )
      if (!ok) continue
      delete s.pending[id]
      pending.resolve()   // 自动批准
    }

    // TODO: 持久化到 DB（代码已注释）
    return
  }
})
```

### 级联效应示例

```
用户批准 "git commit *" (always)
  → s.approved 新增 { permission: "bash", pattern: "git commit *", action: "allow" }
  → 检查所有 pending:
    → pending[A]: bash "git push origin" → 不匹配 → 继续等待
    → pending[B]: bash "git commit --amend" → 匹配 → 自动批准
```

### 关键未完成项

```typescript
// TODO: we don't save the permission ruleset to disk yet until there's UI to manage it
```

`always` 批准仅保存在**内存中**（per-Instance），不持久化到 DB。意味着重启后 approved 规则清空。

---

## 7. `disabled()` — 工具预过滤

```typescript
const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast(r => Wildcard.match(permission, r.permission))
    if (!rule) continue
    if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
  }
  return result
}
```

用途：在发送工具列表给 LLM **之前**，预先移除被全局 deny 的工具。

关键细节：
- `edit`, `write`, `patch`, `multiedit` 统一归为 `"edit"` 权限
- 仅当 `pattern === "*"`（全通配）且 `action === "deny"` 时才禁用
- 这是 Plan Agent 实现只读模式的底层机制：`{ edit: { "*": "deny" } }`

---

## 8. 三种错误类型

| 错误类 | 触发条件 | Agent 行为 |
|--------|---------|-----------|
| `DeniedError` | 配置规则自动拒绝 | 工具调用终止，包含匹配的规则集 |
| `RejectedError` | 用户拒绝（无消息） | 工具调用终止，Agent 停止 |
| `CorrectedError` | 用户拒绝并附带反馈消息 | 工具调用终止，**Agent 继续运行**，反馈注入上下文 |

### DeniedError 的特殊设计

```typescript
export class DeniedError extends Error {
  constructor(public readonly ruleset: Ruleset) {
    super(`The user has specified a rule which prevents you from using this
           specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`)
  }
}
```

将匹配的规则集序列化到错误消息中，让 Agent 能理解**为什么**被拒绝并调整策略。

### CorrectedError 的反馈机制

```typescript
export class CorrectedError extends Error {
  constructor(message: string) {
    super(`The user rejected permission to use this specific tool call
           with the following feedback: ${message}`)
  }
}
```

用户的反馈直接作为 error 消息传递给 Agent，Agent 可以根据反馈修改工具参数重试。

---

## 9. Permission（遗留系统）

**文件**: `permission/index.ts` (210 行)

### 与 PermissionNext 的核心区别

| 维度 | PermissionNext | Permission（遗留） |
|------|---------------|-------------------|
| 状态范围 | Per-Instance | Per-Instance + Per-Session |
| 审批记忆 | Ruleset 数组 | `approved[sessionID][pattern] = true` |
| Plugin 钩子 | 无 | `Plugin.trigger("permission.ask", info, {status:"ask"})` |
| 拒绝类型 | 3 种 | 仅 `RejectedError` |
| 级联 | reply 时级联 | respond 时递归级联 |
| 实例销毁 | 无特殊处理 | 拒绝所有 pending |

### Plugin 钩子

遗留系统在 `ask()` 中调用：

```typescript
switch (await Plugin.trigger("permission.ask", info, { status: "ask" }).then(x => x.status)) {
  case "deny":  throw new RejectedError(...)
  case "allow": return   // 静默批准
}
```

Plugin 可以拦截权限请求并自动批准/拒绝，无需用户交互。

### 实例销毁时的清理

```typescript
const state = Instance.state(
  () => ({ pending: {}, approved: {} }),
  async (state) => {
    // 销毁时拒绝所有 pending 请求
    for (const pending of Object.values(state.pending)) {
      for (const item of Object.values(pending)) {
        item.reject(new RejectedError(...))
      }
    }
  }
)
```

---

## 10. BashArity 命令元数字典

**文件**: `permission/arity.ts` (163 行)

### 设计目的

将完整的 Bash 命令归一化为**人类可理解的命令签名**，用于 "Always Allow" 模式匹配。

### `prefix()` 函数

```typescript
export function prefix(tokens: string[]) {
  // 从最长前缀开始匹配
  for (let len = tokens.length; len > 0; len--) {
    const prefix = tokens.slice(0, len).join(" ")
    const arity = ARITY[prefix]
    if (arity !== undefined) return tokens.slice(0, arity)
  }
  // 无匹配 → 取第一个 token
  if (tokens.length === 0) return []
  return tokens.slice(0, 1)
}
```

### ARITY 字典（137 条条目）

由 LLM 生成（注释中保留了完整的生成 prompt），按字母序排列。

#### 元数分布

| Arity | 含义 | 示例 |
|-------|------|------|
| 1 | 命令本身就够了 | `cat`, `cd`, `chmod`, `cp`, `echo`, `grep`, `kill`, `ls`, `mkdir`, `mv`, `rm`, `touch` |
| 2 | 命令 + 子命令 | `git ___`, `npm ___`, `docker ___`, `cargo ___`, `brew ___`, `kubectl ___` |
| 3 | 命令 + 子命令 + 子子命令 | `npm run ___`, `docker compose ___`, `git remote ___`, `aws ___`, `gh ___` |

#### 归一化示例

| 输入命令 | 字典匹配 | Arity | 归一化结果 |
|---------|---------|-------|-----------|
| `git commit -m "fix"` | `git: 2` | 2 | `["git", "commit"]` → `"git commit *"` |
| `npm run dev` | `npm run: 3` | 3 | `["npm", "run", "dev"]` → `"npm run dev *"` |
| `docker compose up -d` | `docker compose: 3` | 3 | `["docker", "compose", "up"]` → `"docker compose up *"` |
| `aws s3 ls` | `aws: 3` | 3 | `["aws", "s3", "ls"]` → `"aws s3 ls *"` |
| `bun x vite` | `bun x: 3` | 3 | `["bun", "x", "vite"]` → `"bun x vite *"` |
| `python script.py` | 不在字典 | 1 | `["python"]` → `"python *"` |

### 在 BashTool 中的使用

```typescript
// tool/bash.ts 中的权限请求
ctx.ask({
  permission: "bash",
  patterns: ["git commit -m 'fix bug'"],     // 精确命令文本
  always: ["git commit *"],                   // BashArity 归一化后的模式
})
```

当用户选择 "Always Allow" 时，批准的是 `"git commit *"` 这种泛化模式，而非精确的命令文本。

---

## 11. 权限在工具系统中的应用

### 各工具的权限类别

| 工具 | permission | patterns | always |
|------|-----------|----------|--------|
| **bash** | `"bash"` | 完整命令文本 | BashArity 归一化 |
| **bash**（外部目录） | `"external_directory"` | `/path/*` glob | 同 patterns |
| **edit** | `"edit"` | 相对文件路径 | `["*"]` |
| **write** | `"edit"` | 相对文件路径 | `["*"]` |
| **apply_patch** | `"edit"` | 所有受影响文件的路径 | `["*"]` |
| **read** | `"read"` | 绝对文件路径 | `["*"]` |
| **task** | `"task"` | Agent 名称 | Agent 名称 |
| **doom_loop** | `"doom_loop"` | 工具名称 | 工具名称 |
| **MCP 工具** | `工具名` | `["*"]` | `["*"]` |

### ctx.ask() 在 Tool.Context 中的实现

每个工具通过 `ctx.ask()` 调用 `PermissionNext.ask()`，传入的 `ruleset` 来自：
1. **Config 权限规则**：`PermissionNext.fromConfig(config.permission)`
2. **Agent 权限规则**：`PermissionNext.fromConfig(agent.permission)` （如果有）
3. **Session 权限规则**：session 上的 `permission` 字段

---

## 12. Agent 级权限定义

Agent 可以在定义中直接设置权限规则：

```typescript
// agent.ts 中 plan agent 的定义
{
  permission: {
    edit: { "*": "deny" },              // 禁止所有编辑
    plan_exit: "allow",                 // 允许退出 plan 模式
  }
}
```

这些规则通过 `PermissionNext.fromConfig()` 转为 Ruleset，在 `evaluate()` 中与 config 规则合并。

### Plan Agent 只读实现原理

```
Agent 权限: [{ permission: "edit", pattern: "*", action: "deny" }]
  ↓
PermissionNext.disabled(tools, agentRuleset)
  → 匹配 edit/write/patch/multiedit → 从工具列表中移除
  ↓
LLM 看不到编辑工具 → 无法生成编辑类工具调用
```

---

## 13. Config 层权限配置

### opencode.json 中的 permission 字段

```jsonc
{
  "permission": {
    // 简写格式
    "bash": "allow",              // 所有 bash 命令自动批准
    "read": "allow",              // 所有文件读取自动批准

    // 详细格式
    "edit": {
      "src/*": "allow",           // src 目录下编辑自动批准
      "node_modules/*": "deny",   // node_modules 下编辑被拒绝
      "*": "ask"                  // 其他路径询问用户
    },

    "external_directory": {
      "~/Documents/*": "allow",   // 文档目录允许
      "*": "deny"                 // 其他外部目录拒绝
    }
  }
}
```

### 遗留 tools 字段迁移

旧的 `tools` 配置在 `prompt.ts` 中自动迁移为 permission 规则：

```typescript
// 旧格式
{ "tools": { "bash": false, "edit": true } }
// → 新格式
permission rules: [
  { permission: "bash", pattern: "*", action: "deny" },
  // edit: true 不生成规则（默认 ask）
]
```

---

## 14. 完整权限求值流程图

```
工具执行请求
  │
  ▼
ctx.ask({
  permission: "bash",
  patterns: ["git push origin main"],
  always: ["git push *"],
  ruleset: configRuleset
})
  │
  ▼
PermissionNext.ask()
  │
  ├── 对每个 pattern 调用 evaluate():
  │   │
  │   ├── 合并规则集: [...configRuleset, ...s.approved]
  │   │
  │   ├── findLast() 从后往前搜索匹配规则
  │   │
  │   ├── 匹配到 { action: "deny" } → throw DeniedError
  │   ├── 匹配到 { action: "allow" } → continue（检查下一个 pattern）
  │   └── 匹配到 { action: "ask" } 或无匹配:
  │       │
  │       ▼
  │   创建 Promise → 挂入 s.pending
  │   Bus.publish(Event.Asked)  → UI 显示权限弹窗
  │       │
  │       ▼ （等待用户回复）
  │
  ├── UI 调用 reply():
  │   │
  │   ├── "once" → resolve Promise → 工具继续执行
  │   │
  │   ├── "always":
  │   │   → 将 always 模式加入 s.approved
  │   │   → resolve Promise → 工具继续执行
  │   │   → 级联检查所有 pending → 自动批准匹配的请求
  │   │
  │   └── "reject":
  │       → reject Promise → throw RejectedError 或 CorrectedError
  │       → 级联拒绝同一 session 的所有 pending 请求
  │
  ▼
工具执行或终止
```

---

## 15. 关键设计洞察

### 1. "Always" 不是真的永久

`always` 批准仅保存在内存中（`s.approved` 数组），**不持久化到 DB**。代码中有 TODO 注释：

```typescript
// TODO: we don't save the permission ruleset to disk yet until there's UI to manage it
```

这意味着重启 OpenCode 后所有运行时批准的规则都会丢失。

### 2. 级联拒绝的激进策略

`reject` 回复会**拒绝同一 session 中的所有 pending 请求**，不仅仅是被拒绝的那一个。这是一个安全优先的设计：如果用户拒绝了一个操作，很可能也不希望同时等待的其他操作继续。

### 3. 级联批准的保守策略

`always` 回复仅级联批准那些**所有 pattern 都能被新规则覆盖**的 pending 请求（`patterns.every(...)`）。部分匹配不会触发级联。

### 4. Edit 权限的统一

`edit`, `write`, `patch`, `multiedit` 四个工具共享同一个 `"edit"` 权限类别。禁用 `edit` 权限会同时禁用所有四个工具。

### 5. Doom Loop 作为特殊权限

Doom loop 检测（3 次相同工具调用）不是硬性中断，而是通过权限系统让用户决定：

```typescript
PermissionNext.ask({
  permission: "doom_loop",
  patterns: [toolName],
  always: [toolName],
})
```

用户可以选择 "always" 来允许重复调用（适用于合法的批量操作场景）。

### 6. 遗留系统的 Plugin 优势

遗留 `Permission` 系统保留的主要价值是 `Plugin.trigger("permission.ask")` 钩子。Plugin 可以自动批准/拒绝权限请求，无需用户交互——这对 CI/CD 场景至关重要（如 GitHub Actions bot 需要自动批准所有操作）。
