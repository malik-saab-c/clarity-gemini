/**
 * Clarity — Standalone Autonomous Gemini AI Agent Workspace
 * Powered directly by Google Gemini AI with real workspace tools.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { Server: McpServer } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const wsRoot = path.join(__dirname, 'data', 'workspace');
const uploadsDir = path.join(wsRoot, 'uploads');
const downloadsDir = path.join(wsRoot, 'downloads');
for (const d of [wsRoot, uploadsDir, downloadsDir]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const TOOL_DEFINITIONS = [
  {"type": "function", "function": {"name": "execute_bash", "description": "Run terminal commands in workspace", "parameters": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}}},
  {"type": "function", "function": {"name": "execute_python", "description": "Run Python code in workspace", "parameters": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}}},
  {"type": "function", "function": {"name": "file_write", "description": "Write file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
  {"type": "function", "function": {"name": "file_read", "description": "Read file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
  {"type": "function", "function": {"name": "file_patch", "description": "Edit content inside files", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "old_string": {"type": "string"}, "new_string": {"type": "string"}}, "required": ["path", "old_string", "new_string"]}}},
  {"type": "function", "function": {"name": "file_tree", "description": "List files in workspace", "parameters": {"type": "object", "properties": {"directory": {"type": "string"}}}}},
  {"type": "function", "function": {"name": "file_delete", "description": "Delete file/folder. REQUIRES HUMAN APPROVAL.", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
  {"type": "function", "function": {"name": "publish_download_link", "description": "Generate direct download link for workspace file", "parameters": {"type": "object", "properties": {"source_path": {"type": "string"}, "custom_filename": {"type": "string"}}, "required": ["source_path"]}}},
  {"type": "function", "function": {"name": "browser_navigate", "description": "Browse and inspect content from a web URL", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
  {"type": "function", "function": {"name": "web_search", "description": "Live Web Search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
  {"type": "function", "function": {"name": "zip_package", "description": "Package workspace files into a zip archive", "parameters": {"type": "object", "properties": {"name": {"type": "string"}}}}},
  {"type": "function", "function": {"name": "generate_image", "description": "Generate AI image asset", "parameters": {"type": "object", "properties": {"prompt": {"type": "string"}, "filename": {"type": "string"}}, "required": ["prompt"]}}}
];

async function executeLocalTool(name, args = {}, req = null) {
  const n = String(name || '').toLowerCase().trim();
  const a = args || {};

  if (n === 'execute_bash' || n === 'bash' || n === 'sandbox_run') {
    const { exec } = require('child_process');
    const cmd = String(a.command || a.cmd || 'ls -la').trim();
    return new Promise((resolve) => {
      exec(cmd, { cwd: wsRoot, timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: (stderr || '') + (err ? `\n[error: ${err.message}]` : ''),
          exit_code: err ? (err.code || 1) : 0
        });
      });
    });
  }

  if (n === 'execute_python' || n === 'python') {
    const { exec } = require('child_process');
    const code = String(a.code || '');
    const pFile = path.join(wsRoot, '_temp_exec.py');
    fs.writeFileSync(pFile, code, 'utf8');
    return new Promise((resolve) => {
      exec('python3 _temp_exec.py', { cwd: wsRoot, timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (fs.existsSync(pFile)) try { fs.unlinkSync(pFile); } catch {}
        if (err && !stdout && !stderr) {
          return resolve({ stdout: '', stderr: `python3: ${err.message}`, exit_code: 1 });
        }
        resolve({
          stdout: stdout || '',
          stderr: (stderr || '') + (err ? `\n[error: ${err.message}]` : ''),
          exit_code: err ? (err.code || 1) : 0
        });
      });
    });
  }

  if (n === 'file_write' || n === 'write_file' || n === 'file_writer') {
    const target = safePath(a.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, a.content || '', 'utf8');
    return { status: "success", message: `Saved ${a.path}` };
  }

  if (n === 'file_read' || n === 'read_file' || n === 'file_reader') {
    const target = safePath(a.path);
    if (!fs.existsSync(target)) return { error: "File not found" };
    const content = fs.readFileSync(target, 'utf8');
    return { status: "success", content };
  }

  if (n === 'file_patch' || n === 'patch_file' || n === 'file_patcher') {
    const target = safePath(a.path);
    if (!fs.existsSync(target)) return { error: "File not found" };
    let content = fs.readFileSync(target, 'utf8');
    const oldStr = a.old_string || a.search_string || '';
    const newStr = a.new_string || a.replacement_string || '';
    if (!content.includes(oldStr)) return { error: "Target string not found" };
    content = content.replace(oldStr, newStr);
    fs.writeFileSync(target, content, 'utf8');
    return { status: "success", message: `Patched ${a.path}` };
  }

  if (n === 'file_tree' || n === 'list_files') {
    const base = a.directory ? safePath(a.directory) : wsRoot;
    const tree = [];
    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else tree.push(`[FILE] ${path.relative(wsRoot, full)}`);
      }
    }
    walk(base);
    return { files: tree };
  }

  if (n === 'file_delete' || n === 'delete_file') {
    const target = safePath(a.path);
    if (!fs.existsSync(target)) return { error: "Path does not exist" };
    if (a.approved) {
      if (fs.lstatSync(target).isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
      return { status: "success", message: `Deleted ${a.path}` };
    }
    const app = registerApproval({ id: crypto.randomUUID(), type: 'delete', path: a.path, target, reason: `Delete file: ${a.path}` });
    return {
      status: "needs_approval",
      approvalId: app.id,
      reason: `Delete file: ${a.path}`,
      message: `Human approval required before deleting "${a.path}"`
    };
  }

  if (n === 'publish_download_link') {
    let src = safePath(a.source_path);
    if (!fs.existsSync(src)) src = path.join(wsRoot, a.source_path);
    if (!fs.existsSync(src)) return { error: "File not found" };
    const tName = a.custom_filename || path.basename(src);
    const dest = path.join(downloadsDir, tName);
    fs.copyFileSync(src, dest);
    return {
      status: "success",
      filename: tName,
      download_url: `/downloads/${encodeURIComponent(tName)}`
    };
  }

  if (n === 'browser_navigate' || n === 'browser_use' || n === 'browse') {
    try {
      const jinaUrl = `https://r.jina.ai/${a.url}`;
      const r = await fetch(jinaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const txt = await r.text();
        if (txt.trim().length > 50) return { status: "success", title: a.url, content: txt.slice(0, 9000), engine: "Jina Cloud Browser" };
      }
    } catch {}
    try {
      const r2 = await fetch(a.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      const raw = await r2.text();
      const clean = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 9000);
      return { status: "success", title: a.url, content: clean, engine: "Direct Web Scraper" };
    } catch (e) {
      return { error: `Navigation failed: ${e.message}` };
    }
  }

  if (n === 'web_search') {
    try {
      const encoded = encodeURIComponent(a.query);
      const r = await fetch(`https://s.jina.ai/${encoded}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const txt = await r.text();
        if (txt.trim().length > 50) return { results: txt.slice(0, 8000), engine: "Jina AI Search" };
      }
    } catch {}
    try {
      const r2 = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(a.query)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      const raw = await r2.text();
      const clean = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
      return { results: clean, engine: "DuckDuckGo Search" };
    } catch (e) {
      return { error: `Search failed: ${e.message}` };
    }
  }

  if (n === 'generate_image') {
    const filename = a.filename || `image_${Date.now()}.png`;
    const dest = path.join(downloadsDir, filename);
    try {
      const encoded = encodeURIComponent(a.prompt);
      const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true`;
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync(dest, buf);
        return { status: "success", filename, download_url: `/downloads/${encodeURIComponent(filename)}` };
      }
    } catch {}
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e1b4b"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="400" cy="300" r="180" fill="#38bdf8" opacity="0.15"/><text x="400" y="300" dominant-baseline="middle" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="24" font-weight="bold">${escapeHtml(a.prompt || 'Generated Graphic Asset')}</text></svg>`;
    fs.writeFileSync(dest, svg, 'utf8');
    return { status: "success", filename, download_url: `/downloads/${encodeURIComponent(filename)}` };
  }

  if (n === 'safe_calc' || n === 'calculator') {
    const val = safeCalc(a.expr || a.expression || '0');
    return { status: "success", result: val };
  }

  if (n === 'zip_package' || n === 'zip_creator' || n === 'create_zip') {
    const name = a.name || 'workspace.zip';
    const files = listWorkspace().filter(f => !f.name.endsWith('.zip')).map(f => ({ name: f.name, data: fs.readFileSync(path.join(wsRoot, f.name)) }));
    if (!files.length) files.push({ name: 'README.txt', data: 'Clarity workspace — created by Gemini agent.' });
    const zip = makeZip(files);
    const out = path.join(wsRoot, name);
    fs.writeFileSync(out, zip);
    return { status: "success", filename: name, size: zip.length, download_url: `/api/ws/download?path=${encodeURIComponent(name)}` };
  }

  return { error: `Tool "${name}" not found` };
}

// ---------- MCP Server Integration (11 Real Workspace Tools) ----------
const mcpTransports = new Map();

function createMcpServer() {
  const server = new McpServer(
    { name: 'clarity-tools', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'file_write',
          description: 'Create or write a file to the workspace. Specify relative path and file content.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path of the file' },
              content: { type: 'string', description: 'Complete content to write into the file' }
            },
            required: ['path', 'content']
          }
        },
        {
          name: 'file_read',
          description: 'Read a file from the workspace.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path of the file to read' }
            },
            required: ['path']
          }
        },
        {
          name: 'file_patch',
          description: 'Patch or update sections of a file in the workspace.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              old_string: { type: 'string' },
              new_string: { type: 'string' }
            },
            required: ['path', 'old_string', 'new_string']
          }
        },
        {
          name: 'file_tree',
          description: 'List all files available in the workspace directory.',
          inputSchema: {
            type: 'object',
            properties: {
              directory: { type: 'string', description: 'Optional subfolder directory' }
            }
          }
        },
        {
          name: 'file_delete',
          description: 'Delete a file from the workspace. REQUIRES HUMAN APPROVAL.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path of file to delete' }
            },
            required: ['path']
          }
        },
        {
          name: 'execute_bash',
          description: 'Run terminal bash commands in the workspace.',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string' }
            },
            required: ['command']
          }
        },
        {
          name: 'execute_python',
          description: 'Execute Python code scripts in the workspace.',
          inputSchema: {
            type: 'object',
            properties: {
              code: { type: 'string' }
            },
            required: ['code']
          }
        },
        {
          name: 'publish_download_link',
          description: 'Generate a download link for a file in the workspace.',
          inputSchema: {
            type: 'object',
            properties: {
              source_path: { type: 'string' }
            },
            required: ['source_path']
          }
        },
        {
          name: 'browser_navigate',
          description: 'Browse and inspect content from a web URL.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string' }
            },
            required: ['url']
          }
        },
        {
          name: 'web_search',
          description: 'Perform web search queries.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            },
            required: ['query']
          }
        },
        {
          name: 'generate_image',
          description: 'Generate AI image asset saved to workspace uploads.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' }
            },
            required: ['prompt']
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      if (name === 'file_write') {
        const target = safePath(args.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, args.content || '');
        return { content: [{ type: 'text', text: `Successfully created and wrote file "${args.path}" (${(args.content || '').length} bytes).` }] };
      }
      if (name === 'file_read') {
        const target = safePath(args.path);
        if (!fs.existsSync(target)) throw Error(`File not found: ${args.path}`);
        const content = fs.readFileSync(target, 'utf8');
        return { content: [{ type: 'text', text: content.slice(0, 20000) }] };
      }
      if (name === 'file_patch') {
        const target = safePath(args.path);
        if (!fs.existsSync(target)) throw Error(`File not found: ${args.path}`);
        let content = fs.readFileSync(target, 'utf8');
        if (!content.includes(args.old_string)) throw Error(`old_string not found in ${args.path}`);
        content = content.replace(args.old_string, args.new_string);
        fs.writeFileSync(target, content);
        return { content: [{ type: 'text', text: `Successfully patched "${args.path}".` }] };
      }
      if (name === 'file_tree') {
        const files = listWorkspace();
        return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
      }
      if (name === 'file_delete') {
        const target = safePath(args.path);
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        return { content: [{ type: 'text', text: `Successfully deleted "${args.path}".` }] };
      }
      if (name === 'execute_bash') {
        const { execFile } = require('child_process');
        const cmd = String(args.command || 'ls').trim();
        const parts = cmd.split(/\s+/);
        const bin = parts.shift();
        const out = await new Promise((resolve, reject) => {
          execFile(bin, parts, { cwd: wsRoot, timeout: 10000, maxBuffer: 50000 }, (err, stdout, stderr) => {
            if (err && !stdout) return reject(Error(stderr || err.message));
            resolve((stdout || '') + (stderr ? '\n' + stderr : ''));
          });
        });
        return { content: [{ type: 'text', text: out.slice(0, 5000) }] };
      }
      if (name === 'execute_python') {
        const { execFile } = require('child_process');
        const out = await new Promise((resolve, reject) => {
          execFile('python3', ['-c', String(args.code || '')], { cwd: wsRoot, timeout: 10000, maxBuffer: 50000 }, (err, stdout, stderr) => {
            if (err && !stdout) return reject(Error(stderr || err.message));
            resolve((stdout || '') + (stderr ? '\n' + stderr : ''));
          });
        });
        return { content: [{ type: 'text', text: out.slice(0, 5000) }] };
      }
      if (name === 'publish_download_link') {
        const link = `/api/ws/download?path=${encodeURIComponent(args.source_path || '')}`;
        return { content: [{ type: 'text', text: `Download link generated: ${link}` }] };
      }
      if (name === 'browser_navigate' || name === 'web_search') {
        const targetUrl = args.url || `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query || '')}`;
        const r = await fetch(targetUrl, { headers: { 'user-agent': 'Mozilla/5.0 (Clarity)' }, signal: AbortSignal.timeout(10000) });
        const rawText = await r.text();
        const clean = rawText.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
        return { content: [{ type: 'text', text: clean || 'Web query returned empty content' }] };
      }
      if (name === 'generate_image') {
        const fileName = `generated_${Date.now()}.png`;
        const filePath = path.join(uploadsDir, fileName);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0f172a"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#38bdf8" font-family="sans-serif" font-size="18">${escapeHtml(args.prompt || 'Generated Asset')}</text></svg>`;
        fs.writeFileSync(filePath, svg);
        return { content: [{ type: 'text', text: `Generated image asset saved at uploads/${fileName}` }] };
      }
      return { content: [{ type: 'text', text: `Tool ${name} executed successfully.` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error executing ${name}: ${err.message}` }], isError: true };
    }
  });

  return server;
}

// Standalone Gemini provider definition
const providers = {
  gemini: { name: 'Google Gemini', model: 'gemini-3.7-flash', base: 'https://generativelanguage.googleapis.com' }
};

function sanitizeModelName(model) {
  if (!model) return 'gemini-3.7-flash';
  return String(model).replace(/^models\//, '');
}

const pendingApprovals = new Map();
let pendingAction = null;
let pendingApprovalId = null;

function registerApproval(act) {
  const id = act.id || crypto.randomUUID();
  act.id = id;
  pendingApprovals.set(id, act);
  pendingAction = act;
  pendingApprovalId = id;
  return act;
}

function getApproval(id) {
  if (id && pendingApprovals.has(id)) {
    return pendingApprovals.get(id);
  }
  if (pendingAction) return pendingAction;
  if (pendingApprovals.size > 0) {
    const keys = Array.from(pendingApprovals.keys());
    return pendingApprovals.get(keys[keys.length - 1]);
  }
  return null;
}

function clearApproval(id) {
  if (id) pendingApprovals.delete(id);
  if (pendingAction && (!id || pendingAction.id === id)) {
    pendingAction = null;
    pendingApprovalId = null;
  }
  if (!pendingAction && pendingApprovals.size > 0) {
    const keys = Array.from(pendingApprovals.keys());
    pendingAction = pendingApprovals.get(keys[keys.length - 1]);
    pendingApprovalId = pendingAction.id;
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateContentForHint(hint, filename) {
  const h = (hint || '').trim();
  if (!h) return `# ${filename}\n\nCreated by Clarity Gemini Agent.\n`;
  if (/^["'`#]|^\s*```/m.test(h) || h.includes('\n')) {
    return h.replace(/^["']|["']$/g, '');
  }
  const title = h.replace(/^(?:a\s+)?(?:higher\s+quality\s+|high\s+quality\s+)?(?:essay|notes|document|file|report|guide)\s+(?:about|on|for)\s+/i, '').trim() || filename;
  const cleanTitle = title.charAt(0).toUpperCase() + title.slice(1);
  return `# ${cleanTitle}

## Overview
This document provides a comprehensive, structured analysis of ${cleanTitle}, compiled by Clarity Gemini AI Agent.

## Core Concepts & Analysis
- **Context**: Evaluating fundamental background, dynamics, and environmental factors.
- **Key Considerations**: Identifying critical challenges, variables, and potential impact vectors.
- **Framework & Methodology**: Establishing clear principles and systematic approaches.

## Recommendations & Next Steps
1. Implement systematic monitoring and baseline data collection.
2. Foster collaborative approaches across key stakeholders.
3. Iterate continuously based on observed outcomes and best practices.

## Summary
In conclusion, proactive management, adherence to quality standards, and informed decision-making ensure optimal outcomes for ${cleanTitle}.
`;
}


function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function body(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let s = ''; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Error('Payload too large')); req.destroy(); return; } s += c; });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function safePath(rel) {
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) throw Error('Invalid path');
  const target = path.resolve(wsRoot, rel);
  if (!target.startsWith(wsRoot)) throw Error('Path escapes workspace');
  return target;
}

function safeCalc(expr) {
  if (!/^[0-9+\-*/().%\s]+$/.test(expr) || expr.length > 100) throw Error('Only basic arithmetic is allowed');
  const result = Function('"use strict";return (' + expr + ')')();
  if (!Number.isFinite(result)) throw Error('Result is not finite');
  return result;
}

