# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode is an open-source AI coding agent with a terminal UI (TUI), web UI, and desktop app (Tauri). It supports multiple LLM providers (Claude, OpenAI, Google, Bedrock, Groq, Mistral, etc.) via the Vercel AI SDK.

## Repository Structure

Bun monorepo with Turbo for task orchestration. Key packages:

- `packages/opencode` — Core CLI, server, agent logic, and TUI (~46K LOC TypeScript)
- `packages/app` — Web UI (SolidJS + Vite)
- `packages/desktop` — Native desktop app (Tauri 2, wraps `packages/app`)
- `packages/plugin` — Plugin SDK (`@opencode-ai/plugin`)
- `packages/sdk/js` — Generated JS SDK (`@opencode-ai/sdk`)
- `packages/ui` — Shared UI components
- `packages/util` — Shared utilities

## Common Commands

```bash
bun install                          # Install dependencies
bun dev                              # Run TUI (defaults to packages/opencode dir)
bun dev .                            # Run TUI in repo root
bun dev <directory>                  # Run TUI in any directory
bun dev serve                        # Start headless API server (port 4096)
bun dev serve --port 8080            # Custom port
bun dev web                          # Start server + open web UI
bun typecheck                        # Type check all packages (uses turbo)
```

### Testing

Tests **cannot** run from repo root (guard: `do-not-run-tests-from-root`). Run from package directories:

```bash
cd packages/opencode && bun test --timeout 30000   # Unit tests for core
bun turbo test                                      # All package tests via turbo
bun --cwd packages/app test:e2e:local               # E2E tests (Playwright)
```

### Building

```bash
./packages/opencode/script/build.ts --single        # Single standalone binary
# Output: ./packages/opencode/dist/opencode-<platform>/bin/opencode
```

### SDK Regeneration

After changing the API or SDK (e.g., `packages/opencode/src/server/server.ts`):

```bash
./script/generate.ts                    # Regenerate SDK and related files
./packages/sdk/js/script/build.ts       # Regenerate JS SDK specifically
```

### Database Migrations

```bash
cd packages/opencode && bun drizzle-kit  # Drizzle Kit CLI
```

## Architecture

### Core Package (`packages/opencode/src/`)

**Entry point:** `index.ts` — yargs CLI that registers all commands.

Key subsystems:

| Directory | Purpose |
|-----------|---------|
| `agent/` | Built-in agents (`build` default, `plan` read-only), subagent orchestration |
| `server/` | Hono web framework, OpenAPI routes with Zod validation, WebSocket support |
| `session/` | Session management, message history (v2 format), prompt building, compaction |
| `tool/` | Tool system — bash, file ops, grep, glob, web search, LSP, task management |
| `provider/` | Multi-provider LLM integration via Vercel AI SDK, model snapshots from models.dev |
| `storage/` | SQLite + Drizzle ORM, JSON migration for legacy data |
| `permission/` | Granular permission rules, ask/allow/deny patterns |
| `lsp/` | Language Server Protocol — hover, completion, diagnostics |
| `cli/cmd/tui/` | Terminal UI built with SolidJS + OpenTUI |
| `config/` | Configuration management |
| `mcp/` | Model Context Protocol server management |

### Server API Routes

Hono-based with OpenAPI specs. Key route groups: `/session`, `/project`, `/file`, `/config`, `/provider`, `/pty`, `/mcp`, `/permission`, `/question`, `/auth/:providerID`.

### Web UI (`packages/app`)

SolidJS + Solid Router, Vite bundled, Tailwind CSS. Same API as TUI but browser-based.

## Code Style (from AGENTS.md)

- Avoid `try`/`catch` — prefer `.catch()`
- Avoid `any` type — use precise types
- Prefer single-word variable names; inline values used only once
- Use `const` not `let`; use ternaries or early returns instead of reassignment
- Avoid `else` — use early returns
- Avoid unnecessary destructuring — use dot notation
- Use Bun APIs (e.g., `Bun.file()`)
- Snake_case for Drizzle schema field names
- Rely on type inference; avoid explicit type annotations unless necessary
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops
- Avoid mocks in tests; test actual implementation

## Formatting

Prettier: `semi: false`, `printWidth: 120`

## Branch Convention

Default branch is `dev` (not `main`). Local `main` ref may not exist — use `dev` or `origin/dev` for diffs.

## PR Conventions

Conventional commit titles: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Optional scope: `feat(app):`, `fix(desktop):`.
