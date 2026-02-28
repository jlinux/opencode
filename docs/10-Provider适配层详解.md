# 10 - Provider 适配层详解

## 目录

1. [概览](#1-概览)
2. [20 个内置 SDK Provider](#2-20-个内置-sdk-provider)
3. [CUSTOM_LOADERS — Provider 特化加载器](#3-custom_loaders-provider-特化加载器)
4. [Model 数据模型](#4-model-数据模型)
5. [ModelsDev — 模型目录服务](#5-modelsdev-模型目录服务)
6. [Provider 状态初始化（完整流程）](#6-provider-状态初始化完整流程)
7. [SDK 实例化与缓存](#7-sdk-实例化与缓存)
8. [ProviderTransform — 消息格式转换](#8-providertransform-消息格式转换)
9. [ProviderTransform — 选项与参数](#9-providertransform-选项与参数)
10. [ProviderTransform — 推理变体系统](#10-providertransform-推理变体系统)
11. [ProviderTransform — 缓存控制注入](#11-providertransform-缓存控制注入)
12. [ProviderTransform — Schema 适配](#12-providertransform-schema-适配)
13. [ProviderError — 错误分类](#13-providererror-错误分类)
14. [ProviderAuth — 认证系统](#14-providerauth-认证系统)
15. [Small Model 选择策略](#15-small-model-选择策略)
16. [默认模型选择策略](#16-默认模型选择策略)
17. [关键设计洞察](#17-关键设计洞察)

---

## 1. 概览

Provider 适配层位于 `packages/opencode/src/provider/`，是 OpenCode 连接多个 LLM 后端的桥梁，共约 **6,573 行** TypeScript。

核心职责：
- **统一模型目录**：从 models.dev 拉取 + config 覆盖 + 环境变量检测
- **SDK 实例化**：20 个内置 + 动态安装外部 SDK
- **消息格式转换**：Provider 特有的格式要求、Tool Call ID 规范化
- **推理变体**：per-provider 的 reasoning effort 参数映射
- **缓存控制**：Anthropic/Bedrock/OpenRouter/Copilot 的 cache control 注入
- **错误分类**：13 种上下文溢出模式 + 可重试判定

### 文件概览

| 文件 | 行数 | 职责 |
|------|------|------|
| `provider.ts` | 1,338 | Provider 注册、模型加载、SDK 分发 |
| `transform.ts` | 955 | 消息规范化、选项映射、Schema 适配 |
| `error.ts` | 189 | 错误分类、溢出检测 |
| `auth.ts` | 147 | OAuth/API Key 认证管理 |
| `models.ts` | 132 | models.dev 目录获取与缓存 |
| `models-snapshot.ts` | 2 | 构建时打包的模型快照 |

---

## 2. 20 个内置 SDK Provider

**文件**: `provider.ts` — `BUNDLED_PROVIDERS` 映射

| npm 包 | 工厂函数 | 支持的后端 |
|--------|---------|-----------|
| `@ai-sdk/amazon-bedrock` | `createAmazonBedrock` | AWS Bedrock |
| `@ai-sdk/anthropic` | `createAnthropic` | Anthropic 直连 |
| `@ai-sdk/azure` | `createAzure` | Azure OpenAI |
| `@ai-sdk/google` | `createGoogleGenerativeAI` | Google AI (Gemini) |
| `@ai-sdk/google-vertex` | `createVertex` | Google Vertex AI |
| `@ai-sdk/google-vertex/anthropic` | `createVertexAnthropic` | Vertex 上的 Anthropic |
| `@ai-sdk/openai` | `createOpenAI` | OpenAI 直连 |
| `@ai-sdk/openai-compatible` | `createOpenAICompatible` | 通用 OpenAI 兼容 API |
| `@openrouter/ai-sdk-provider` | `createOpenRouter` | OpenRouter |
| `@ai-sdk/xai` | `createXai` | xAI (Grok) |
| `@ai-sdk/mistral` | `createMistral` | Mistral |
| `@ai-sdk/groq` | `createGroq` | Groq |
| `@ai-sdk/deepinfra` | `createDeepInfra` | DeepInfra |
| `@ai-sdk/cerebras` | `createCerebras` | Cerebras |
| `@ai-sdk/cohere` | `createCohere` | Cohere |
| `@ai-sdk/gateway` | `createGateway` | AI Gateway |
| `@ai-sdk/togetherai` | `createTogetherAI` | Together AI |
| `@ai-sdk/perplexity` | `createPerplexity` | Perplexity |
| `@ai-sdk/vercel` | `createVercel` | Vercel AI |
| `@gitlab/gitlab-ai-provider` | `createGitLab` | GitLab Duo |

非内置的 npm 包通过 `BunProc.install(pkg, "latest")` 动态安装后 `import()`。

---

## 3. CUSTOM_LOADERS — Provider 特化加载器

`CUSTOM_LOADERS` 是 per-provider 的异步初始化钩子，返回 `{ autoload, getModel?, options? }`。

### 完整加载器清单

| Provider ID | autoload 条件 | 特殊行为 |
|------------|---------------|---------|
| **anthropic** | `false`（需 API Key） | 注入 beta headers: `claude-code-20250219`, `interleaved-thinking-2025-05-14`, `fine-grained-tool-streaming-2025-05-14` |
| **opencode** | 有免费模型或用户有 Key | 无 Key 时隐藏付费模型，设置 `apiKey: "public"` |
| **openai** | `false` | `getModel`: 所有模型用 `sdk.responses()` API |
| **github-copilot** | `false` | `getModel`: GPT-5+（非 mini）用 `sdk.responses()`，其他用 `sdk.chat()` |
| **github-copilot-enterprise** | `false` | 同 github-copilot 逻辑 |
| **azure** | `false` | `getModel`: `useCompletionUrls` → `sdk.chat()`，否则 `sdk.responses()` |
| **azure-cognitive-services** | `false` | 从环境变量构建 `baseURL` |
| **amazon-bedrock** | 有凭证（Profile/Key/Bearer/WebIdentity/Container） | 跨区域模型前缀（`us.`, `eu.`, `jp.`, `apac.`, `au.`, `global.`）自动添加 |
| **openrouter** | `false` | 注入 `HTTP-Referer: https://opencode.ai/` |
| **vercel** | `false` | 同上 |
| **google-vertex** | 有 `GOOGLE_CLOUD_PROJECT` | 自定义 `fetch` 注入 Google OAuth Bearer token |
| **google-vertex-anthropic** | 有 `GOOGLE_CLOUD_PROJECT` | 默认 location: `global` |
| **sap-ai-core** | 有 `AICORE_SERVICE_KEY` | `getModel`: 直接 `sdk(modelID)` |
| **gitlab** | 有 GITLAB_TOKEN 或 OAuth | 注入 User-Agent + feature flags |
| **cloudflare-workers-ai** | 有 `CLOUDFLARE_ACCOUNT_ID` + Key | `baseURL` 包含 accountId |
| **cloudflare-ai-gateway** | 有 accountId + gateway + token | 动态 import `ai-gateway-provider` |
| **cerebras** | `false` | 注入 `X-Cerebras-3rd-Party-Integration: opencode` |
| **kilo** | `false` | 注入 Referer + Title |
| **zenmux** | `false` | 注入 Referer + Title |

### Bedrock 跨区域路由（最复杂的 getModel）

```
输入: modelID = "anthropic.claude-sonnet-4-5", region = "us-east-1"

1. 检查模型是否已有前缀（global., us., eu.等）→ 有则跳过
2. 取 region 前缀: "us-east-1" → "us"
3. 按区域分支:
   - us: claude/nova/deepseek 等需要前缀 → "us.anthropic.claude-sonnet-4-5"
     (GovCloud 不加前缀)
   - eu: 特定区域 + 特定模型 → "eu.xxx"
   - ap:
     - 澳洲区域 → "au.xxx"
     - 东京 → "jp.xxx"
     - 其他 APAC → "apac.xxx"
```

---

## 4. Model 数据模型

### Provider.Model Zod Schema

```typescript
Model = z.object({
  id: z.string(),                    // 如 "claude-sonnet-4-5-20250514"
  providerID: z.string(),            // 如 "anthropic"
  name: z.string(),                  // 如 "Claude Sonnet 4.5"
  family: z.string().optional(),     // 如 "claude"
  api: z.object({
    id: z.string(),                  // API 级别 ID（可能与 id 不同）
    url: z.string(),                 // API base URL
    npm: z.string(),                 // SDK npm 包名
  }),
  capabilities: z.object({
    temperature: z.boolean(),
    reasoning: z.boolean(),
    attachment: z.boolean(),
    toolcall: z.boolean(),
    input: { text, audio, image, video, pdf },
    output: { text, audio, image, video, pdf },
    interleaved: boolean | { field: "reasoning_content" | "reasoning_details" },
  }),
  cost: z.object({
    input: z.number(),               // $/M tokens
    output: z.number(),
    cache: { read, write },
    experimentalOver200K?: { input, output, cache },
  }),
  limit: z.object({
    context: z.number(),             // 上下文窗口
    input: z.number().optional(),    // 输入 token 限制
    output: z.number(),              // 最大输出 token
  }),
  status: z.enum(["alpha", "beta", "deprecated", "active"]),
  options: z.record(z.any()),        // 透传给 SDK 的选项
  headers: z.record(z.string()),     // 透传给请求的 headers
  release_date: z.string(),
  variants: z.record(z.record(z.any())),  // 推理变体配置
})
```

### capabilities.interleaved 字段

控制推理 token 的流式传输方式：
- `true` — SDK 原生支持 interleaved reasoning（Anthropic/OpenAI/Gemini 3.x）
- `{ field: "reasoning_content" }` — 通过 `providerOptions.openaiCompatible.reasoning_content` 字段传递（如 DeepSeek）
- `{ field: "reasoning_details" }` — 同上但用 `reasoning_details` 字段
- `false` — 不支持

---

## 5. ModelsDev — 模型目录服务

**文件**: `provider/models.ts` (132 行)

### 数据加载链

```
1. Flag.OPENCODE_MODELS_PATH 自定义路径 → 读取 JSON
2. ~/.cache/opencode/models.json     → 读取缓存
3. import("./models-snapshot")        → 构建时快照（fallback）
4. Flag.OPENCODE_DISABLE_MODELS_FETCH → 返回 {}
5. fetch("https://models.dev/api.json") → 远程拉取
```

### 自动刷新

```typescript
// 启动时立即刷新
ModelsDev.refresh()

// 每小时刷新一次
setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60)
```

### Model Schema（models.dev 格式）

```typescript
ModelsDev.Model = z.object({
  id, name, family?, release_date,
  attachment: z.boolean(),
  reasoning: z.boolean(),
  temperature: z.boolean(),
  tool_call: z.boolean(),
  interleaved?: true | { field: "reasoning_content" | "reasoning_details" },
  cost?: { input, output, cache_read?, cache_write?, context_over_200k? },
  limit: { context, input?, output },
  modalities?: { input: [...], output: [...] },
  experimental?: boolean,
  status?: "alpha" | "beta" | "deprecated",
  options: Record<string, any>,
  headers?: Record<string, string>,
  provider?: { npm?, api? },
  variants?: Record<string, Record<string, any>>,
})
```

---

## 6. Provider 状态初始化（完整流程）

`Provider.state` 是 per-Instance 懒加载的核心状态。初始化分 7 步：

### Step 1: 加载 models.dev 目录

```
modelsDev = await ModelsDev.get()
database = mapValues(modelsDev, fromModelsDevProvider)
```

将 models.dev 的扁平格式转为内部 `Provider.Info` + `Provider.Model` 格式。

### Step 2: 合并 Config 中的 Provider 定义

```
for (const [providerID, provider] of configProviders):
  parsed = mergeDeep(database[providerID] ?? {}, configProvider)
  // 合并 models: 从 models.dev + config.models
  // 合并 options: database.options + config.options
  database[providerID] = parsed
```

Config 可以：
- 添加 models.dev 中不存在的 Provider
- 覆盖现有 Provider 的模型配置
- 通过 `provider.npm` 指定自定义 SDK

### Step 3: 环境变量检测

```
for (const [providerID, provider] of database):
  apiKey = provider.env.map(item => env[item]).find(Boolean)
  if (apiKey) mergeProvider(providerID, { source: "env", key: apiKey })
```

每个 Provider 在 models.dev 中声明了 `env` 数组（如 `["ANTHROPIC_API_KEY"]`），逐一检查。

### Step 4: Auth 存储检测

```
for (const [providerID, auth] of await Auth.all()):
  if (auth.type === "api") mergeProvider(providerID, { source: "api", key: auth.key })
```

### Step 5: Plugin Auth 加载

```
for (const plugin of await Plugin.list()):
  if (plugin.auth.loader):
    options = await plugin.auth.loader(getAuth, database[providerID])
    mergeProvider(providerID, { options })
```

Plugin 可以提供自定义认证加载器（如 GitHub Copilot 的 OAuth token 刷新）。

### Step 6: CUSTOM_LOADERS 执行

```
for (const [providerID, fn] of CUSTOM_LOADERS):
  result = await fn(database[providerID])
  if (result.autoload || providers[providerID]):
    if (result.getModel) modelLoaders[providerID] = result.getModel
    mergeProvider(providerID, { options: result.options })
```

### Step 7: 过滤与清理

```
for (const [providerID, provider] of providers):
  - 检查 disabled_providers / enabled_providers
  - 删除 deprecated 模型
  - 删除 alpha 模型（除非 OPENCODE_ENABLE_EXPERIMENTAL_MODELS）
  - 应用 blacklist / whitelist
  - 删除 gpt-5-chat-latest（硬编码排除）
  - 计算 variants（推理变体）
  - 空 provider（无模型）删除
```

---

## 7. SDK 实例化与缓存

### `getSDK(model)` — 获取或创建 SDK 实例

```
1. 构建 options: provider.options + baseURL + apiKey + headers
2. 计算 hash key: xxHash32({ providerID, npm, options })
3. 缓存命中 → 返回
4. 缓存未命中:
   a. BUNDLED_PROVIDERS[npm] → 内置工厂创建
   b. 否则 → BunProc.install(npm, "latest") → import → 找 create* 函数
5. 缓存结果
```

### 自定义 fetch 包装

所有 SDK 实例的 `fetch` 都被包装：

```typescript
options["fetch"] = async (input, init) => {
  // 1. 超时管理：如果 options.timeout 设置，添加 AbortSignal.timeout()
  // 2. OpenAI itemId 清理：strip 输入中的 id 字段（跟随 Codex 实现）
  // 3. Bun fetch 兼容：设置 timeout: false 绕过 Bun 的默认超时
}
```

### `getLanguage(model)` — 获取 LanguageModelV2

```
1. 缓存检查: key = "providerID/modelID"
2. 缓存命中 → 返回
3. getSDK(model) → sdk
4. 如果有 modelLoaders[providerID] → 调用自定义加载器
5. 否则 → sdk.languageModel(model.api.id)
6. 缓存结果
```

---

## 8. ProviderTransform — 消息格式转换

**文件**: `provider/transform.ts` (955 行)

### `message()` — 主入口

```typescript
export function message(msgs, model, options) {
  msgs = unsupportedParts(msgs, model)     // 不支持的模态 → 文本错误提示
  msgs = normalizeMessages(msgs, model)    // Provider 特定规范化
  if (isAnthropic(model))
    msgs = applyCaching(msgs, model)       // 缓存控制注入
  msgs = remapProviderOptions(msgs, model) // providerOptions key 重映射
  return msgs
}
```

### `normalizeMessages()` — Provider 特定规范化

| Provider | 规范化操作 |
|----------|----------|
| **Anthropic** (`@ai-sdk/anthropic`) | 过滤空字符串消息、空 text/reasoning part |
| **Claude** (API ID 含 `claude`) | Tool Call ID 替换为 32 字符 hex（`/[^a-zA-Z0-9_-]/g` → `_`） |
| **Mistral** | Tool Call ID 截取为 9 字符字母数字；tool 消息后跟 user 消息时插入 `"Done."` assistant 消息 |
| **Interleaved reasoning** (`{ field: "reasoning_content" }`) | 提取 reasoning parts → 合并为 `providerOptions.openaiCompatible.reasoning_content` 字段 |

### `unsupportedParts()` — 模态过滤

对每个 user 消息中的 `file` 和 `image` part：
- 检测 MIME 类型 → 映射到 modality（image/audio/video/pdf）
- 查 `model.capabilities.input[modality]`
- 不支持 → 替换为文本错误："ERROR: Cannot read ... (this model does not support ... input)"
- 空 base64 图片 → "ERROR: Image file is empty or corrupted"

### `remapProviderOptions()` — Key 重映射

不同 provider 使用不同的 `providerOptions` 键名。`sdkKey()` 映射：

```
@ai-sdk/github-copilot    → "copilot"
@ai-sdk/openai / azure    → "openai"
@ai-sdk/amazon-bedrock     → "bedrock"
@ai-sdk/anthropic / vertex → "anthropic"
@ai-sdk/google / vertex    → "google"
@ai-sdk/gateway            → "gateway"
@openrouter/ai-sdk-provider → "openrouter"
```

---

## 9. ProviderTransform — 选项与参数

### `options()` — 模型级默认选项

| 条件 | 选项 |
|------|------|
| OpenAI / Copilot | `store: false` |
| OpenRouter | `usage: { include: true }` |
| OpenRouter + Gemini 3 | `reasoning: { effort: "high" }` |
| Baseten / OpenCode (kimi, glm) | `chat_template_args: { enable_thinking: true }` |
| ZAI / ZhipuAI | `thinking: { type: "enabled", clear_thinking: false }` |
| OpenAI (或 setCacheKey 标志) | `promptCacheKey: sessionID` |
| Google / Vertex | `thinkingConfig: { includeThoughts: true }` + Gemini 3 `thinkingLevel: "high"` |
| Anthropic + kimi-k2.5 | `thinking: { type: "enabled", budgetTokens: min(16K, output/2 - 1) }` |
| Alibaba-CN + reasoning models | `enable_thinking: true` |
| GPT-5 (非 chat/pro) | `reasoningEffort: "medium"` + `reasoningSummary: "auto"` + GPT-5.x: `textVerbosity: "low"` |
| Venice | `promptCacheKey: sessionID` |
| OpenRouter | `prompt_cache_key: sessionID` |
| Gateway | `gateway: { caching: "auto" }` |

### `temperature()` — Per-Model 温度

| 模型匹配 | 温度值 |
|---------|--------|
| `qwen` | 0.55 |
| `claude` | `undefined`（SDK 默认） |
| `gemini`, `glm-4.6`, `glm-4.7`, `minimax-m2` | 1.0 |
| `kimi-k2` thinking/2.5/p5 | 1.0 |
| `kimi-k2` (其他) | 0.6 |
| 其他 | `undefined` |

### `topP()` / `topK()`

| 模型 | topP | topK |
|------|------|------|
| `qwen` | 1 | — |
| `minimax-m2`, `gemini`, `kimi-k2.5` | 0.95 | — |
| `minimax-m2` (m2./m25/m21) | — | 40 |
| `minimax-m2` (其他) | — | 20 |
| `gemini` | — | 64 |

### `maxOutputTokens()`

```typescript
Math.min(model.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX
```

`OUTPUT_TOKEN_MAX` 默认 32,000，可通过 `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` 覆盖。

---

## 10. ProviderTransform — 推理变体系统

`variants(model)` 返回 `Record<string, Record<string, any>>`，每个 variant 是一组 providerOptions。

### Variant 映射矩阵

| SDK 包 | 模型 | 可用变体 | 参数格式 |
|--------|------|---------|---------|
| `@ai-sdk/openai` | GPT-5 / o-系列 | none, minimal, low, medium, high, xhigh | `reasoningEffort` + `reasoningSummary: "auto"` |
| `@ai-sdk/anthropic` | Opus/Sonnet 4.6 (adaptive) | low, medium, high, max | `thinking: { type: "adaptive" }` + `effort` |
| `@ai-sdk/anthropic` | 旧 Claude reasoning | high, max | `thinking: { type: "enabled", budgetTokens }` |
| `@ai-sdk/amazon-bedrock` | Anthropic adaptive | low, medium, high, max | `reasoningConfig: { type: "adaptive", maxReasoningEffort }` |
| `@ai-sdk/amazon-bedrock` | Anthropic 旧 | high, max | `reasoningConfig: { type: "enabled", budgetTokens }` |
| `@ai-sdk/amazon-bedrock` | Nova 模型 | low, medium, high | `reasoningConfig: { type: "enabled", maxReasoningEffort }` |
| `@ai-sdk/google` / `vertex` | Gemini 2.5 | high, max | `thinkingConfig: { includeThoughts: true, thinkingBudget }` |
| `@ai-sdk/google` / `vertex` | Gemini 3.x | low, [medium], high | `thinkingConfig: { includeThoughts: true, thinkingLevel }` |
| `@ai-sdk/github-copilot` | GPT-5 | low, medium, high, [xhigh] | `reasoningEffort` + `reasoningSummary` + `include: ["reasoning.encrypted_content"]` |
| `@ai-sdk/github-copilot` | Claude | thinking | `thinking_budget: 4000` |
| `@openrouter/ai-sdk-provider` | GPT/Gemini 3/Claude | none~xhigh | `reasoning: { effort }` |
| `@ai-sdk/gateway` | Anthropic adaptive | low~max | 同原生 Anthropic |
| `@ai-sdk/gateway` | Google 2.5 / 3.x | 同原生 Google | 同原生 Google |
| `@ai-sdk/gateway` | 其他 | none~xhigh | `reasoningEffort` |
| `@ai-sdk/groq` | — | none, low, medium, high | `reasoningEffort` |
| SAP providers | Anthropic | high, max | `thinking: { type: "enabled" }` |
| SAP providers | 其他 | low, medium, high | `reasoningEffort` |
| `xai` (Grok 3 Mini) | — | low, high | `reasoningEffort` 或 OpenRouter `reasoning.effort` |

### 被排除的模型

以下模型**不支持变体**：
- DeepSeek, MiniMax, GLM, Mistral, Kimi (非 k2.5)
- Grok (非 Grok 3 Mini)
- GPT-5-pro
- Cohere, Perplexity

---

## 11. ProviderTransform — 缓存控制注入

### `applyCaching()` — 仅 Anthropic 系模型

**缓存目标**：前 2 条 system 消息 + 最后 2 条非 system 消息

```typescript
const providerOptions = {
  anthropic:        { cacheControl: { type: "ephemeral" } },
  openrouter:       { cacheControl: { type: "ephemeral" } },
  bedrock:          { cachePoint: { type: "default" } },
  openaiCompatible: { cache_control: { type: "ephemeral" } },
  copilot:          { copilot_cache_control: { type: "ephemeral" } },
}
```

**注入策略**：
- Anthropic / Bedrock: 消息级 `providerOptions`
- 其他: 最后一个 content part 级 `providerOptions`

---

## 12. ProviderTransform — Schema 适配

### `schema()` — Gemini JSON Schema 清理

Google/Gemini 对 JSON Schema 有严格要求，`sanitizeGemini()` 递归处理：

| 问题 | 修复 |
|------|------|
| 整数 enum 值 | 转为字符串 + 类型改为 `string` |
| `required` 包含不存在的字段 | 过滤掉不在 `properties` 中的字段 |
| `array` 类型缺少 `items` | 添加 `items: {}` |
| `items` 缺少 `type` | 默认 `type: "string"` |
| 非 object 类型带 `properties`/`required` | 删除这些字段 |

---

## 13. ProviderError — 错误分类

**文件**: `provider/error.ts` (189 行)

### 上下文溢出检测 — 13 种模式

```typescript
const OVERFLOW_PATTERNS = [
  /prompt is too long/i,                    // Anthropic
  /input is too long for requested model/i, // Bedrock
  /exceeds the context window/i,            // OpenAI
  /input token count.*exceeds the maximum/i,// Google (Gemini)
  /maximum prompt length is \d+/i,          // xAI (Grok)
  /reduce the length of the messages/i,     // Groq
  /maximum context length is \d+ tokens/i,  // OpenRouter, DeepSeek
  /exceeds the limit of \d+/i,             // GitHub Copilot
  /exceeds the available context size/i,    // llama.cpp
  /greater than the context length/i,       // LM Studio
  /context window exceeds limit/i,          // MiniMax
  /exceeded model token limit/i,            // Kimi, Moonshot
  /context[_ ]length[_ ]exceeded/i,         // 通用回退
]

// 额外: Cerebras/Mistral 的 400/413 无 body 响应
/^4(00|13)\s*(status code)?\s*\(no body\)/i
```

### Stream 错误解析

`parseStreamError()` 处理流式传输中途的 JSON 错误：

| `error.code` | 分类 | 可重试 |
|--------------|------|--------|
| `context_length_exceeded` | `context_overflow` | 否 |
| `insufficient_quota` | `api_error` | 否 |
| `usage_not_included` | `api_error`（升级提示） | 否 |
| `invalid_prompt` | `api_error` | 否 |

### API Call 错误解析

`parseAPICallError()` 处理 `APICallError`：
- 溢出模式匹配 → `context_overflow`
- OpenAI 404 特殊处理 → 视为可重试（模型偶尔不可用）
- GitHub Copilot 403 → 提示重新认证

---

## 14. ProviderAuth — 认证系统

**文件**: `provider/auth.ts` (147 行)

### 认证方法发现

```typescript
methods() → mapValues(plugins with auth.provider, methods)
```

Plugin 声明支持的认证方法：`{type: "oauth" | "api", label: string}`。

### OAuth 流程

```
1. authorize({ providerID, method }) → 调用 Plugin 的 method.authorize()
   → 返回 { url, method: "auto"|"code", instructions }
   → 前端打开 URL

2. callback({ providerID, method, code? })
   → method === "code" → match.callback(code)
   → method === "auto" → match.callback()
   → 成功:
     - "key" 结果 → Auth.set(providerID, { type: "api", key })
     - "refresh" 结果 → Auth.set(providerID, { type: "oauth", access, refresh, expires })
```

### API Key 设置

```typescript
api({ providerID, key }) → Auth.set(providerID, { type: "api", key })
```

---

## 15. Small Model 选择策略

`getSmallModel(providerID)` 用于标题生成等低成本任务。

### 选择优先级

```typescript
// 默认优先级
priority = ["claude-haiku-4-5", "claude-haiku-4.5", "3-5-haiku",
            "3.5-haiku", "gemini-3-flash", "gemini-2.5-flash", "gpt-5-nano"]

// opencode 提供商
priority = ["gpt-5-nano"]

// github-copilot（优先免费模型）
priority = ["gpt-5-mini", "claude-haiku-4.5", ...默认列表]
```

### Config 覆盖

```jsonc
{ "small_model": "anthropic/claude-haiku-4-5-20251001" }
```

### Bedrock 特殊处理

对 Bedrock，按此顺序查找匹配模型的区域前缀变体：
1. `global.` 前缀（全球可用）
2. 用户区域前缀（如 `us.`, `eu.`）
3. 无前缀

### 终极回退

如果用户的 provider 没有小模型，回退到 `opencode/gpt-5-nano`（如果可用）。

---

## 16. 默认模型选择策略

`defaultModel()` 决定新 session 的默认模型。

### 优先级

```
1. config.model → 直接使用
2. ~/.local/share/opencode/state/model.json 中的 recent 列表
   → 按顺序检查，找到第一个仍可用的 provider + model
3. 从可用 providers 中取第一个 → sort() 后取最佳模型
```

### 模型排序优先级

```typescript
const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
```

按此列表排序，匹配的模型排在前面。同优先级内，`latest` 后缀优先，然后按 ID 降序。

---

## 17. 关键设计洞察

### 1. 统一抽象 vs 特化处理

Provider 系统在 `LanguageModelV2` 这一层提供统一抽象，但在抽象之下，`transform.ts` 和 `CUSTOM_LOADERS` 包含大量 provider 特化逻辑（Tool Call ID 格式、消息序列修复、区域路由）。这是务实的工程选择——LLM API 的差异太大，无法用纯抽象覆盖。

### 2. 动态 SDK 安装

非内置 SDK 通过 `BunProc.install(npm, "latest")` 在运行时安装。这允许用户在 config 中指定任何 Vercel AI SDK 兼容的 npm 包作为 provider，无需修改 OpenCode 代码。

### 3. SDK 实例缓存

`getSDK()` 使用 `xxHash32({ providerID, npm, options })` 作为缓存键。相同配置的 SDK 只实例化一次，避免重复创建连接。

### 4. OpenAI Item ID 清理

遵循 Codex 的做法，对 OpenAI Responses API 请求中的 `input[].id` 字段进行 strip，除非是 Azure + `store=true` 的场景。这避免了 ID 冲突问题。

### 5. 推理变体的复杂性

`variants()` 函数是整个代码库中 switch-case 最多的函数（955 行文件中占约 350 行）。每个 SDK + 模型组合都有独特的推理 effort 参数格式——这是 LLM 生态碎片化的直接体现。

### 6. models.dev 作为单一数据源

所有模型元数据（定价、能力、限制）来自 `models.dev`，构建时打包快照 + 运行时每小时刷新。Config 只能覆盖/扩展，不能替代。

### 7. "opencode" 提供商的免费增值模式

`opencode` loader 检查用户是否有 API Key。无 Key 时只暴露 `cost.input === 0` 的免费模型，并设置 `apiKey: "public"`。有 Key 后解锁所有模型。
