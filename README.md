# ⚡ SmartRelay

> **The intelligent delegation layer & zero-token task server for AI agents.**

[![MCP Standard](https://img.shields.io/badge/MCP-Standard-blue.svg)](https://modelcontextprotocol.io)
[![Context](https://img.shields.io/badge/Context-Zero--Token-green.svg)](#-1-click-dedicated-tools)
[![Fleet](https://img.shields.io/badge/Fleet-NVIDIA%20%7C%20Claude%20%7C%20Ollama%20%7C%20OpenAI-orange.svg)](#-natural-language-model-switching)
[![Tests](https://img.shields.io/badge/Tests-33%20Passing-brightgreen.svg)](#-testing--verification)

**SmartRelay** is a high-performance Model Context Protocol (MCP) server built with Python and the official `mcp` SDK. It transforms **Claude Code** and other agentic IDEs into a **Master Orchestrator**—delegating heavy tasks (code reviews, test generation, explanations, architecture planning) to specialized sub-agents (NVIDIA NIM, Claude Sonnet 4.5, GPT-4o, local Ollama) with **zero context-window bloat** and concurrent multi-model benchmarking.

---

## ⚡ Natural Language Model Switching (Plain English!)

You can switch models on the fly during your Claude Code session just by typing plain English sentences. No code syntax required!

| What to say to Claude Code | What Happens |
| :--- | :--- |
| **`Switch to nvidia`** | Routes all subsequent code & questions to **NVIDIA NIM** (`nemotron-3-super-120b-a12b`). |
| **`Switch to claude`** | Routes all subsequent tasks to **Claude Sonnet 4.5** via OpenRouter. |
| **`Switch to ollama`** (or **`Switch to local`**) | Routes all tasks to local offline **Qwen 2.5 Coder** (100% Free, $0.00). |
| **`Switch to auto`** | Restores smart routing (reviews ➔ code reviewer, plans ➔ planner). |
| **`Switch to direct`** | Tells Claude Code to answer directly with its native intelligence. |
| **`What model is active?`** | Calls `get_active_model` to display the currently active runner. |

---

## 🛠️ 1-Click Dedicated Tools

| Tool | Plain English Prompt | What It Does |
| :--- | :--- | :--- |
| **`review_file`** ⭐ | *"Call tool `review_file` with file_path='lib/login.dart'"* | **TRUE zero-token**: Server reads file directly from disk and returns 🛡️ Code Review Report. |
| **`test_file`** ⭐ | *"Call tool `test_file` with file_path='lib/auth.dart'"* | **TRUE zero-token**: Server reads file directly from disk and generates tests. |
| **`explain_file`** ⭐ | *"Call tool `explain_file` with file_path='lib/router.dart'"* | **TRUE zero-token**: Server reads file and returns 📖 plain-English explanation — purpose, logic, patterns, gotchas. |
| **`create_plan`** | *"Call tool `create_plan` for 'offline caching'"* | Generates phased architecture implementation plan. |
| **`review_code`** | *"Call tool `review_code` on this code"* | Code review on code passed directly. |
| **`generate_tests`** | *"Call tool `generate_tests` on this code"* | Generates unit & integration tests for code passed directly. |
| **`explain_code`** | *"Call tool `explain_code` with code='...' and audience='junior'"* | Plain-English explanation: purpose, logic, patterns, non-obvious behaviors. Any language. |
| **`ask_subagent`** | *"Call tool `ask_subagent` with prompt='...' and model='nvidia'"* | Offloads question/coding to any sub-agent model. |
| **`benchmark_run`** | *"Claude, benchmark writing an LRU cache across nvidia and claude."* | Multi-model concurrent comparison. |

---

## 📋 Copy-Paste Commands for Claude Code

Just copy and paste these into your Claude Code terminal:

### ⭐ Zero-Token File Explanation (`explain_file`)
```text
Call tool explain_file with file_path='lib/services/auth_service.dart'
```

### ⭐ Zero-Token File Explanation (For Junior / Senior Audience)
```text
Call tool explain_file with file_path='lib/blocs/cart_bloc.dart' and audience='junior'
```
```text
Call tool explain_file with file_path='lib/blocs/cart_bloc.dart' and audience='senior'
```

### 💡 Code Snippet Explanation (`explain_code`)
Explain raw code or copied functions directly without needing a file on disk:
```text
Call tool explain_code with code='Future<void> sync() async { ... }' and audience='mid-level'
```
```text
Call tool explain_code with code='type UserState = { status: "idle" | "loading" };' and language='typescript' and audience='junior'
```

> **Supported Audiences**:
> - `junior`: Explains all patterns, terminology, and framework concepts in detail.
> - `mid-level` (default): Focuses on design decisions, data flow, and non-obvious behaviors.
> - `senior`: Terse technical overview covering architecture, complexity, and tradeoffs.
> - `non-technical`: Plain-English analogies without code references.

### ⭐ Zero-Token File Review (Generates 🛡️ Health Score Report!)
```text
Call tool review_file with file_path='lib/screens/login_screen.dart'
```

### ⭐ Zero-Token Test Generation
```text
Call tool test_file with file_path='lib/services/auth_service.dart'
```

### 📐 Architecture Planning
```text
Call tool create_plan for 'Offline SQLite caching in Flutter'
```

### Ask NVIDIA Model Directly
```text
Call tool ask_subagent with prompt='Write a Flutter Riverpod StateNotifier for cart' and model='nvidia'
```

### Ask Local Free Model ($0)
```text
Call tool ask_subagent with prompt='Explain Dart Streams' and model='ollama'
```

### Multi-Model Benchmark
```text
Call tool benchmark_run with task='Write an LRU Cache in Dart' and runner_ids=['nemotron-3-super-120b-a12b', 'openrouter-claude-sonnet-4.5']
```

---

## 🌐 Supported Backends & Models

- **NVIDIA NIM & API Catalog** (`build.nvidia.com`): Nemotron 3 Super 120B, Llama 3.3 70B, Qwen Coder (`NVIDIA_API_KEY`)
- **OpenRouter Cloud**: Claude Sonnet 4.5, DeepSeek V3 (`OPENROUTER_API_KEY`)
- **Anthropic Direct API**: Claude 3.7 Sonnet, Claude 3.5 Haiku (`ANTHROPIC_API_KEY`)
- **OpenAI Direct API**: GPT-4o, GPT-4o-mini (`OPENAI_API_KEY`)
- **Local Ollama**: Qwen 2.5 Coder, Llama 3.2, DeepSeek-R1 (100% Free & Offline)

---

## 📁 Modular Configuration Structure

Configurations and system prompts are cleanly isolated into dedicated files:

```text
SmartRelay/
├── config.yaml               ← Main server entrypoint (uses includes:)
├── config/
│   └── runners/
│       ├── agents.yaml       ← Specialized agents (code-review, planner, test-generator, explain-agent)
│       ├── nvidia.yaml       ← NVIDIA NIM models
│       ├── openrouter.yaml   ← OpenRouter Cloud models
│       ├── ollama.yaml       ← Local offline Ollama models
│       ├── anthropic.yaml    ← Anthropic Direct API models
│       └── openai.yaml       ← OpenAI Direct API models
└── prompts/
    ├── code_review.md        ← Code review prompt & Flutter verification vectors
    ├── explain_code.md       ← Code explanation & knowledge transfer prompt
    ├── planner.md            ← Architecture & planning prompt
    └── test_generator.md     ← QA & test generation prompt
```

---

## 🚀 Quick Setup Guide

### 1. Clone & Install Dependencies
```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/SmartRelay.git
cd SmartRelay

# 2. Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install in editable mode
pip install -e ".[dev]"
```

### 2. Configure Environment Variables (`.env`)
Copy the example environment file and add your API keys:
```bash
cp .env.example .env
```
Edit `.env`:
```bash
OPENROUTER_API_KEY=sk-or-v1-...
NVIDIA_API_KEY=nvapi-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

### 3. Connect to Your AI Client

SmartRelay adheres to the official **Model Context Protocol (MCP)** standard over `stdio`, meaning it works with any MCP-compatible agent or IDE.

#### 🟣 Claude Code (CLI)
Run this command from inside the `SmartRelay` project root directory:
```bash
claude mcp add smartrelay -- $(pwd)/.venv/bin/python -m mcp_delegation_server.server --config $(pwd)/config.yaml
```
- Verify: `claude mcp list`
- Remove: `claude mcp remove smartrelay`

#### 🔵 Cursor IDE
1. Go to **Settings** ➔ **Features** ➔ **MCP**
2. Click **+ Add New MCP Server**
3. Set:
   - **Name**: `smartrelay`
   - **Type**: `command`
   - **Command**: `/ABSOLUTE/PATH/TO/SmartRelay/.venv/bin/smartrelay --config /ABSOLUTE/PATH/TO/SmartRelay/config.yaml`

#### 🌊 Windsurf / Codeium
Add the following to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "smartrelay": {
      "command": "/ABSOLUTE/PATH/TO/SmartRelay/.venv/bin/smartrelay",
      "args": ["--config", "/ABSOLUTE/PATH/TO/SmartRelay/config.yaml"]
    }
  }
}
```

#### 🟠 Claude Desktop
Add to your `claude_desktop_config.json` (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):
```json
{
  "mcpServers": {
    "smartrelay": {
      "command": "/ABSOLUTE/PATH/TO/SmartRelay/.venv/bin/smartrelay",
      "args": [
        "--config",
        "/ABSOLUTE/PATH/TO/SmartRelay/config.yaml"
      ]
    }
  }
}
```

#### 🟢 VS Code (Cline / Roo Code)
In your Cline MCP settings (`cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "smartrelay": {
      "command": "/ABSOLUTE/PATH/TO/SmartRelay/.venv/bin/smartrelay",
      "args": ["--config", "/ABSOLUTE/PATH/TO/SmartRelay/config.yaml"]
    }
  }
}
```

---

## 🧪 Testing & Verification

Run the full automated test suite (33 unit and integration tests):
```bash
.venv/bin/pytest -v
```

Quick manual test via CLI:
```bash
# Test NVIDIA model
.venv/bin/python scripts/quick_test.py "Say hello" --runner nemotron-3-super-120b-a12b

# Test Explainer Agent
.venv/bin/python scripts/quick_test.py "Explain how a BLoC state stream works in Dart" --runner explain-agent

# Test Planner Agent
.venv/bin/python scripts/quick_test.py "Plan a biometric auth flow in Flutter" --runner planner-agent

# List all active runners
.venv/bin/python scripts/quick_test.py --list
```

---

## 🌐 Web UI — MCP Inspector (Browse & Test Tools in Browser)

You can visually browse, test, and interact with all MCP tools directly in your browser using the official **MCP Inspector**.

### Launch the Web UI
```bash
npx -y @modelcontextprotocol/inspector .venv/bin/smartrelay --config config.yaml
```

This will open the MCP Inspector at **http://localhost:6274** in your browser automatically.

### How to Use
1. Click **"Connect"** to connect to the MCP server
2. Click the **"Tools"** tab to see all 11 registered tools
3. Click any tool (e.g. `review_file`, `explain_code`, `benchmark_run`) to open its interactive form
4. Fill in the parameters and click **"Run Tool"** to execute it live
5. View the structured response directly in the browser

### Available Tabs
| Tab | What's Inside |
| :--- | :--- |
| **Tools** | All 11 tools with interactive parameter forms — fill & run instantly |
| **Resources** | Any resources the server exposes |
| **Prompts** | Prompt templates registered by the server |

> **Tip**: This is the fastest way to verify your tools are working, test different parameters, and debug responses without needing Claude Code.