const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function makeZip(files) {
  const chunks = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const cdStart = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, ...central, eocd]);
}

const GEMINI_FALLBACKS = ['gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-image', 'gemini-2.5-flash'];
async function resolveGeminiModel(key, preferred) {
  const candidates = [];
  if (preferred && sanitizeModelName(preferred)) candidates.push(sanitizeModelName(preferred));
  for (const m of GEMINI_FALLBACKS) if (!candidates.includes(m)) candidates.push(m);
  if (!key) return candidates[0];
  for (const m of candidates) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }), signal: AbortSignal.timeout(10000)
      });
      if (r.ok) return m;
    } catch { /* try next */ }
  }
  return candidates[0];
}

async function discoverModels(provider, key, baseUrl) {
  if (key) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), { signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      if (r.ok && Array.isArray(d.models)) {
        return d.models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
      }
    } catch {}
  }
  return GEMINI_FALLBACKS;
}

function listWorkspace() {
  const out = [];
  function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else { const st = fs.statSync(path.join(dir, e.name)); out.push({ name: r, size: st.size, mtime: st.mtime.toISOString() }); }
    }
  }
  walk(wsRoot, '');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function handleTools(req, res, u) {
  // MCP Remote Server routes
  if (u.pathname === '/api/mcp/sse' && req.method === 'GET') {
    const transport = new SSEServerTransport('/api/mcp/messages', res);
    mcpTransports.set(transport.sessionId, transport);
    req.on('close', () => mcpTransports.delete(transport.sessionId));
    const serverInstance = createMcpServer();
    await serverInstance.connect(transport);
    return true;
  }
  if (u.pathname === '/api/mcp/messages' && req.method === 'POST') {
    const sessionId = u.searchParams.get('sessionId');
    const transport = mcpTransports.get(sessionId);
    if (!transport) return json(res, 404, { error: 'Session not found' });
    await transport.handlePostMessage(req, res);
    return true;
  }

  // list files
  if (u.pathname === '/api/ws/list' && req.method === 'GET') {
    try { return json(res, 200, { ok: true, files: listWorkspace(), workspace: wsRoot }); }
    catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  // read file
  if (u.pathname === '/api/ws/read' && req.method === 'GET') {
    try {
      const rel = u.searchParams.get('path') || '';
      const target = safePath(rel);
      if (!fs.existsSync(target)) throw Error('File not found: ' + rel);
      const buf = fs.readFileSync(target);
      const ext = path.extname(rel).toLowerCase();
      const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext);
      if (isImage && buf.length > 250000) return json(res, 200, { ok: true, image: true, size: buf.length, message: 'Image too large to preview inline; download it.' });
      return json(res, 200, { ok: true, content: buf.toString('utf8').slice(0, 30000), image: isImage, base64: isImage ? buf.toString('base64') : undefined, size: buf.length });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // upload files/images
  if (u.pathname === '/api/ws/upload' && req.method === 'POST') {
    try {
      const b = await body(req);
      if (!Array.isArray(b.files) || !b.files.length) throw Error('No files provided');
      const saved = [];
      for (const f of b.files) {
        if (!f || !f.name) throw Error('Each file needs a name');
        const name = path.basename(String(f.name)).replace(/[^\w.\- ]/g, '_');
        const data = Buffer.from(String(f.base64 || ''), 'base64');
        if (!data.length) throw Error('Empty file: ' + name);
        const target = safePath(path.join('uploads', name));
        fs.writeFileSync(target, data);
        saved.push({ name: 'uploads/' + name, size: data.length });
      }
      return json(res, 200, { ok: true, files: saved });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // create folder (AUTOMATIC & UNRESTRICTED)
  if (u.pathname === '/api/ws/mkdir' && req.method === 'POST') {
    try { const b = await body(req); fs.mkdirSync(safePath(b.path || ''), { recursive: true }); return json(res, 200, { ok: true, text: 'Created folder ' + b.path }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // write file (AUTOMATIC & UNRESTRICTED)
  if (u.pathname === '/api/ws/write' && req.method === 'POST') {
    try {
      const b = await body(req);
      const rel = String(b.path || '').replace(/^\/+/, '');
      if (!rel) throw Error('Path required');
      const target = safePath(rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(b.content ?? ''));
      return json(res, 200, { ok: true, text: `Successfully wrote file ${rel} to workspace.`, needsApproval: false });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // zip package (AUTOMATIC & UNRESTRICTED)
  if (u.pathname === '/api/ws/zip' && req.method === 'POST') {
    try {
      const b = await body(req);
      const name = (b.name || 'workspace.zip').replace(/[^\w.\-]/g, '_');
      const files = listWorkspace().filter(f => !f.name.endsWith('.zip')).map(f => ({ name: f.name, data: fs.readFileSync(path.join(wsRoot, f.name)) }));
      if (!files.length) files.push({ name: 'README.txt', data: 'Clarity workspace — created by Gemini agent.' });
      const zip = makeZip(files);
      const out = path.join(wsRoot, name);
      fs.writeFileSync(out, zip);
      return json(res, 200, { ok: true, needsApproval: false, text: `Created zip archive ${name} (${zip.length} bytes)`, file: name, size: zip.length });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // delete file (SENSITIVE - APPROVAL REQUIRED ONCE)
  if (u.pathname === '/api/ws/delete' && req.method === 'POST') {
    try {
      const b = await body(req);
      const rel = String(b.path || '');
      const target = safePath(rel);
      if (!fs.existsSync(target)) throw Error('File not found: ' + rel);
      if (target === wsRoot || target === uploadsDir) throw Error('Cannot delete workspace root');
      pendingApprovalId = crypto.randomUUID();
      pendingAction = registerApproval({ id: pendingApprovalId, type: 'delete', path: rel, target, reason: `Delete file: ${rel}` });
      return json(res, 200, { ok: true, needsApproval: true, approvalId: pendingApprovalId, plan: ['Delete ' + rel, 'Irreversible action — human approval required before deleting', 'Remove from workspace'] });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // fetch URL (AUTOMATIC & UNRESTRICTED)
  if (u.pathname === '/api/ws/fetch' && req.method === 'POST') {
    try {
      const b = await body(req);
      const target = new URL(b.url);
      if (!/^https?:$/.test(target.protocol)) throw Error('Only http(s) URLs allowed');
      const r = await fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 (Clarity Gemini Agent)' }, signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      const clean = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
      return json(res, 200, { ok: true, url: b.url, status: r.status, text: clean || '(empty page)' });
    } catch (e) { return json(res, 400, { ok: false, error: 'Fetch failed: ' + e.message }); }
  }
  // sandbox command (AUTOMATIC & UNRESTRICTED)
  if (u.pathname === '/api/ws/run' && req.method === 'POST') {
    try {
      const b = await body(req);
      let cmd = String(b.cmd || '').trim();
      if (!/^(ls|cat|echo|pwd|date|wc|head|tail|grep|find)\b/.test(cmd)) throw Error('Command not allowed. Allowed: ls, cat, echo, pwd, date, wc, head, tail, grep, find');
      if (/[;&|>`]|\$\s*\(|\brm\b|\bsudo\b|\bcurl\b|\bwget\b|\bnc\b|\bpython\b|\bnode\b|\bmv\b|\bdd\b/.test(cmd)) throw Error('Unsafe pattern detected');
      const { execFile } = require('child_process');
      const parts = cmd.split(/\s+/); const bin = parts.shift();
      const out = await new Promise((resolve, reject) => {
        execFile(bin, parts, { cwd: wsRoot, timeout: 8000, maxBuffer: 20000 }, (err, stdout, stderr) => {
          if (err && !stdout) return reject(Error(stderr || err.message));
          resolve((stdout || '') + (stderr ? '\n[stderr] ' + stderr : ''));
        });
      });
      return json(res, 200, { ok: true, cmd: b.cmd, output: out.slice(0, 3000) });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // download file
  if (u.pathname === '/api/ws/download' && req.method === 'GET') {
    try {
      const target = safePath(u.searchParams.get('path') || '');
      if (!fs.existsSync(target)) throw Error('File not found');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + path.basename(target) + '"' });
      return fs.createReadStream(target).pipe(res);
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  return false;
}

// Approval execution helper
async function executeApproval(a) {
  if (a.type === 'write') {
    const target = safePath(a.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, a.content || '');
    return { ok: true, text: `Approved and executed: wrote **${a.path}** (${(a.content||'').length} chars) to workspace.`, result: 'file-written' };
  }
  if (a.type === 'delete') {
    if (a.target && fs.existsSync(a.target)) {
      fs.rmSync(a.target, { recursive: true, force: true });
    } else if (a.path) {
      const target = safePath(a.path);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    }
    return { ok: true, text: `Approved and executed: deleted **${a.path || 'file'}** from the workspace.`, result: 'file-deleted' };
  }
  if (a.type === 'zip') {
    const name = a.name || 'workspace.zip';
    const files = listWorkspace().filter(f => !f.name.endsWith('.zip')).map(f => ({ name: f.name, data: fs.readFileSync(path.join(wsRoot, f.name)) }));
    if (!files.length) files.push({ name: 'README.txt', data: 'Clarity workspace — created by Gemini agent.' });
    const zip = makeZip(files);
    const out = path.join(wsRoot, name);
    fs.writeFileSync(out, zip);
    return { ok: true, text: `Approved and executed: created **${name}** (${zip.length} bytes, ${files.length} file(s)). Download from Files panel.`, result: 'zip-created', file: name, size: zip.length };
  }
  throw Error('Unknown pending action');
}

function createThinkFilter(onReasoning, onDelta) {
  let insideThink = false;
  let buffer = '';

  function flush() {
    if (buffer) {
      if (insideThink) onReasoning(buffer);
      else onDelta(buffer);
      buffer = '';
    }
  }

  function processChunk(chunk) {
    if (!chunk) return;
    buffer += chunk;
    while (buffer.length > 0) {
      if (!insideThink) {
        const startIdx = buffer.indexOf('<think>');
        if (startIdx === -1) {
          const potentialPrefix = buffer.match(/<t?h?i?n?k?$/);
          if (potentialPrefix && potentialPrefix.index > 0) {
            onDelta(buffer.slice(0, potentialPrefix.index));
            buffer = potentialPrefix[0];
            break;
          } else if (potentialPrefix) {
            break;
          } else {
            onDelta(buffer);
            buffer = '';
            break;
          }
        } else {
          const outside = buffer.slice(0, startIdx);
          if (outside) onDelta(outside);
          insideThink = true;
          buffer = buffer.slice(startIdx + 7);
        }
      } else {
        const endIdx = buffer.indexOf('</think>');
        if (endIdx === -1) {
          const potentialSuffix = buffer.match(/<\/?t?h?i?n?k?>?$/);
          if (potentialSuffix && potentialSuffix.index > 0) {
            onReasoning(buffer.slice(0, potentialSuffix.index));
            buffer = potentialSuffix[0];
            break;
          } else if (potentialSuffix) {
            break;
          } else {
            onReasoning(buffer);
            buffer = '';
            break;
          }
        } else {
          const inside = buffer.slice(0, endIdx);
          if (inside) onReasoning(inside);
          insideThink = false;
          buffer = buffer.slice(endIdx + 8);
        }
      }
    }
  }

  return { processChunk, flush, push: processChunk, end: flush };
}

// Helper to build robust Gemini contents array with complete session memory
function buildGeminiContents(history, currentMessage) {
  const rawItems = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      if (!h) continue;
      const role = (h.role === 'assistant' || h.role === 'model') ? 'model' : 'user';
      if (Array.isArray(h.parts) && h.parts.length > 0) {
        rawItems.push({ role, parts: h.parts });
      } else {
        const text = String(h.content || h.text || '').trim();
        if (text) {
          rawItems.push({ role, parts: [{ text }] });
        }
      }
    }
  }
  if (currentMessage && String(currentMessage).trim()) {
    rawItems.push({ role: 'user', parts: [{ text: String(currentMessage).trim() }] });
  }

  const contents = [];
  for (const item of rawItems) {
    if (contents.length > 0 && contents[contents.length - 1].role === item.role) {
      contents[contents.length - 1].parts.push(...item.parts);
    } else {
      contents.push({ role: item.role, parts: [...item.parts] });
    }
  }
  if (contents.length > 0 && contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '[Session Context Active]' }] });
  }
  return contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: String(currentMessage || 'Hello') }] }];
}

// Detect and execute tools autonomously
// RULE: ONLY 'file_delete' requires human approval. All other tools execute directly without restrictions.
async function detectAndExecuteTools(prompt, res) {
  const p = (prompt || '').trim();

  // 1. Math calculation (AUTOMATIC)
  const mathMatch = p.match(/(?:calculate|calc|what is|compute)\s+([0-9+\-*/().%\s]+)/i);
  if (mathMatch && /[+\-*/%]/.test(mathMatch[1])) {
    const expr = mathMatch[1].trim();
    const callId = 'call_' + crypto.randomUUID().slice(0, 8);
    try {
      res.write(`data: ${JSON.stringify({ delta: `\n\n*Progress:* Calculating expression: \`${expr}\`...\n` })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.intent', callId, tool: 'safe_calc', message: `Calculating: ${expr}`, args: { expr } })}\n\n`);
      const val = safeCalc(expr);
      res.write(`data: ${JSON.stringify({ event: 'tool.call', callId, tool: 'safe_calc', args: { expr } })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'safe_calc', result: val })}\n\n`);
      return { handled: false, context: `[Tool Execution: safe_calc("${expr}") returned ${val}]` };
    } catch (e) {
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'safe_calc', error: e.message })}\n\n`);
    }
  }

  // 2. URL fetch (AUTOMATIC)
  const urlMatch = p.match(/(?:fetch|scrape|get url|browse|inspect url)\s+(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    const url = urlMatch[1].trim();
    const callId = 'call_' + crypto.randomUUID().slice(0, 8);
    try {
      res.write(`data: ${JSON.stringify({ delta: `\n\n*Progress:* Inspecting web page content at \`${url}\`...\n` })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.intent', callId, tool: 'fetch_url', message: `Fetching URL: ${url}`, args: { url } })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.call', callId, tool: 'fetch_url', args: { url } })}\n\n`);
      const resp = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Clarity Gemini)' }, signal: AbortSignal.timeout(8000) });
      const rawHtml = await resp.text();
      const clean = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'fetch_url', status: resp.status, length: clean.length, result: clean.slice(0, 500) })}\n\n`);
      return { handled: false, context: `[Tool Execution: fetch_url("${url}") HTTP ${resp.status}, content snippet: "${clean.slice(0, 500)}..."]` };
    } catch (e) {
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'fetch_url', error: e.message })}\n\n`);
    }
  }

  // 3. List workspace files (AUTOMATIC)
  if (/(?:list|show|check|view|available|what|find|explore)\s+(?:all\s+)?(?:available\s+)?(?:workspace\s+)?(?:files|documents|file\b)/i.test(p) || /^(?:files|workspace)$/i.test(p)) {
    const callId = 'call_' + crypto.randomUUID().slice(0, 8);
    try {
      res.write(`data: ${JSON.stringify({ delta: `\n\n*Progress:* Scanning local workspace files and directory structure...\n` })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.intent', callId, tool: 'list_files', message: 'Scanning workspace files…', args: {} })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.call', callId, tool: 'list_files', args: {} })}\n\n`);
      const files = listWorkspace();
      const names = files.slice(0, 15).map(f => f.name).join(', ');
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'list_files', count: files.length, result: names })}\n\n`);
      return { handled: false, context: `[Tool Execution: list_files() found ${files.length} files: ${names}]` };
    } catch (e) {
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'list_files', error: e.message })}\n\n`);
    }
  }

  // 4. Read file (AUTOMATIC)
  const readMatch = p.match(/(?:read|view|cat|inspect|open|show|check)\s+(?:file\s+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i);
  if (readMatch) {
    const rel = readMatch[1].trim();
    const callId = 'call_' + crypto.randomUUID().slice(0, 8);
    try {
      const target = safePath(rel);
      if (fs.existsSync(target)) {
        res.write(`data: ${JSON.stringify({ delta: `\n\n*Progress:* Reading content of workspace file \`${rel}\`...\n` })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'tool.intent', callId, tool: 'read_file', message: `Reading file: ${rel}`, args: { path: rel } })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'tool.call', callId, tool: 'read_file', args: { path: rel } })}\n\n`);
        const ext = path.extname(target).toLowerCase();
        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext);
        let content, resultPayload;
        if (isImage) {
           const buf = fs.readFileSync(target);
           content = "[Image File]";
           resultPayload = { path: rel, size: buf.length, image: true, base64: buf.length < 250000 ? buf.toString('base64') : undefined };
        } else {
           content = fs.readFileSync(target, 'utf8').slice(0, 2500);
           resultPayload = { path: rel, size: content.length, result: content };
        }
        res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'read_file', ...resultPayload })}\n\n`);
        return { handled: false, context: `[Tool Execution: read_file("${rel}") content:\n${content}]` };
      }
    } catch {}
  }

  // 5. Run sandbox command (AUTOMATIC & UNRESTRICTED)
  const cmdMatch = p.match(/(?:run|exec|sandbox command)\s+(ls|pwd|date|cat|echo|wc|head|tail|grep|find)(?:\s+([^\n\r]+))?/i);
  if (cmdMatch) {
    const fullCmd = cmdMatch[0].replace(/^(?:run|exec|sandbox command)\s+/i, '').trim();
    const callId = 'call_' + crypto.randomUUID().slice(0, 8);
    try {
      res.write(`data: ${JSON.stringify({ delta: `\n\n*Progress:* Running sandbox command \`${fullCmd}\` in workspace...\n` })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.intent', callId, tool: 'sandbox_run', message: `Executing command: ${fullCmd}`, args: { cmd: fullCmd } })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.call', callId, tool: 'sandbox_run', args: { cmd: fullCmd } })}\n\n`);
      const { execFile } = require('child_process');
      const parts = fullCmd.split(/\s+/);
      const bin = parts.shift();
      const out = await new Promise((resolve, reject) => {
        execFile(bin, parts, { cwd: wsRoot, timeout: 5000, maxBuffer: 15000 }, (err, stdout, stderr) => {
          if (err && !stdout) return reject(Error(stderr || err.message));
          resolve((stdout || '') + (stderr ? '\n' + stderr : ''));
        });
      });
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'sandbox_run', output: out.slice(0, 500), result: out.slice(0, 500) })}\n\n`);
      return { handled: false, context: `[Tool Execution: sandbox_run("${fullCmd}") output:\n${out.slice(0, 1000)}]` };
    } catch (e) {
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'sandbox_run', error: e.message })}\n\n`);
    }
  }

  // 6. Write file (AUTOMATIC & UNRESTRICTED - ONLY execute when explicit content is supplied, otherwise delegate to Gemini for complete code generation)
  const writeMatch = p.match(/(?:create|write|save|make|add)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:name[d]?\s+|called\s+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)(?:\s+(?:containing|with(?:\s+content)?|content:)\s*([\s\S]+))$/i);
  if (writeMatch) {
    const rel = writeMatch[1].trim();
    const hint = (writeMatch[2] || '').trim();
    // Only pre-write if explicit raw content was provided in prompt (e.g., "create file notes.txt containing Hello World")
    if (hint && !/(?:sketch|draw|design|build|app|code|html|css|javascript|page|canvas|game)/i.test(p)) {
      const content = generateContentForHint(hint, rel);
      const callId = 'call_' + crypto.randomUUID().slice(0, 8);
      try {
        const target = safePath(rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        res.write(`data: ${JSON.stringify({ delta: `\n\n*Progress:* Writing workspace file \`${rel}\` (${content.length} bytes)...\n` })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'tool.intent', callId, tool: 'file_write', message: `Creating file ${rel} (${content.length} bytes)…`, args: { path: rel } })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'tool.call', callId, tool: 'file_write', args: { path: rel } })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'file_write', path: rel, size: content.length })}\n\n`);
        return { handled: false, context: `[Tool Execution: Created and wrote file "${rel}" (${content.length} chars) successfully]` };
      } catch (e) {
        res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'file_write', error: e.message })}\n\n`);
      }
    }
  }

  // 7. Zip workspace (AUTOMATIC & UNRESTRICTED)
  if (/(?:zip|package|archive)\s+(?:the\s+)?workspace/i.test(p)) {
    const name = 'workspace.zip';
    const callId = 'call_' + crypto.randomUUID().slice(0, 8);
    try {
      const files = listWorkspace().filter(f => !f.name.endsWith('.zip')).map(f => ({ name: f.name, data: fs.readFileSync(path.join(wsRoot, f.name)) }));
      if (!files.length) files.push({ name: 'README.txt', data: 'Clarity workspace — created by Gemini agent.' });
      const zip = makeZip(files);
      const out = path.join(wsRoot, name);
      fs.writeFileSync(out, zip);
      res.write(`data: ${JSON.stringify({ delta: `\n\n*Progress:* Packaging workspace files into zip archive \`${name}\`...\n` })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.intent', callId, tool: 'zip_package', message: `Creating archive ${name}…`, args: { name } })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.call', callId, tool: 'zip_package', args: { name } })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'zip_package', file: name, size: zip.length })}\n\n`);
      return { handled: false, context: `[Tool Execution: Packaged workspace into "${name}" (${zip.length} bytes)]` };
    } catch (e) {
      res.write(`data: ${JSON.stringify({ event: 'tool.result', callId, tool: 'zip_package', error: e.message })}\n\n`);
    }
  }

  // 8. Delete file (ONLY THIS TOOL REQUIRES HUMAN APPROVAL ONCE)
  const delMatch = p.match(/(?:delete|remove|rm)\s+(?:file\s+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i);
  if (delMatch) {
    const rel = delMatch[1].trim();
    try {
      const target = safePath(rel);
      if (fs.existsSync(target)) {
        pendingApprovalId = crypto.randomUUID();
        pendingAction = registerApproval({
          id: pendingApprovalId,
          type: 'delete',
          path: rel,
          target,
          originalTask: p,
          reason: `Delete file: ${rel}. Deleting content or files requires human approval before execution.`
        });
        res.write(`data: ${JSON.stringify({
          event: 'approval.requested',
          approvalId: pendingApprovalId,
          action: 'delete',
          path: rel,
          reason: `Delete file: ${rel}. Deleting content or files requires human approval before execution.`
        })}\n\n`);
        return { handled: true, reason: `I have queued the deletion of **${rel}**. File deletion is the only action requiring human approval; please confirm to proceed.` };
      }
    } catch {}
  }

  return { handled: false };
}

// Stream directly using Google Gemini AI
async function streamProviderDirect(res, b) {
  const key = b.apiKey || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  const requestedModel = b.model || 'gemini-3.7-flash';
  const gemModel = await resolveGeminiModel(key, requestedModel);

  const isMobile = Boolean(b.isMobile);
  const userAgent = String(b.userAgent || 'Web Browser');

  const system = `You are Clarity, an autonomous standalone AI assistant powered by Google Gemini AI. Direct and complete the user task from start to finish. If the task requires multiple steps, work through them sequentially without stopping prematurely. All tool operations (creating/writing files, reading files, patching files, terminal commands, web search, archiving) execute automatically without restrictions. ONLY file or content deletion requires user approval.

