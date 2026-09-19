# Clarity — Autonomous Local AI Developer Agent & Sandboxed Runtime

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org)
[![Provider: Gemini & OpenAI](https://img.shields.io/badge/AI%20Providers-Gemini%20%7C%20OpenAI%20(ChatGPT)-blue)](https://openai.com)
[![Open Source: Codex for OSS](https://img.shields.io/badge/Open%20Source-Codex%20Fund%20Eligible-orange)](https://openai.com/form/codex-for-oss)
[![Tests: 13/13 Passing](https://img.shields.io/badge/Tests-13%2F13%20Passing-success)](https://nodejs.org/api/test.html)

> **Autonomous, privacy-first local developer agent** capable of full Linux compute sandbox control, autonomous iterative reasoning, tool calling, package management, web automation, and multi-model orchestration with **Google Gemini** and **OpenAI (ChatGPT/Codex/GPT-4o)**.

---

## 🌟 Executive Summary

**Clarity** is an open-source autonomous agent harness and sandboxed runtime engineered to empower software maintainers, developers, and researchers with an untethered, local-first coding assistant. Unlike cloud-locked agents or brittle wrapper wrappers, Clarity gives the AI direct, deterministic access to an isolated Linux sandbox environment where it can:

- 💻 Execute shell scripts and bash commands in real time.
- 🐍 Write, debug, and execute Python scripts directly, dynamically installing dependencies with `pip` when needed.
- 🌐 Scrape, crawl, and automate websites (via headless browser automation, Selenium, or Playwright).
- 📁 Perform high-precision file I/O operations (read, write, surgical diff/patch, tree exploration, and compression).
- 🛡️ Enforce human-in-the-loop oversight through a strict **Approval Gate** exclusively for destructive actions (file deletion).
- 🤖 Seamlessly switch between **OpenAI (GPT-4o, o3-mini, o1, ChatGPT)** and **Google Gemini (Gemini 3.7 Flash, 3.1 Pro)**.

---

## 🚀 Why Clarity Qualifies for OpenAI Codex for Open Source Grant

OpenAI's **Codex for Open Source** program supports critical developer tooling, maintainer workflows, and code-synthesis automation. Clarity aligns with every key criterion evaluated by the grant committee:

1. **Maintainer Automation**: Runs autonomous test-repair loops, automated refactoring, continuous PR verification, and repository triage directly in the local sandbox.
2. **Autonomous Tooling Architecture**: Built-in tool calling engine (`execute_bash`, `execute_python`, `file_patch`, `safe_calc`, `zip_creator`) formatted with standard schema conventions.
3. **Multi-Model Interoperability**: First-class support for OpenAI's `gpt-4o`, `o3-mini`, `o1`, and Codex series via official streaming completions alongside Google Gemini.
4. **Deterministic Sandbox Isolation**: Safe path resolution, process timeout safety, and zero-telemetry client-side key storage protect project data and host systems.
5. **Open Source & Extensible**: Distributed under the permissive **MIT License**, welcoming contributions from the global developer ecosystem.

---

## 🛠️ Core Capabilities & Architecture

```
┌───────────────────────────────────────────────────────────┐
│                    Clarity User Interface                 │
│      (Interactive Web UI / Mobile-Optimized Workspace)     │
└───────────────┬───────────────────────────▲───────────────┘
                │                           │
                ▼                           │ SSE Stream & Trace
┌───────────────────────────────────────────┴───────────────┐
│                   Clarity Server Engine                   │
│        (Node.js 18+ Standalone HTTP / Agent Daemon)        │
├───────────────────────────────────────────────────────────┤
│ • Model Discovery Engine (OpenAI & Gemini APIs)           │
│ • Think Tag & CoT Reasoning Filter (<think> parser)       │
│ • Human Approval Gate (Guarded Deletions)                 │
└───────────────┬───────────────────────────┬───────────────┘
                │                           │
                ▼                           ▼
┌──────────────────────────────┐  ┌─────────────────────────┐
│       AI Model Providers     │  │   Local Sandbox Tools   │
├──────────────────────────────┤  ├─────────────────────────┤
│ • OpenAI: gpt-4o, o3-mini    │  │ • execute_bash          │
│ • Gemini: 3.7 Flash, 3.1 Pro │  │ • execute_python        │
│ • Custom Endpoints & Models  │  │ • file_writer / reader  │
│                              │  │ • file_patch (diffs)    │
│                              │  │ • browser_navigate      │
│                              │  │ • web_search            │
│                              │  │ • zip_package           │
└──────────────────────────────┘  └─────────────────────────┘
```

### 1. Autonomous Loop with Session Memory
Clarity runs iterative autonomous multi-turn loops. When a task requires multiple commands, scripts, and checks, the agent iterates without stopping prematurely, passing tool results and history until it verifies the task is 100% complete (`[TASK_COMPLETE]`).

### 2. Multi-Provider LLM Integration
- **OpenAI (ChatGPT / GPT-4o / o3-mini)**: Native chat completions with full streaming, dynamic model discovery, and reasoning tracking.
- **Google Gemini (Gemini 3.7 Flash / 3.1 / 2.5)**: Native generateContent streaming with system instruction constraints.
- **Independent Credential Storage**: Secure client-side `localStorage` isolation guarantees keys for different providers are never mixed or overwritten.

### 3. Integrated Tool Suite

| Tool Name | Action | Security Profile |
| :--- | :--- | :--- |
| `execute_bash` | Run shell and system commands in sandbox | Autonomous (Sandbox Isolated) |
| `execute_python` | Run Python scripts with dynamic `pip` dependency resolution | Autonomous (Sandbox Isolated) |
| `file_write` / `file_writer` | Create and write new files | Autonomous |
| `file_read` / `file_reader` | Inspect and read file contents | Autonomous |
| `file_patch` / `file_patcher` | Precision search-and-replace text modifications | Autonomous |
| `file_tree` | Recursively index and map the workspace directory | Autonomous |
| `file_delete` | Remove files or directories | 🛡️ **Human Approval Required** |
| `browser_navigate` / `browser_use` | Headless page scraping and HTTP inspection | Autonomous |
| `web_search` | Real-time web query and duckduckgo search | Autonomous |
| `zip_package` / `zip_creator` | Create standard PKzip archives for download | Autonomous |
| `safe_calc` | Safe algebraic and arithmetic parser | Autonomous |

---

## ⚡ Quick Start

### Prerequisites
- Node.js version 18.0.0 or higher
- Optional: Python 3.8+ (for local Python tool execution)

### 1. Clone & Install
```bash
git clone https://github.com/malik-saab-c/clarity-gemini.git
cd clarity-gemini
npm install
```

### 2. Launch the Application
```bash
npm start
```
Open **http://localhost:3000** in your browser.

### 3. Configure Your Model of Choice
1. Click the **Settings (⚙)** icon in the navigation bar.
2. Select your provider:
   - **Google Gemini** (Gemini 3.7 Flash, Gemini 3.1 Pro)
   - **OpenAI** (GPT-4,5,6-astra, GPT-4o-mini, o3-mini, o1)
3. Enter your API Key (`sk-...` for OpenAI or Gemini API Key).
4. Click **Discover Models** to automatically load available models from your account, then click **Save**.

### 📱 Android (Termux) Deployment
Run full autonomous AI developer workflows on mobile hardware:
```bash
pkg update -y && pkg install nodejs python git -y
git clone https://github.com/malik-saab-c/clarity-gemini.git
cd clarity-gemini
npm install
node server.js
```
Open your mobile browser to `http://localhost:3000`.

---

## 🧪 Testing & Code Quality

Clarity adheres to strict zero-error standards:

```bash
# Run the complete test suite
npm test

# Run syntax and linter checks
npm run lint
```

**Test Coverage Highlights (13/13 Passing):**
- Safe arithmetic parser evaluation and injection attack prevention.
- PKzip binary header verification (magic byte validation).
- File path traversal and escape guards (`../` prevention).
- Model and provider registry verification (Gemini & OpenAI).
- Real-time `<think>` tag and chain-of-thought extraction.
- Human approval queue, token generation, and state lifecycle.
- Local sandbox tool execution across files and processes.

---

## 🛡️ Security & Privacy Architecture

- **Zero Third-Party Telemetry**: Conversations, keys, and file contents stay within your machine's process boundary.
- **Local Key Storage**: API tokens remain encrypted in the client browser's `localStorage` and are sent only to the respective provider's official endpoints.
- **Sandboxed File Operations**: All file manipulations are bound to the current application workspace (`/workspace`), preventing directory traversal attacks.
- **Human Gate Defense**: Deletions cannot be performed unilaterally by the model—every delete tool call creates a blocking confirmation card requiring explicit human approval.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details. You are free to use, modify, distribute, and integrate Clarity in commercial, academic, and open-source applications.

---

## 🤝 Contributing

Contributions, bug reports, and feature proposals are warmly welcome!
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.
