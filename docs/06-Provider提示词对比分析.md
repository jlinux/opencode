# 06 - Provider 系统提示词对比分析

## 目录

1. [概述](#1-概述)
2. [选择机制回顾](#2-选择机制回顾)
3. [维度对比矩阵](#3-维度对比矩阵)
4. [逐维度深度分析](#4-逐维度深度分析)
5. [各提示词完整结构拆解](#5-各提示词完整结构拆解)
6. [未被引用的提示词分析](#6-未被引用的提示词分析)
7. [设计哲学总结](#7-设计哲学总结)

---

## 1. 概述

OpenCode 根据模型 ID 为不同 LLM Provider 选择不同的系统提示词。这些提示词**不是简单的变量替换**，而是针对每个模型家族的行为特点、能力边界和最佳实践进行了深度定制。

当前被 `SystemPrompt.provider()` 引用的 6 份提示词文件：

| 提示词 | 文件 | 适用模型 | 行数 | 字符数(约) |
|--------|------|---------|------|-----------|
| PROMPT_CODEX | `codex_header.txt` | GPT-5 | 80 | 3,600 |
| PROMPT_BEAST | `beast.txt` | GPT-4/o1/o3 | 148 | 6,800 |
| PROMPT_GEMINI | `gemini.txt` | Gemini | 156 | 7,200 |
| PROMPT_ANTHROPIC | `anthropic.txt` | Claude | 106 | 4,800 |
| PROMPT_TRINITY | `trinity.txt` | Trinity | 98 | 4,400 |
| PROMPT_ANTHROPIC_WITHOUT_TODO | `qwen.txt` | 默认兜底(Qwen等) | 109 | 4,900 |

另有 2 份存在于目录中但未被引用的文件：
- `anthropic-20250930.txt`（167 行）— 归档的 Claude Code 兼容版本
- `copilot-gpt-5.txt`（144 行）— GitHub Copilot GPT-5 风格

---

## 2. 选择机制回顾

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

评估顺序决定了优先级：`gpt-5` > `gpt-*/o1/o3` > `gemini-` > `claude` > `trinity` > 默认。

---

## 3. 维度对比矩阵

### 3.1 身份与定位

| 维度 | anthropic | beast | gemini | qwen | trinity | codex |
|------|-----------|-------|--------|------|---------|-------|
| **自称** | "OpenCode, the best coding agent on the planet" | "opencode, an agent" | "opencode, an interactive CLI agent" | "opencode, an interactive CLI tool" | "opencode, an interactive CLI tool" | "OpenCode, the best coding agent on the planet" |
| **角色定位** | 最佳编程 Agent | 自主完成型 Agent | 专业 CLI 交互工具 | CLI 辅助工具 | CLI 辅助工具 | 最佳编程 Agent |
| **自主程度** | 中等（按需主动） | **极高**（不停直到完成） | 中等（确认后行动） | 低（用户驱动） | 低（用户驱动） | 中等（默认直接做） |

### 3.2 回复风格

| 维度 | anthropic | beast | gemini | qwen | trinity | codex |
|------|-----------|-------|--------|------|---------|-------|
| **简洁要求** | 无明确行数限制 | 无限制（鼓励详尽） | < 3 行文本 | < 4 行，单词最佳 | < 4 行 | 简洁友好 |
| **前言/后语** | 未特别限制 | 允许（说明意图） | 禁止闲聊 | **严禁**前言后语 | **严禁**前言后语 | 禁止（直接结果） |
| **示例数量** | 2 个 | 6 个（沟通示例） | 10 个（工作流示例） | 8 个（极简示例） | 7 个（极简示例） | 0 个 |
| **Emoji** | 仅用户要求时 | 未提及 | 未提及 | 仅用户要求时 | 仅用户要求时 | 未提及 |
| **Markdown** | GitHub-flavored | 未提及 | GitHub-flavored | GitHub-flavored | GitHub-flavored | GitHub-flavored |
| **语气** | 未特别指定 | 友好专业，带轻松幽默 | 专业直接 | 简洁直接 | 简洁直接 | 友好编码队友 |

### 3.3 任务管理与计划

| 维度 | anthropic | beast | gemini | qwen | trinity | codex |
|------|-----------|-------|--------|------|---------|-------|
| **TodoWrite 工具** | **强制频繁使用** | Markdown 列表(非TodoWrite) | 无 | 无 | 无 | 无 |
| **任务追踪方式** | TodoWrite 工具 | Emoji markdown todo | 无专门机制 | 无专门机制 | 无专门机制 | 无专门机制 |
| **计划要求** | 有（TodoWrite 规划） | **极详细**（8步工作流） | 有（5步工作流） | 无 | 无 | 问题分析后默认做 |
| **完成后行为** | 标记 todo 完成 | 必须检查所有项 | 运行 lint/test | 运行 lint/typecheck | 运行 lint/typecheck | 提供简洁总结 |

### 3.4 工具使用策略

| 维度 | anthropic | beast | gemini | qwen | trinity | codex |
|------|-----------|-------|--------|------|---------|-------|
| **并行调用** | 鼓励独立调用并行 | 未特别强调 | 鼓励并行（如搜索） | 鼓励并行 | **禁止**（每消息1个工具） | 鼓励并行 |
| **Task 工具偏好** | 文件搜索优先用Task | 未特别强调 | 未特别强调 | 文件搜索优先用Task | 文件搜索优先用Task | 未提及Task |
| **专用工具优先** | 专用 > bash | 未限制 | 专用 > bash（明确列出） | 专用 > bash | 专用 > bash | 专用 > bash |
| **WebFetch** | 重定向需重试 | **递归抓取所有链接** | 未提及 | 未提及 | 未提及 | 未提及 |
| **Bash 说明** | 未特别要求 | 执行前说明意图 | **修改命令必须先说明** | 非平凡命令说明 | 非平凡命令说明 | 未特别要求 |

### 3.5 代码规范

| 维度 | anthropic | beast | gemini | qwen | trinity | codex |
|------|-----------|-------|--------|------|---------|-------|
| **注释** | **不添加除非要求** | 未特别限制 | 仅高价值注释 | **不添加除非要求** | **不添加除非要求** | 仅必要非显然注释 |
| **代码约定** | 遵循现有 | 未特别强调 | **详细强调**（风格、框架、命名、类型） | 遵循现有 | 遵循现有 | 默认 ASCII |
| **库验证** | 未特别强调 | 推断项目类型 | **绝不假设**可用（必须验证） | **绝不假设**可用 | **绝不假设**可用 | 未提及 |
| **安全** | 不暴露密钥 | 未特别强调 | 不暴露密钥 | 不暴露密钥 | 不暴露密钥 | 未特别强调 |

### 3.6 安全与限制

| 维度 | anthropic | beast | gemini | qwen | trinity | codex |
|------|-----------|-------|--------|------|---------|-------|
| **恶意代码检查** | 无 | 无 | 无 | **有**（拒绝恶意代码） | 无 | 无 |
| **文件名检查** | 无 | 无 | 无 | **有**（基于目录结构判断） | 无 | 无 |
| **URL 生成限制** | 仅编程相关 | 无 | 无 | 仅编程相关 | 无 | 无 |
| **Git 约束** | 不主动提交 | 不主动提交（Memory有） | 不回滚别人的改动 | 不主动提交 | 不主动提交 | **详细**（不revert/reset --hard/amend） |
| **文件操作** | 不创建非必要文件 | 无特别限制 | 不回滚未自己修改的 | 无特别限制 | 无特别限制 | 默认 ASCII |

### 3.7 互联网与外部资源

| 维度 | anthropic | beast | gemini | qwen | trinity | codex |
|------|-----------|-------|--------|------|---------|-------|
| **互联网研究** | 无 | **强制**（核心要求） | 无 | 无 | 无 | 无 |
| **Google 搜索** | 无 | 必须验证所有第三方库 | 无 | 无 | 无 | 无 |
| **递归 URL 抓取** | 无 | **是**（所有相关链接） | 无 | 无 | 无 | 无 |
| **Memory 系统** | 无 | **有**（`.github/instructions/memory.instruction.md`） | 无 | 无 | 无 | 无 |
| **文档查询** | WebFetch opencode.ai/docs | 无 | 无 | WebFetch opencode.ai | 无 | 无 |

### 3.8 特有功能

| 提示词 | 独有特性 |
|--------|---------|
| **anthropic** | TodoWrite 任务管理系统、Professional objectivity（技术准确性优先） |
| **beast** | Memory 持久化系统、强制互联网研究、递归 URL 抓取、"resume/continue" 命令支持 |
| **gemini** | New Applications 完整创建流程（6步）、安全命令解释规则、交互式命令避免 |
| **qwen** | 恶意代码双重检查（代码内容 + 文件名/目录结构）、最严格简洁要求 |
| **trinity** | 每消息仅一个工具调用（最保守策略）、AGENTS.md 写入建议 |
| **codex** | 前端设计专用规则、Git 工作区卫生详细规范、apply_patch 优先 |

---

## 4. 逐维度深度分析

### 4.1 自主性光谱

从最被动到最主动，6 份提示词形成了一个清晰的光谱：

```
被动 ◄─────────────────────────────────────────────────────► 主动

qwen        trinity       gemini       anthropic      codex       beast
 │            │             │             │              │           │
 │            │             │             │              │           │
极简回应    每消息1工具   确认后行动    TodoWrite     默认做      不停直到完成
用户驱动    被动响应      安全优先      适度主动      直接做      完全自主
```

**beast.txt 最为激进**：
```
You MUST iterate and keep going until the problem is solved.
You have everything you need to resolve this problem. I want you to fully solve
this autonomously before coming back to me.
Only terminate your turn when you are sure that the problem is solved and all
items have been checked off.
NEVER end your turn without having truly and completely solved the problem.
```

**qwen.txt 最为保守**：
```
One word answers are best.
You MUST answer concisely with fewer than 4 lines.
You MUST avoid text before/after your response.
```

### 4.2 工具使用策略差异

#### beast.txt — "工具是武器，尽情使用"
- 不限制工具使用频率
- 强调用 webfetch 递归抓取所有链接
- 鼓励反复测试和验证
- 无并行/串行的明确规定

#### trinity.txt — "每次只用一个工具"
```
Use exactly one tool per assistant message. After each tool call, wait for the
result before continuing.
```
这是最保守的策略，强制 LLM 逐步执行，避免出错。

#### anthropic.txt / qwen.txt — "并行但有章法"
```
You can call multiple tools in a single response. If you intend to call multiple
tools and there are no dependencies between them, make all independent tool calls
in parallel.
```

#### gemini.txt — "并行搜索，安全执行"
```
Execute multiple independent tool calls in parallel when feasible (i.e. searching
the codebase).
```
特别将并行限制在搜索场景。

### 4.3 任务规划方法论

#### beast.txt — 8 步结构化工作流
```
1. Fetch provided URLs
2. Deeply understand the problem
3. Codebase investigation
4. Internet research (Google + recursive fetching)
5. Develop detailed plan (markdown todo list with emoji status)
6. Making code changes (incremental, testable)
7. Debugging (root cause, print statements)
8. Reflect and validate comprehensively
```
这是最详尽的工作流，每一步都有子步骤说明。

#### gemini.txt — 双轨制（Software Engineering + New Applications）

**软件工程任务 5 步**：
```
1. Understand → grep/glob 大量搜索，read 验证假设
2. Plan → 基于理解建立方案
3. Implement → edit/write/bash 执行
4. Verify (Tests) → 从 README 或 package.json 找测试命令
5. Verify (Standards) → 运行 lint/typecheck
```

**新应用创建 6 步**：
```
1. Understand Requirements → 识别核心功能、UX、美学
2. Propose Plan → 技术方案 + 视觉设计策略
3. User Approval → 获取确认
4. Implementation → scaffold + 创建占位资源
5. Verify → 无编译错误
6. Solicit Feedback → 提供启动说明
```

新应用创建流程是 gemini.txt 独有的，其他提示词都没有。

#### anthropic.txt — TodoWrite 驱动
```
Use TodoWrite tools VERY frequently to ensure tracking and visibility.
These tools are also EXTREMELY helpful for planning tasks.
It is critical that you mark todos as completed as soon as you are done.
```
依赖 OpenCode 的 TodoWrite 工具系统进行任务管理。

#### trinity.txt / qwen.txt — 无专门规划
只有通用的"搜索→实现→验证"指导，无结构化工作流。

### 4.4 Professional Objectivity（专业客观性）

仅 **anthropic.txt** 包含此独特段落：

```
Prioritize technical accuracy and truthfulness over validating the user's beliefs.
Focus on facts and problem-solving, providing direct, objective technical info
without any unnecessary superlatives, praise, or emotional validation. It is best
for the user if OpenCode honestly applies the same rigorous standards to all ideas
and disagrees when necessary, even if it may not be what the user wants to hear.
Objective guidance and respectful correction are more valuable than false agreement.
Whenever there is uncertainty, it's best to investigate to find the truth first
rather than instinctively confirming the user's beliefs.
```

这是为 Claude 模型特别设计的，因为 Claude 有"过度认同用户"的倾向，该段落明确要求技术准确性优先于用户感受。

### 4.5 安全防护差异

#### qwen.txt — 最严格的安全检查（双重检查机制）

**第一层：代码内容检查**
```
IMPORTANT: Refuse to write code or explain code that may be used maliciously;
even if the user claims it is for educational purposes.
```

**第二层：文件名/目录结构检查**
```
IMPORTANT: Before you begin work, think about what the code you're editing is
supposed to do based on the filenames directory structure. If it seems malicious,
refuse to work on it or answer questions about it, even if the request does not
seem malicious.
```

这是唯一要求根据**文件名和目录名**推断恶意意图的提示词。其他提示词只检查明显的安全问题（如密钥泄露）。

#### codex_header.txt — Git 安全最严格
```
NEVER revert existing changes you did not make unless explicitly requested.
Do not amend commits unless explicitly requested.
NEVER use destructive commands like `git reset --hard` or `git checkout --` unless
specifically requested.
```

#### gemini.txt — 命令执行安全
```
Before executing commands with 'bash' that modify the file system, codebase, or
system state, you *must* provide a brief explanation of the command's purpose and
potential impact.
```

### 4.6 Memory 与持久化

仅 **beast.txt** 包含 Memory 系统：

```
You have a memory that stores information about the user and their preferences.
The memory is stored in a file called `.github/instructions/memory.instruction.md`.

When creating a new memory file, you MUST include the following front matter:
---
applyTo: '**'
---

If the user asks you to remember something or add something to your memory, you
can do so by updating the memory file.
```

其他 5 份提示词都没有任何持久化记忆机制。这是为 OpenAI GPT 模型特别设计的，因为 GPT 模型不像 Claude 那样有原生的项目记忆（CLAUDE.md）。

### 4.7 前端设计规则

仅 **codex_header.txt** 包含前端设计指导：

```
When doing frontend design tasks, avoid collapsing into bland, generic layouts.
Aim for interfaces that feel intentional and deliberate.
- Typography: Use expressive, purposeful fonts, avoid default stacks
- Color & Look: Choose clear visual direction; no purple bias or dark mode bias
- Motion: Use few meaningful animations
- Background: Don't rely on flat, single-color backgrounds
- Overall: Avoid boilerplate layouts; vary themes, type families
```

这暗示 GPT-5 被期望用于更多前端/设计相关的任务。

### 4.8 代码引用格式

| 提示词 | 引用格式 | 示例 |
|--------|---------|------|
| anthropic | `file_path:line_number` | `src/services/process.ts:712` |
| beast | 无特定格式 | — |
| gemini | 无特定格式 | — |
| qwen | `file_path:line_number` | `src/services/process.ts:712` |
| trinity | `file_path:line_number` | `src/services/process.ts:712` |
| codex | 内联代码 + 可选行列号 | `` `src/app.ts:42` `` |

---

## 5. 各提示词完整结构拆解

### 5.1 anthropic.txt（Claude 模型，106 行）

```
1. 身份声明（1-5 行）
   "You are OpenCode, the best coding agent on the planet."

2. URL 限制（5 行）
   仅生成编程相关 URL

3. 帮助/反馈信息（6-10 行）
   ctrl+p 列出操作、GitHub issues 反馈
   WebFetch opencode.ai/docs 回答 OpenCode 问题

4. 语气与风格（14-18 行）
   - 简洁直接
   - GitHub-flavored Markdown
   - 不创建非必要文件

5. Professional Objectivity（21 行）★ 独有
   技术准确性 > 用户感受验证

6. Task Management（24-67 行）★ 核心特色
   - TodoWrite 强制频繁使用
   - 两个详细使用示例（build fix + new feature）

7. Doing tasks（70-76 行）
   - TodoWrite 规划
   - system-reminder 标签说明

8. Tool usage policy（78-90 行）
   - Task 工具优先
   - 并行调用策略
   - WebFetch 重定向处理

9. TodoWrite 提醒（96 行）
   "IMPORTANT: Always use the TodoWrite tool"

10. Code References（98-106 行）
    file_path:line_number 格式
```

### 5.2 beast.txt（GPT-4/o1/o3 模型，148 行）

```
1. 身份与自主宣言（1-9 行）
   "You MUST iterate and keep going until the problem is solved."
   "I want you to fully solve this autonomously before coming back to me."

2. 互联网研究要求（11-18 行）★ 独有
   "THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH."
   必须用 webfetch 验证所有第三方库

3. 沟通规则（20-22 行）
   每次工具调用前用一句话说明意图

4. Resume/Continue 支持（24-28 行）★ 独有
   检查之前的 todo 列表继续执行

5. 质量要求（24-28 行）
   "Your solution must be perfect."
   "Failing to test sufficiently is the NUMBER ONE failure mode."

6. 规划强调（30 行）
   每次函数调用前大量规划，每次结果后大量反思

7. 结构化工作流（33-49 行）★ 最详细的 8 步流程
   1. Fetch URLs
   2. Understand problem
   3. Investigate codebase
   4. Internet research (Google)
   5. Develop plan
   6. Make changes
   7. Debug
   8. Reflect & validate

8. 工作流各步骤详解（51-95 行）
   每步有 4-8 条详细指导

9. 沟通指南（97-111 行）
   友好专业语气 + 沟通示例

10. Memory 系统（113-124 行）★ 独有
    .github/instructions/memory.instruction.md

11. 文件读取优化（126-136 行）
    避免重复读取已读文件

12. Prompt 写作指南（138-142 行）
    Markdown 格式

13. Git 规则（144-148 行）
    明确允许 stage+commit，禁止自动提交
```

### 5.3 gemini.txt（Gemini 模型，156 行）

```
1. 身份声明（1 行）
   "opencode, an interactive CLI agent specializing in software engineering tasks"

2. Core Mandates（3-15 行）★ 最详细的约定要求
   - Conventions: 严格遵守项目约定
   - Libraries: 绝不假设库可用
   - Style & Structure: 模仿现有风格
   - Idiomatic Changes: 理解本地上下文
   - Comments: 仅高价值、说明"为什么"
   - Proactiveness: 完成请求但不超出范围
   - Path Construction: 必须构建完整绝对路径
   - Do Not revert: 不回滚他人改动

3. Primary Workflows — Software Engineering（18-25 行）
   5 步: Understand → Plan → Implement → Verify(Tests) → Verify(Standards)

4. Primary Workflows — New Applications（27-36 行）★ 独有
   6 步: Understand → Propose → Approve → Implement → Verify → Feedback
   包含视觉设计、占位资产、脚手架等指导

5. Operational Guidelines（38-58 行）
   - Tone: < 3 行, 无闲聊
   - Security: 修改命令必须先说明
   - Tool Usage: 绝对路径、并行、后台进程
   - Interactive Commands: 避免交互式 shell
   - Respect User Confirmations: 取消后不重试

6. Interaction Details（60-62 行）
   /help 和 /bug 命令

7. Examples（64-156 行）★ 最多示例（10 个）
   涵盖: 数学计算、命令查询、文件查找、服务器启动、重构、
         删除操作、写测试、功能解释、配置查找
```

### 5.4 qwen.txt（默认兜底，109 行）

```
1. 身份声明（1-2 行）
   "opencode, an interactive CLI tool"

2. 恶意代码检查（3-5 行）★ 独有第一层
   拒绝编写/解释恶意代码

3. 恶意代码检查（6-8 行）★ 独有第二层
   根据文件名/目录结构判断恶意意图

4. URL 限制（9 行）

5. 帮助信息（11-12 行）

6. WebFetch opencode.ai（12 行）

7. Tone and style（14-63 行）
   - 极简输出（< 4 行，单词最佳）
   - 禁止前言/后语
   - 8 个极简回答示例（2+2=4, prime=Yes, ls, etc.）

8. Proactiveness（65-71 行）
   用户请求才主动，不做额外解释

9. Following conventions（73-78 行）
   - 不假设库可用
   - 遵循现有模式
   - 安全最佳实践

10. Code style（80 行）
    不添加注释

11. Doing tasks（82-91 行）
    搜索 → 实现 → 验证 → lint/typecheck

12. Tool usage policy（93-97 行）
    Task 工具优先、并行调用

13. 恶意代码检查重复（98-99 行）
    再次强调拒绝恶意代码

14. Code References（101-109 行）
    file_path:line_number 格式
```

### 5.5 trinity.txt（Trinity 模型，98 行）

```
1. 身份声明（1 行）
   "opencode, an interactive CLI tool"

2. Tone and style（3-48 行）
   - < 4 行极简回答
   - 禁止前言/后语
   - 7 个极简示例

3. Proactiveness（55-61 行）
   用户请求才主动

4. Following conventions（63-68 行）
   不假设库可用

5. Code style（70 行）
   不添加注释

6. Doing tasks（72-78 行）
   完成后必须运行 lint/typecheck
   不主动提交
   system-reminder 标签说明

7. Tool usage policy（82-88 行）★ 核心特色
   - Task 工具优先
   - **每消息一个工具**
   - 避免重复相同参数的工具调用

8. 回复限制（88 行）
   "You MUST answer concisely with fewer than 4 lines"

9. Code References（90-98 行）
```

### 5.6 codex_header.txt（GPT-5/Codex，80 行）

```
1. 身份声明（1-2 行）
   "OpenCode, the best coding agent on the planet"

2. Editing constraints（6-9 行）
   - 默认 ASCII
   - 仅必要注释
   - apply_patch 优先

3. Tool usage（11-16 行）
   专用工具 > bash，并行规则

4. Git and workspace hygiene（18-25 行）★ 最详细的 Git 规范
   - 不 revert 他人改动
   - 不 amend 除非要求
   - 不 git reset --hard / git checkout --

5. Frontend tasks（27-36 行）★ 独有
   Typography / Color / Motion / Background / Overall 设计规则

6. Presenting your work（38-59 行）
   - 简洁友好语气
   - 默认直接做，不问"可以继续吗？"
   - 不转储大文件，仅引用路径
   - 代码变更后提供简洁说明

7. Final answer structure（61-80 行）★ 最详细的格式规范
   - Headers: Title Case, **...**
   - Bullets: - 格式, 4-6 条
   - Monospace: backticks
   - Code: fenced blocks + info string
   - Tone: collaborative, factual
   - File References: 内联代码 + 行号
```

---

## 6. 未被引用的提示词分析

### 6.1 anthropic-20250930.txt（归档版，167 行）

这是 `anthropic.txt` 的前一个版本，明显对标 Claude Code 的系统提示词。

**与当前 anthropic.txt 的区别**：

| 维度 | 当前 anthropic.txt | 归档 anthropic-20250930.txt |
|------|-------------------|---------------------------|
| 行数 | 106 | 167 |
| Hooks 支持 | 无 | 有（`<user-prompt-submit-hook>` 处理） |
| 简洁要求 | 无明确行数限制 | "fewer than 4 lines" |
| 前言禁止 | 无 | 有（与 qwen.txt 类似的禁止规则） |
| 环境信息 | 无（由 SystemPrompt.environment() 提供） | **内嵌**（工作目录、平台、日期、模型名称） |
| 知识截断 | 无 | "Assistant knowledge cutoff is January 2025" |
| 模型名称 | 无 | "You are powered by the model named Sonnet 4.5" |
| 安全检查 | 无 | 有（"Assist with defensive security tasks only"）|
| 示例 | 2 个 | 2 个 |

**分析**：归档版是一个"大而全"的提示词，包含了环境信息和简洁要求。当前版本将环境信息移到了 `SystemPrompt.environment()`，简洁要求被移除（可能因为 Claude 模型本身已有较好的简洁性），整体更精简。

### 6.2 copilot-gpt-5.txt（GitHub Copilot 风格，144 行）

这份提示词模拟 GitHub Copilot（GPT-5 版本）的风格，使用了 XML 标签分区。

**独有结构**：
```xml
<gptAgentInstructions>  — Agent 自主指令
<structuredWorkflow>    — 8 步结构化工作流（类似 beast.txt）
<communicationGuidelines> — 沟通指南
<codeSearchInstructions>  — 代码搜索策略
<codeSearchToolUseInstructions> — 搜索工具使用
<toolUseInstructions>     — 通用工具使用
<outputFormatting>        — 输出格式化
```

**独特的代码搜索策略**：
```
Use semantic_search for high level concepts (best starting point).
Prefer search_workspace_symbols over grep_search for precise identifiers.
Prefer grep_search over semantic_search for precise keywords.
```

**独特的代码块格式**：
```
Use 4 backticks to start code blocks.
After backticks, add language name.
Add a line comment with 'filepath:' and file path.
Use '...existing code...' to indicate unchanged code.
```

**为什么未被引用**：可能是为 Copilot 集成场景准备的实验性版本，目前不在主流程中使用。

---

## 7. 设计哲学总结

### 7.1 为什么需要不同的提示词？

不同的 LLM 模型有不同的行为特点和能力边界：

| 模型家族 | 行为特点 | 提示词应对策略 |
|----------|---------|---------------|
| **Claude** | 过度认同用户、回复详尽、善于遵循复杂指令 | Professional objectivity 矫正、TodoWrite 结构化追踪 |
| **GPT-4/o1/o3** | 可能过早停止、需要强推完成 | beast.txt 的极端自主要求、"NEVER end your turn" |
| **GPT-5** | 更先进但需要结构化输出 | codex_header.txt 的格式规范和前端设计指导 |
| **Gemini** | 需要明确约束、善于结构化工作 | 最详细的 Core Mandates + 双轨工作流 |
| **Trinity** | 可能工具调用混乱 | 每消息一个工具的严格限制 |
| **Qwen等** | 能力参差不齐 | 最保守的极简策略 + 恶意代码防护 |

### 7.2 三种设计范式

**范式 A：放手型（beast.txt）**
- 假设模型能力强，但可能不够主动
- 通过强语气推动完成：必须、绝不停止、完美解决
- 适合需要深度研究和长时间独立工作的场景

**范式 B：约束型（trinity.txt / qwen.txt）**
- 假设模型可能出错或能力有限
- 通过严格限制减少失误：一个工具、4 行回复、禁止前言
- 适合需要精确控制和可预测行为的场景

**范式 C：协作型（anthropic.txt / gemini.txt）**
- 假设模型能力良好，需要适当引导
- 通过结构化工具和工作流优化效果：TodoWrite、5 步流程
- 适合日常编程任务的主流使用场景

### 7.3 共同基础

尽管差异显著，所有提示词共享一些核心原则：

1. **工具是行动，文本是沟通** — 不用 bash echo 与用户沟通
2. **不主动 commit** — 除非用户明确要求
3. **安全第一** — 不暴露密钥和秘密
4. **遵循项目约定** — 不假设库可用
5. **验证变更** — 运行测试/lint/typecheck
6. **`<system-reminder>` 标签** — 系统自动添加，非用户输入
7. **代码引用** — 提供文件路径帮助用户导航

### 7.4 演进方向

从归档版（anthropic-20250930.txt）到当前版本的变化可以看出演进趋势：

1. **提示词瘦身** — 将环境信息从提示词中抽离到 `SystemPrompt.environment()`
2. **去重** — 共性内容由框架层处理，提示词只保留差异化部分
3. **实验与沉淀** — copilot-gpt-5.txt 作为实验版本存在，成功的模式被吸收到主提示词中
4. **安全增强** — qwen.txt 的恶意代码双重检查是较新的安全特性
