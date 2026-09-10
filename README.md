# ⚡ SmartRelay

> **The intelligent delegation layer & zero-token task server for AI agents.**

[![MCP Standard](https://img.shields.io/badge/MCP-Standard-blue.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-3178C6.svg)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-39%20Passing-brightgreen.svg)](#-testing--verification)
[![Fleet](https://img.shields.io/badge/Fleet-NVIDIA%20%7C%20Claude%20%7C%20Ollama%20%7C%20OpenAI-orange.svg)](#-supported-backends--models)

**SmartRelay** is a high-performance [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server built with TypeScript. It transforms **Claude Code**, **Cursor**, **Windsurf**, and other MCP-compatible AI editors into a **Master Orchestrator** — delegating heavy tasks (code reviews, test generation, explanations, architecture planning) to specialized sub-agents (NVIDIA NIM, Claude Sonnet, GPT-4o, local Ollama) with **zero context-window bloat** and concurrent multi-model benchmarking.

---

## 📋 Prerequisites

Before installing, ensure you have:
- **Node.js**: `v20.11.0` or higher (`node -v`)
- **Git**
- *(Optional)* **[Ollama](https://ollama.ai)**: If using local offline models (`ollama serve && ollama pull qwen2.5-coder`)
- API keys for at least one provider (Anthropic, OpenAI, OpenRouter, or NVIDIA NIM)

---

## 🚀 Quick Install

### Option A — Clone & Build *(Recommended — works immediately)*

```bash
git clone https://github.com/DhavanBhalodiya/smart-relay.git
cd smart-relay
npm install
npm run build
cp .env.example .env   # fill in your API keys
```

> **Optional (CLI shortcut)**: Run `npm link` inside the directory to make the `smartrelay` command available anywhere on your machine.

Now connect it to your editor — see [Connect to Your AI Client](#4-connect-to-your-ai-client) below.

### Option B — `npx` *(available once published to npm registry)*

Add directly to your Claude Desktop / Cursor / Windsurf MCP configuration:

```json
{
  "mcpServers": {
    "smartrelay": {
      "command": "npx",
      "args": ["-y", "smartrelay"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "NVIDIA_API_KEY": "nvapi-...",
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

### Option C — Browser Test Drive (MCP Inspector)

Test all 13 tools interactively in your browser with zero editor configuration:

```bash
cd smart-relay
npm run build
npx -y @modelcontextprotocol/inspector node dist/server.js
```
Opens an interactive UI at **http://localhost:6274** where you can execute and inspect tools live.

---

## ⚡ Natural Language Model Switching

Switch models on the fly during your session — just type plain English:

| What to say | Target Model & Provider | Purpose |
| :--- | :--- | :--- |
| **`Switch to openrouter`** | **Claude 3.7 Sonnet** via OpenRouter | Flagship cloud reasoning & architecture |
| **`Switch to deepseek`** / **`Switch to r1`** | **DeepSeek-R1 671B** via OpenRouter / NIM | Deep reasoning with chain-of-thought (CoT) |
| **`Switch to v3`** | **DeepSeek-V3 671B** via OpenRouter | High-speed code generation ($0.14/M) |
| **`Switch to qwen`** | **Qwen 2.5 Coder 32B** | Specialized code intelligence |
| **`Switch to llama`** | **Llama 3.3 70B** | Meta flagship for planning & system design |
| **`Switch to gemini`** | **Gemini 2.0 Flash** via OpenRouter | Ultra-fast with 1M token context window |
| **`Switch to nvidia`** | **NVIDIA NIM** (Nemotron 3 Super 120B) | Heavyweight cloud code & test agent |
| **`Switch to claude`** | **Claude Sonnet 4.5 / 3.7** | Elite code reviews & refactoring |
| **`Switch to ollama`** / **`Switch to local`** | Local **Qwen 2.5 Coder** | $0.00 completely free & offline |
| **`Switch to auto`** | Smart intent routing (default) | Automatically picks the best agent for the task |
| **`Switch to direct`** | Claude Code native intelligence | Answers directly without sub-agents |
| **`What model is active?`** | Calls `get_active_model` | Shows current runner and routing mode |
| **`What models can I switch to?`** | Calls `switch_model(model='list')` | Displays full interactive model fleet menu |

---

## 🛠️ 13 MCP Tools

| Tool | What It Does |
| :--- | :--- |
| **`review_file`** ⭐ | Zero-token: server reads the file itself → returns 🛡️ Code Review Report |
| **`test_file`** ⭐ | Zero-token: server reads the file itself → generates production-ready tests |
| **`explain_file`** ⭐ | Zero-token: server reads the file itself → returns 📖 plain-English explanation |
| **`review_code`** | Code review on code passed directly in the prompt |
| **`generate_tests`** | Unit & integration tests for code passed directly |
| **`explain_code`** | Plain-English explanation for any code snippet (any language, any audience) |
| **`create_plan`** | Generates a phased architectural implementation plan |
| **`ask_subagent`** | Offloads any question or coding task to a specific sub-agent model |
| **`delegate_task`** | Delegates to a specific runner or uses auto-routing |
| **`benchmark_run`** | Runs a task across multiple models concurrently and compares results |
| **`switch_model`** | Programmatically switch the active runner |
| **`get_active_model`** | Returns the currently active runner info |
| **`list_runners`** | Lists all registered runners and their metadata |

---

## 📋 Copy-Paste Prompts for Claude Code

### ⭐ Zero-Token File Operations
```text
Call tool review_file with file_path='lib/screens/login_screen.dart'
```
```text
Call tool test_file with file_path='lib/services/auth_service.dart'
```
```text
Call tool explain_file with file_path='lib/blocs/cart_bloc.dart' and audience='junior'
```
```text
Call tool explain_file with file_path='lib/blocs/cart_bloc.dart' and audience='senior'
```

> **Audiences**: `junior` | `mid-level` (default) | `senior` | `non-technical`

### 💡 Code Snippet Explanation
```text
Call tool explain_code with code='Future<void> sync() async { ... }' and audience='mid-level'
```
```text
Call tool explain_code with code='type UserState = { status: "idle" | "loading" };' and language='typescript' and audience='junior'
```

### 📐 Architecture Planning
```text
Call tool create_plan for 'Offline SQLite caching in Flutter'
```

### 🤖 Ask a Specific Model
```text
Call tool ask_subagent with prompt='Write a Flutter Riverpod StateNotifier for cart' and model='nvidia'
```
```text
Call tool ask_subagent with prompt='Explain Dart Streams' and model='ollama'
```

### 📊 Multi-Model Benchmark
```text
Call tool benchmark_run with task='Write an LRU Cache in Dart' and runner_ids=['nvidia-llama-3.3-70b', 'openrouter-claude-sonnet-4.5']
```

---

## 🌐 Supported Backends & Models

| Provider | Models | Env Variable |
| :--- | :--- | :--- |
| **OpenRouter** | Claude 3.7 Sonnet, DeepSeek-R1 (671B), DeepSeek-V3, Qwen 2.5 Coder, Llama 3.3 70B, Gemini 2.0 Flash | `OPENROUTER_API_KEY` |
| **NVIDIA NIM** | Nemotron 3 Super 120B, Llama 3.3 70B, Qwen Coder, DeepSeek R1 | `NVIDIA_API_KEY` |
| **Local Ollama** | Qwen 2.5 Coder, Llama 3.2, DeepSeek-R1 | *(none — free & offline)* |
| **Anthropic Direct** | Claude 3.7 Sonnet, Claude 3.5 Haiku | `ANTHROPIC_API_KEY` |
| **OpenAI Direct** | GPT-4o, GPT-4o-mini | `OPENAI_API_KEY` |

---

## 📁 Project Structure

```
SmartRelay/
├── src/
│   ├── server.ts          ← MCP stdio server (13 tools registered)
│   ├── http-api.ts        ← Fastify HTTP API (for MCPHub plugin)
│   ├── router.ts          ← TaskRouter with intent classification
│   ├── tools/
│   │   └── handlers.ts    ← All tool implementations
│   ├── runners/           ← Anthropic, OpenAI, NVIDIA, Ollama, OpenRouter
│   ├── benchmark/         ← BenchmarkEngine + scorers
│   ├── logger.ts
│   └── util.ts
├── plugin-smartrelay/     ← MCPHub plugin (standalone, uploadable)
│   └── src/index.ts       ← SmartRelayPlugin class
├── config/
│   └── runners/
│       ├── agents.yaml    ← Specialized agents (planner, reviewer, etc.)
│       ├── nvidia.yaml
│       ├── openrouter.yaml
│       ├── ollama.yaml
│       ├── anthropic.yaml
│       └── openai.yaml
├── config.yaml            ← Main config (includes all runner files)
├── prompts/               ← System prompts for each agent role
│   ├── code_review.md
│   ├── explain_code.md
│   ├── planner.md
│   └── test_generator.md
└── tests/                 ← 39 Vitest tests
```

---

## 🚀 Quick Setup Guide (Development / Self-hosted)

### 1. Clone & Install

```bash
git clone https://github.com/DhavanBhalodiya/smart-relay
cd smart-relay
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
OPENROUTER_API_KEY=sk-or-v1-...
NVIDIA_API_KEY=nvapi-...

# For HTTP API / MCPHub plugin
SMARTRELAY_HTTP_API_KEY=your-secure-bearer-token-here
```

> You only need keys for the providers you want to use. Ollama works with no key (free, local).

### 3. Build

```bash
npm run build
```

### 4. Connect to Your AI Client

> 💡 **Tip — Finding your absolute path**:
> Run `pwd` (macOS/Linux) or `echo %cd%` (Windows) in your `smart-relay` folder to find your `/ABSOLUTE/PATH/TO/smart-relay`.
>
> ⚠️ **Important (GUI Apps & Node PATH)**:
> GUI applications (Claude Desktop, Cursor) on macOS and Linux often do not inherit shell environment variables like `PATH`. If you get `spawn node ENOENT` or `Connection failed`:
> - Run `which node` in your terminal (e.g. `/opt/homebrew/bin/node` or `/usr/local/bin/node`).
> - Use that exact full path instead of `"command": "node"`.

#### 🟣 Claude Code (CLI)

Run from your terminal inside your `smart-relay` directory:
```bash
claude mcp add smartrelay -- node $(pwd)/dist/server.js
```
*Or from any project directory using your absolute path:*
```bash
claude mcp add smartrelay -- node /ABSOLUTE/PATH/TO/smart-relay/dist/server.js
```
Verify: `claude mcp list` | Remove: `claude mcp remove smartrelay`

#### 🟠 Claude Desktop

Config file locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "smartrelay": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/smart-relay/dist/server.js"],
      "env": {
        "OPENAI_API_KEY": "sk-proj-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "NVIDIA_API_KEY": "nvapi-...",
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```
*(Note: If you already configured `.env` inside the `smart-relay` repository, the `"env"` block above is optional — SmartRelay auto-detects it!)*

#### 🔵 Cursor IDE

Go to **Settings → Features → MCP → + Add New MCP Server**:
- **Name**: `smartrelay`
- **Type**: `command`
- **Command**: `node /ABSOLUTE/PATH/TO/smart-relay/dist/server.js`

#### 🌊 Windsurf / Codeium

Edit `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "smartrelay": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/smart-relay/dist/server.js"]
    }
  }
}
```

#### 🟢 VS Code (Cline / Roo Code)

Edit your Cline MCP settings (`cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "smartrelay": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/smart-relay/dist/server.js"]
    }
  }
}
```

---

## 🧪 Testing & Verification

### Run all 39 automated tests
```bash
npm test
```

### TypeScript type check
```bash
npm run typecheck
```

### Plugin conformance test (MCPHub)
```bash
npm run test:plugin
```

### Quick manual CLI test
```bash
# List all registered runners
npm run quick-test -- --list

# Test a specific runner
npm run quick-test -- "Say hello" --runner nvidia-llama-3.3-70b

# Test local Ollama (free)
npm run quick-test -- "Explain Dart Streams" --runner ollama-llama3.2
```

### Start HTTP API server (for MCPHub plugin)
```bash
export SMARTRELAY_HTTP_API_KEY=my-secret-token
npm run start:http
# → http://127.0.0.1:8000
```

Test HTTP endpoints:
```bash
curl -H "Authorization: Bearer my-secret-token" http://127.0.0.1:8000/v1/health
curl -H "Authorization: Bearer my-secret-token" http://127.0.0.1:8000/v1/runners
```

---

## 🌐 MCP Inspector — Visual Browser UI

Browse and run all 13 tools interactively in your browser:

```bash
npm run build
npx -y @modelcontextprotocol/inspector node dist/server.js
```

Opens at **http://localhost:6274**

| Tab | What's inside |
| :--- | :--- |
| **Tools** | All 13 tools with interactive forms — fill in params and run live |
| **Resources** | Resources exposed by the server |
| **Prompts** | Prompt templates |

> Fastest way to verify everything works without needing Claude Code or any AI client.

---

## 🔧 npm Scripts Reference

| Script | Command | What it does |
| :--- | :--- | :--- |
| `npm run build` | `tsc` | Compile TypeScript → `dist/` |
| `npm run dev` | `tsx src/server.ts` | Run MCP server (dev mode, no build needed) |
| `npm run dev:http` | `tsx src/http-api.ts` | Run HTTP API server (dev mode) |
| `npm start` | `node dist/server.js` | Run compiled MCP server |
| `npm run start:http` | `node dist/http-api.js` | Run compiled HTTP API |
| `npm test` | `vitest run` | Run 39 automated tests |
| `npm run typecheck` | `tsc --noEmit` | TypeScript type check only |
| `npm run test:plugin` | `tsx scripts/test-plugin.ts` | MCPHub plugin conformance test |
| `npm run quick-test` | `tsx scripts/quick-test.ts` | Manual CLI runner test |

---

## 🔒 Security Notes

- API keys are read from environment variables only — never hardcoded
- The HTTP API requires a Bearer token (`SMARTRELAY_HTTP_API_KEY`)
- The MCP stdio server is local-only (no network exposure)
- No `process.exit()` calls — uses `process.exitCode` for safe shutdown

---

## 📄 License

MIT — See [LICENSE](./LICENSE)