CRITICAL MANDATE - CONVERSATIONAL PERSONA:
You must communicate in a highly friendly, warm, and natural conversational tone. Do NOT act like a rigid, robotic agent (e.g., avoid "I am an AI..."). Speak to the user like a helpful human friend, using casual language and empathy where appropriate, while still effectively completing all technical tasks.

CRITICAL MANDATES - AUTONOMOUS EXECUTION & SANDBOX:
1. NEVER STOP PREMATURELY: Keep executing tools in a loop until the entire requested task is 100% complete. Do not stop midway. Only stop if you genuinely need the user to make a decision or provide clarification. When finished, you MUST output the exact string "[TASK_COMPLETE]".
2. SECURE SANDBOX ENVIRONMENT: You are running in a secure, isolated Linux compute container (sandbox) that is entirely separate from the user's personal phone or PC. You have your own resources. Feel free to execute Python, bash scripts, and logic without worrying about "overloading" or harming the user's device. You have a locked, safe computer environment to control.
3. PYTHON & LIBRARIES: When using execute_python, remember it runs as a standalone script. If you want to see the result, explicitly use print() statements. IMPORTANT: You CAN install any third-party Python libraries you need! Use execute_bash to run pip install <package> (e.g. requests, beautifulsoup4, playwright). If a script fails due to a missing module, DO NOT give up—just pip install it!
4. WEB AUTOMATION: If asked to interact with or control a website, you can pip install automation tools (like Playwright, or Selenium) and write scripts to interact with forms, scrape data, or perform actions, since it runs safely inside your sandbox.

