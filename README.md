# Clarity — Autonomous Standalone Gemini AI Agent

> **Built for the Devpost "All Things Agentic" Hackathon**  
> An autonomous, private, standalone AI agent running 100% locally on your PC, Mac, Linux, or Android device (Termux) with Google Gemini AI.

---

## 🌟 Overview

**Clarity** is an autonomous agent harness engineered to run entirely on the user's local machine without third-party proxy lock-in (no ngrok, no cloud agent middleman, no TrueForge). Clarity connects directly to Google Gemini models (`gemini-3.7-flash`, `gemini-2.5-flash`, etc.) and executes real local tools silently and safely on your device.

### 🏆 Hackathon Highlights
- **100% Local Tool Execution**: Silent, on-device bash, Python, file I/O, and workspace manipulation with zero external dependencies.
- **Interactive Closeable Tool Frames**: Every tool call is announced with real-time progress and renders in a collapsible frame displaying the input parameters and execution outputs.
- **Non-Stop Autonomous Loop**: The agent automatically continues multi-step work without stopping after tool use, passing full conversation history until the task is verified complete or user clarification is needed.
- **1-Time Human Approval Gate**: Deleting files or content requires explicit human confirmation; all other tools (read, write, bash, python, search, browse, zip) execute autonomously.
- **One-Command Setup**: Run seamlessly on desktop or Android mobile Termux in 1–2 commands.

---

## 📱 Quick Start (PC / Mac / Linux / Mobile Termux)

### On PC / Mac / Linux:
```bash
# 1. Install dependencies
npm install

# 2. Launch Clarity (runs on port 3000)
npm start
```
Open **http://localhost:3000** in your browser.

### On Android Mobile (Termux):
```bash
pkg update && pkg install nodejs python git -y
git clone <repo-url> && cd clarity
npm install
node server.js
```
Open your mobile browser to **http://localhost:3000**.

---

## 🛠️ Standalone Tool Suite

Clarity provides a full suite of local tools exposed via `/execute` and discovery at `/tools`:

| Tool | Purpose | Permissions |
| :--- | :--- | :--- |
| `execute_bash` | Run shell commands in workspace | Autonomous |
| `execute_python` | Execute Python scripts locally on device | Autonomous |
| `file_write` | Create or write files to workspace disk | Autonomous |
| `file_read` | Read contents of workspace files | Autonomous |
| `file_patch` | Surgical find & replace inside files | Autonomous |
| `file_tree` | Recursively list workspace directory | Autonomous |
| `file_delete` | Delete workspace files or directories | **Human Approval Required** |
| `web_search` | Search internet for real-time information | Autonomous |
| `browser_navigate` | Scrape and browse URLs locally | Autonomous |
| `zip_package` | Package workspace into downloadable archive | Autonomous |
| `generate_image` | Generate vector and SVG graphics | Autonomous |

---

## 🛡️ Safety & Approval Architecture

- **Approval Gate**: Only destructive file/content deletions require human approval.
- **Autonomous Execution**: Reading, writing, calculations, scripts, and network searches proceed without stalling.
- **Session Continuity**: Multi-turn history is preserved with full context across autonomous cycles.

---

## 🧪 Testing & Verification

Run the comprehensive unit test suite:
```bash
npm test
```
All 13/13 tests pass covering safe arithmetic, zip generation, path security, think parsing, approval gates, and local tool execution.