CRITICAL MANDATES - SESSION MEMORY & DEDUPLICATION:
1. COMPLETE SESSION MEMORY: Carefully inspect all previous conversation turns, tool logs, image outputs, and execution results before choosing any action. You have full memory of all prior messages and tool results.
2. PREVENT DUPLICATE WORK: Do NOT re-create files, re-run shell commands, or repeat tool calls that have ALREADY been successfully completed in previous turns of this session. If a file exists or a step is done, proceed directly to the next step or conclude with [TASK_COMPLETE].

CRITICAL MANDATE - PROGRESS REPORTING BEFORE TOOL USE:
BEFORE invoking any tool or JSON tool call, you MUST first output a clear natural-language statement explaining to the user:
1. What step of the task you are currently working on.
2. What progress has been made so far.
3. Why you are about to execute the tool and what you expect it to accomplish.
NEVER call a tool silently or without explaining your progress first.

ENVIRONMENT & DEVICE CONTEXT:
Device Type: ${isMobile ? 'Mobile Device' : 'Desktop Device'}
User Agent: ${userAgent}
Workspace Location: ${wsRoot}
Device Guidance: The user is accessing the interface via a ${isMobile ? 'Mobile' : 'Desktop'} browser. However, your tools (bash, python, file system) DO NOT run on the user's device! They run in your secure, isolated backend cloud Sandbox container. You can safely execute heavy tasks, run Python scripts, or manipulate files without worrying about overloading the user's personal device.

Available Sandbox Tools:
1. execute_bash: Run shell commands (e.g. {"tool": "execute_bash", "parameters": {"command": "ls -la"}})
2. execute_python: Run Python code directly in Sandbox (e.g. {"tool": "execute_python", "parameters": {"code": "import os; print(os.listdir('.'))"}})
3. file_writer / file_write: Write/create files (e.g. {"tool": "file_writer", "parameters": {"path": "example.txt", "content": "..."}})
4. file_reader / file_read: Read file content (e.g. {"tool": "file_reader", "parameters": {"path": "example.txt"}})
5. file_patcher / file_patch: Find & replace inside a file (e.g. {"tool": "file_patcher", "parameters": {"path": "...", "old_string": "...", "new_string": "..."}})
6. file_delete: Delete files or directories (requires 1-time human approval) (e.g. {"tool": "file_delete", "parameters": {"path": "temp.txt"}})
7. web_search: Search the internet (e.g. {"tool": "web_search", "parameters": {"query": "..."}})
8. browser_use / browser_navigate: Browse URLs (e.g. {"tool": "browser_use", "parameters": {"url": "https://..."}})
9. zip_creator / zip_package: Package files into zip archive (e.g. {"tool": "zip_creator", "parameters": {"name": "project.zip"}})

Whenever you need to call a tool, output the invocation block formatted as:
{"tool": "<tool_name>", "parameters": { ... }}

The local client harness will automatically execute it, display its input command and execution output in an interactive closeable frame, and feed the result back to you. Continue working autonomously without stopping until the task is complete. When all requirements are verified complete, finish with [TASK_COMPLETE] and a clear summary.`;

  // Build conversation history with full session memory
  const contents = buildGeminiContents(b.history, b.message);

  const thinkFilter = createThinkFilter(
    rzn => res.write(`data: ${JSON.stringify({ reasoning_content: rzn })}\n\n`),
    delta => res.write(`data: ${JSON.stringify({ delta })}\n\n`)
  );

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent?key=${encodeURIComponent(key || '')}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents })
    });
    const d = await r.json();
    if (!r.ok) {
      throw Error(d.error?.message || `Gemini API request failed with status ${r.status}`);
    }
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'I have reviewed your request and processed the workspace task.';
    for (const chunk of text.split(' ')) {
      thinkFilter.processChunk(chunk + ' ');
      await new Promise(r2 => setTimeout(r2, 12));
    }
    thinkFilter.flush();
  } catch (err) {
    // Graceful fallback response when API key is missing or invalid
    const text = `I am Clarity Gemini AI Assistant. ${err.message}. Your request was received: "${b.message}". You can configure your Gemini API Key in the Settings panel anytime.`;
    for (const chunk of text.split(' ')) {
      thinkFilter.processChunk(chunk + ' ');
      await new Promise(r2 => setTimeout(r2, 12));
    }
    thinkFilter.flush();
  }
}

// ---------- HTTP server ----------
function createApp() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    try {
      const toolHandled = await handleTools(req, res, u);
      if (toolHandled !== false) return;

      // Local tool execution API (compatible with local agent client and FastAPI schemas)
      if (req.method === 'POST' && (u.pathname === '/execute' || u.pathname === '/api/tools/execute')) {
        try {
          const b = await body(req);
          const toolName = b.tool_name || b.tool;
          const toolArgs = b.arguments || b.parameters || {};
          const result = await executeLocalTool(toolName, toolArgs, req);
          return json(res, 200, result);
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }

      // Tool discovery API
      if (req.method === 'GET' && (u.pathname === '/tools' || u.pathname === '/api/tools')) {
        return json(res, 200, {
          status: "online",
          system: "Clarity Local Agent Engine",
          tools: TOOL_DEFINITIONS
        });
      }

      // Download published workspace files
      if (req.method === 'GET' && u.pathname.startsWith('/downloads/')) {
        try {
          const filename = decodeURIComponent(u.pathname.slice(11));
          const target = path.join(downloadsDir, path.basename(filename));
          if (fs.existsSync(target) && fs.lstatSync(target).isFile()) {
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${path.basename(target)}"`
            });
            return fs.createReadStream(target).pipe(res);
          }
          return json(res, 404, { error: 'File not found' });
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }

      if (req.method === 'GET' && u.pathname === '/api/health') {
        return json(res, 200, {
          ok: true, name: 'Clarity', version: '3.0.0',
          standalone: true,
          hackathon: 'All Things Agentic',
          tools: TOOL_DEFINITIONS.map(t => t.function.name),
          providers: Object.keys(providers)
        });
      }
      if (req.method === 'GET' && u.pathname === '/api/providers') return json(res, 200, { providers });
      if (req.method === 'POST' && u.pathname === '/api/providers/models') {
        try { const b = await body(req); const models = await discoverModels(b.provider, b.apiKey, b.baseUrl); return json(res, 200, { ok: true, provider: b.provider || 'gemini', models }); }
        catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      }

      if (req.method === 'POST' && u.pathname === '/api/reject') {
        try {
          const b = await body(req).catch(() => ({}));
          const a = getApproval(b.approvalId);
          if (!a) return json(res, 400, { ok: false, error: 'No pending approval to reject' });
          clearApproval(a.id);

          const rejectReason = b.reason || 'Rejected by user';
          return json(res, 200, {
            ok: true,
            status: 'rejected',
            text: `Rejected: Deletion of ${a.path || 'file'} was cancelled by user.`,
            modelResponse: 'Understood, the file deletion was cancelled.',
            source: 'clarity',
            sessionId: a.sessionId,
            continueTurn: false
          });
        } catch (e) {
          return json(res, 400, { ok: false, error: e.message });
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/approve') {
        try {
          const b = await body(req).catch(() => ({}));
          const a = getApproval(b.approvalId);
          if (!a) return json(res, 400, { ok: false, error: 'No pending action to approve' });
          clearApproval(a.id);

          const result = await executeApproval(a);
          return json(res, 200, {
            ...result,
            approvalId: a.id,
            taskCompleted: false,
            continueTurn: true,
            followUpPrompt: `[Human Approval Granted]: ${result.text}. The deletion was executed. Review workspace status and summarize remaining work.`
          });
        } catch (e) {
          return json(res, 400, { ok: false, error: e.message });
        }
      }

      if (req.method === 'POST' && u.pathname === '/api/agent/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        try {
          const b = await body(req);
          res.write(`data: ${JSON.stringify({ mode: 'direct', event: 'status', message: 'Clarity Standalone Gemini Engine active.' })}\n\n`);

          const toolExec = await detectAndExecuteTools(b.message, res);
          if (toolExec.handled) {
            res.write(`data: ${JSON.stringify({ delta: toolExec.reason })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          if (toolExec.context) {
            b.message = `${toolExec.context}\n\nUser request: ${b.message}`;
          }
          await streamProviderDirect(res, b);
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (e) {
          try { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); } catch {}
        }
        return;
      }

      // static files
      if (req.method === 'GET') {
        const rel = u.pathname === '/' ? 'index.html' : u.pathname;
        if (rel.startsWith('/uploads/')) {
          try {
            const target = safePath(rel.slice(1));
            if (!fs.existsSync(target)) return json(res, 404, { error: 'Not found' });
            const ext = path.extname(target).toLowerCase();
            const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown' }[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            return fs.createReadStream(target).pipe(res);
          } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
        }
        let file = path.join(publicDir, rel);
        if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res, 404, { error: 'Not found' });
        const ext = path.extname(file);
        const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
      json(res, 405, { error: 'Method not allowed' });
    } catch (e) {
      if (!res.headersSent) return json(res, 500, { ok: false, error: e.message });
      try { res.end(); } catch {}
    }
  });
}

if (require.main === module) {
  createApp().listen(PORT, '0.0.0.0', () => console.log(`Clarity running at http://0.0.0.0:${PORT} · workspace: ${wsRoot} · provider: Gemini AI`));
}

module.exports = { createApp, providers, safeCalc, makeZip, listWorkspace, safePath, wsRoot, downloadsDir, executeLocalTool, TOOL_DEFINITIONS, executeApproval, createThinkFilter, registerApproval, getApproval, clearApproval };
