<script>
// ---------- DOM SELECTORS & STATE ----------
const $ = id => document.getElementById(id);
let activeRunId = localStorage.getItem('clarityRunId') || crypto.randomUUID();

let sessions = [];
try {
  sessions = JSON.parse(localStorage.getItem('claritySessions') || '[]');
} catch (e) {
  sessions = [];
}

if (!Array.isArray(sessions) || !sessions.length) {
  sessions = [{ id: activeRunId, title: 'Active Chat', messages: [], timestamp: Date.now() }];
}

// Sanitize sessions to ensure every session has an id, title, and valid messages array
sessions = sessions.map((s, idx) => ({
  id: s && s.id ? String(s.id) : crypto.randomUUID(),
  title: s && s.title ? String(s.title) : `Chat ${idx + 1}`,
  messages: s && Array.isArray(s.messages) ? s.messages : [],
  timestamp: s && s.timestamp ? Number(s.timestamp) : Date.now()
}));

let currentSession = sessions.find(s => s && s.id === activeRunId) || sessions[0];
if (!currentSession) {
  currentSession = { id: activeRunId, title: 'Active Chat', messages: [], timestamp: Date.now() };
  sessions = [currentSession];
}
if (!Array.isArray(currentSession.messages)) {
  currentSession.messages = [];
}
activeRunId = currentSession.id;
localStorage.setItem('clarityRunId', activeRunId);
localStorage.setItem('claritySessions', JSON.stringify(sessions));

let traceCount = 0;

// ---------- TOAST ----------
function showToast(msg) {
  const t = $('toastBox');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- FORMATTING & CODE HIGHLIGHTING ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanChatText(text) {
  if (!text) return '';
  let clean = String(text)
    .replace(/\[TASK_COMPLETE\]/gi, '')
    .replace(/TASK_COMPLETED/gi, '')
    .replace(/\[TOOL RESULT FOR [\s\S]*?\]/gi, '')
    .replace(/\[Tool Execution:[\s\S]*?\]/gi, '')
    .replace(/\[Tool Executed:[\s\S]*?\]/gi, '')
    .replace(/\[Session Context Active\]/gi, '');

  // Strip fenced code blocks that contain JSON tool calls: e.g. ```json {"tool": ...} ```
  clean = clean.replace(/```(?:json|javascript|js)?\s*\{\s*"?tool"?\s*:[\s\S]*?\}\s*```/gi, '');

  // Strip standalone raw JSON tool calls: e.g. {"tool": "file_writer", "parameters": {...}}
  clean = clean.replace(/\{\s*"?tool"?\s*:\s*"[a-zA-Z0-9_-]+"\s*,\s*"?parameters"?\s*:\s*\{[\s\S]*?\}\s*\}/gi, '');

  return clean.trim();
}

function formatMarkdown(text) {
  if (!text) return '';
  const parts = String(text).split(/```/);
  if (parts.length < 3) {
    return escapeHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>');
  }
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      html += escapeHtml(parts[i])
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    } else {
      const lines = parts[i].split('\n');
      const lang = lines[0].trim();
      const code = lines.slice(1).join('\n');
      const codeId = 'code-' + Math.random().toString(36).slice(2, 8);
      html += `<details class="code-frame" open>
        <summary>
          <span>💻 ${escapeHtml(lang || 'code')} (${code.length} chars)</span>
          <button class="copy-btn" onclick="copySnippet(this, '${codeId}')">Copy</button>
        </summary>
        <div class="code-body" id="${codeId}">${escapeHtml(code)}</div>
      </details>`;
    }
  }
  return html;
}

window.copySnippet = function(btn, id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => btn.textContent = orig, 1500);
  });
};

// ---------- TRACE LOGS ----------
function addTrace(title, detail, symbol = '✓') {
  traceCount++;
  $('traceCounter').textContent = traceCount;
  const list = $('traceList');
  const item = document.createElement('div');
  item.className = 'trace-item';
  item.innerHTML = `
    <div class="trace-symbol">${symbol}</div>
    <div class="trace-text">
      <p class="trace-title">${escapeHtml(title)}</p>
      <p class="trace-detail">${escapeHtml(detail)}</p>
    </div>
    <span class="trace-time">now</span>
  `;
  list.prepend(item);
}

// ---------- TOOL CARDS & CLOSEABLE FRAMES ----------
window.toggleToolCard = function(id) {
  const content = document.getElementById('tc-content-' + id);
  const badge = document.getElementById('tc-badge-' + id);
  if (!content) return;
  const isShown = content.style.display === 'flex';
  content.style.display = isShown ? 'none' : 'flex';
  if (badge) {
    badge.textContent = isShown ? 'TAP TO VIEW ▾' : 'TAP TO HIDE ▴';
  }
};

function createOrGetToolCard(id, toolName, inputArgs, parentContainer) {
  let card = document.getElementById('tc-' + id);
  if (!card && toolName && parentContainer) {
    // Deduplicate: check if an active/executing card for this tool already exists in parentContainer
    const existingCards = parentContainer.querySelectorAll('.tool-card');
    for (const c of existingCards) {
      if (c.getAttribute('data-tool-name') === toolName && c.getAttribute('data-tool-status') === 'executing') {
        c.id = 'tc-' + id;
        card = c;
        break;
      }
    }
  }

  if (!card) {
    card = document.createElement('div');
    card.className = 'tool-card';
    card.id = 'tc-' + id;
    card.setAttribute('data-tool-name', toolName || '');
    card.setAttribute('data-tool-status', 'executing');

    let formattedInput = '';
    if (typeof inputArgs === 'string') formattedInput = inputArgs;
    else {
      try { formattedInput = JSON.stringify(inputArgs, null, 2); }
      catch (e) { formattedInput = String(inputArgs || ''); }
    }

    card.innerHTML = `
      <button type="button" class="tool-btn" onclick="toggleToolCard('${id}')">
        <span class="tool-btn-title">
          <span class="spinner" id="tc-spin-${id}"></span>
          <span id="tc-title-${id}">Executing: <b>${escapeHtml(toolName)}</b></span>
        </span>
        <span class="tool-btn-badge" id="tc-badge-${id}">TAP TO VIEW ▾</span>
      </button>
      <div class="tool-content" id="tc-content-${id}">
        <div class="tool-section">
          <span class="tool-label">📥 Command / Inputs:</span>
          <pre class="tool-code input-box" id="tc-input-${id}">${escapeHtml(formattedInput || 'Running tool...')}</pre>
        </div>
        <div class="tool-section">
          <span class="tool-label">📤 Execution Output:</span>
          <pre class="tool-code output-box" id="tc-output-${id}">Running locally on device…</pre>
        </div>
      </div>
    `;
    if (parentContainer) {
      parentContainer.appendChild(card);
      scrollChatToBottom();
    }
  } else if (inputArgs) {
    const inPre = document.getElementById('tc-input-' + id);
    if (inPre && (!inPre.textContent || inPre.textContent === 'Running tool...')) {
      let formattedInput = '';
      if (typeof inputArgs === 'string') formattedInput = inputArgs;
      else {
        try { formattedInput = JSON.stringify(inputArgs, null, 2); }
        catch (e) { formattedInput = String(inputArgs || ''); }
      }
      inPre.textContent = formattedInput;
    }
  }
  return card;
}

function finishToolCard(id, toolName, result, isError) {
  const card = document.getElementById('tc-' + id);
  if (card) {
    card.setAttribute('data-tool-status', isError ? 'error' : 'finished');
  }

  const spin = document.getElementById('tc-spin-' + id);
  const title = document.getElementById('tc-title-' + id);
  const outPre = document.getElementById('tc-output-' + id);
  const content = document.getElementById('tc-content-' + id);

  if (spin) spin.style.display = 'none';
  if (title) {
    if (isError) {
      title.innerHTML = `❌ Error: <b>${escapeHtml(toolName)}</b>`;
    } else {
      title.innerHTML = `✅ Finished: <b>${escapeHtml(toolName)}</b>`;
    }
  }

  let formattedOut = '';
  if (typeof result === 'object' && result !== null) {
    try { formattedOut = JSON.stringify(result, null, 2); }
    catch (e) { formattedOut = String(result); }
  } else {
    formattedOut = String(result || '');
  }

  if (outPre) {
    outPre.textContent = formattedOut || (isError ? 'Tool execution failed' : 'Execution finished with no output');
  }

  if (result && result.download_url && content) {
    let dlCard = content.querySelector('.download-card');
    if (!dlCard) {
      dlCard = document.createElement('div');
      dlCard.className = 'download-card';
      dlCard.innerHTML = `
        <span style="font-size:12.5px;color:#065f46">📦 File Ready: <b>${escapeHtml(result.filename || 'download')}</b></span>
        <a class="download-btn" href="${escapeHtml(result.download_url)}" download="${escapeHtml(result.filename || 'download')}">⬇️ Download</a>
      `;
      content.appendChild(dlCard);
    }
  }
}

// ---------- CHAT RENDERING ----------
function renderMessages() {
  const container = $('messagesList');
  const hero = $('welcomeHero');
  if (!currentSession) {
    currentSession = sessions[0] || { id: activeRunId, title: 'Active Chat', messages: [], timestamp: Date.now() };
  }
  if (!Array.isArray(currentSession.messages)) {
    currentSession.messages = [];
  }
  const msgs = currentSession.messages;

  if (!msgs.length) {
    hero.style.display = 'flex';
    container.innerHTML = '';
    return;
  }
  hero.style.display = 'none';
  container.innerHTML = '';

  for (const m of msgs) {
    appendMessageElement(m);
  }
  scrollChatToBottom();
}

function isTaskCompletionText(txt) {
  if (!txt) return false;
  return /\[TASK_COMPLETE\]/i.test(txt) ||
         /TASK_COMPLETED/i.test(txt) ||
         /(?:all tasks?|task|all requested (?:actions|files|steps)) (?:is|are|have been) (?:complete|completed|finished|done)/i.test(txt) ||
         /(?:completed|finished) (?:your|all) (?:task|request|deliverables)/i.test(txt);
}

function removeTypingIndicator(contentWrap) {
  if (!contentWrap) return;
  const ind = contentWrap.querySelector('.typing-indicator');
  if (ind) ind.remove();
}

function appendMessageElement(m) {
  const container = $('messagesList');
  $('welcomeHero').style.display = 'none';

  const row = document.createElement('div');
  row.className = `message-row ${m.role === 'user' ? 'user' : 'assistant'}`;

  let innerHtml = '';
  if (m.role !== 'user') {
    innerHtml += `<div class="message-avatar">C</div>`;
  }

  innerHtml += `<div class="message-content-wrap">`;

  // Collapsible Reasoning if present
  if (m.thinking) {
    const wordCount = m.thinking ? m.thinking.trim().split(/\s+/).filter(Boolean).length : 0;
    innerHtml += `
      <details class="thinking-block" ${m.streaming ? 'open' : ''}>
        <summary class="thinking-summary">🧠 Thought Process (${wordCount} words · click to view)</summary>
        <div class="thinking-content">${escapeHtml(m.thinking)}</div>
      </details>
    `;
  }

  // Bubble content
  if (m.text) {
    const cleanText = cleanChatText(m.text);
    if (cleanText) {
      innerHtml += `<div class="bubble">${formatMarkdown(cleanText)}</div>`;
    }
  }

  // Task Completion Badge if verified complete
  if (m.taskCompleted || isTaskCompletionText(m.text)) {
    innerHtml += `
      <div class="task-complete-badge">
        <span>✓</span>
        <span>Task Verified Complete · Stopped</span>
      </div>
    `;
  }

  // Tool tags or cards
  const toolsToRender = (Array.isArray(m.toolsExecuted) && m.toolsExecuted.length > 0)
    ? m.toolsExecuted
    : (m.tool ? [{ tool: m.tool, args: m.toolArgs, result: m.toolResult }] : []);

  for (const t of toolsToRender) {
    const histId = 'hist-' + Math.random().toString(36).slice(2, 8);
    innerHtml += `
      <div class="tool-card" id="tc-${histId}">
        <button type="button" class="tool-btn" onclick="toggleToolCard('${histId}')">
          <span class="tool-btn-title">
            <span>✅ Finished: <b>${escapeHtml(t.tool)}</b></span>
          </span>
          <span class="tool-btn-badge" id="tc-badge-${histId}">TAP TO VIEW ▾</span>
        </button>
        <div class="tool-content" id="tc-content-${histId}">
          <div class="tool-section">
            <span class="tool-label">📥 Command / Inputs:</span>
            <pre class="tool-code input-box">${escapeHtml(typeof t.args === 'string' ? t.args : JSON.stringify(t.args, null, 2))}</pre>
          </div>
          <div class="tool-section">
            <span class="tool-label">📤 Execution Output:</span>
            <pre class="tool-code output-box">${escapeHtml(typeof t.result === 'string' ? t.result : JSON.stringify(t.result, null, 2) || 'Executed successfully')}</pre>
          </div>
        </div>
      </div>
    `;
  }

  // Inline Approval Card
  if (m.approval) {
    innerHtml += `
      <div class="approval-card ${m.approval.decided ? 'decided' : ''}" data-approval-id="${escapeHtml(m.approval.approvalId || '')}">
        <div class="approval-header">
          <span>🛡️</span>
          <span>Human Approval Gate</span>
        </div>
        <p class="approval-msg">${escapeHtml(m.approval.reason)}</p>
        ${!m.approval.decided ? `
          <div class="approval-actions-row">
            <button class="btn-approve" onclick="handleInlineDecision(this, true, null, '${escapeHtml(m.approval.approvalId || '')}')">✓ Approve & Execute</button>
            <button class="btn-reject" onclick="handleInlineDecision(this, false, null, '${escapeHtml(m.approval.approvalId || '')}')">✕ Reject</button>
          </div>
        ` : `<div style="font-weight:600;font-size:12.5px;color:#92400e">${escapeHtml(m.approval.decisionText || 'Decided')}</div>`}
      </div>
    `;
  }

  // If assistant message has no content yet while streaming, show attractive animated loading indicator!
  const hasContent = Boolean(m.text && cleanChatText(m.text)) || Boolean(m.thinking) || toolsToRender.length > 0 || Boolean(m.approval);
  if (m.role !== 'user' && !hasContent && (m.streaming || isGenerating)) {
    innerHtml += `
      <div class="typing-indicator" id="typing-indicator">
        <div class="typing-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
        <span>Clarity is thinking & processing…</span>
      </div>
    `;
  }

  innerHtml += `<span class="message-meta">${m.role === 'user' ? 'You' : 'Clarity'} · ${m.time || 'just now'}</span>`;
  innerHtml += `</div>`;

  row.innerHTML = innerHtml;
  container.appendChild(row);
  return row;
}

function renderMessage(m) {
  return appendMessageElement(m);
}

function scrollChatToBottom() {
  const el = $('chatScrollArea');
  el.scrollTop = el.scrollHeight;
}

// ---------- SESSIONS MANAGEMENT ----------
function renderSessionList() {
  const list = $('sessionList');
  list.innerHTML = '';
  $('sessionCount').textContent = `${sessions.length} chat${sessions.length > 1 ? 's' : ''}`;

  sessions.forEach((s) => {
    const row = document.createElement('div');
    row.className = `session-row ${currentSession && s.id === currentSession.id ? 'active' : ''}`;
    row.innerHTML = `
      <div class="session-label">
        <span>💬</span>
        <span>${escapeHtml(s.title || 'Untitled Chat')}</span>
      </div>
      <button class="session-del-btn" title="Delete chat">✕</button>
    `;

    row.onclick = (e) => {
      if (e.target.classList.contains('session-del-btn')) {
        e.stopPropagation();
        deleteSession(s.id);
        return;
      }
      switchSession(s.id);
    };
    list.appendChild(row);
  });

  $('breadcrumbSession').textContent = (currentSession && currentSession.title) || 'Active Run';
}

function switchSession(id) {
  const found = sessions.find(s => s && s.id === id);
  if (!found) return;
  if (!Array.isArray(found.messages)) found.messages = [];
  currentSession = found;
  activeRunId = found.id;
  localStorage.setItem('clarityRunId', activeRunId);
  renderSessionList();
  renderMessages();
  addTrace('Switched Session', found.title, '→');
  if (window.innerWidth <= 768) {
    closeMobileSidebar();
  }
}

function deleteSession(id) {
  if (sessions.length <= 1) {
    showToast('Cannot delete only session');
    return;
  }
  sessions = sessions.filter(s => s && s.id !== id);
  if (currentSession && currentSession.id === id) {
    currentSession = sessions[0];
    if (currentSession && !Array.isArray(currentSession.messages)) currentSession.messages = [];
    activeRunId = currentSession ? currentSession.id : crypto.randomUUID();
    localStorage.setItem('clarityRunId', activeRunId);
  }
  localStorage.setItem('claritySessions', JSON.stringify(sessions));
  renderSessionList();
  renderMessages();
  showToast('Chat session removed');
}

$('btnNewChat').onclick = () => {
  const newId = crypto.randomUUID();
  const newTitle = `Chat ${sessions.length + 1}`;
  const newSess = { id: newId, title: newTitle, messages: [], timestamp: Date.now() };
  sessions.unshift(newSess);
  currentSession = newSess;
  activeRunId = newId;
  localStorage.setItem('clarityRunId', activeRunId);
  localStorage.setItem('claritySessions', JSON.stringify(sessions));
  renderSessionList();
  renderMessages();
  showToast('Created new chat session');
  if (window.innerWidth <= 768) {
    closeMobileSidebar();
  }
  $('composerInput').focus();
};

// ---------- APPROVAL GATE LOGIC ----------
window.handleInlineDecision = async function(btn, approved, explicitReason, explicitApprovalId) {
  const card = btn.closest('.approval-card');
  const buttons = card ? card.querySelectorAll('button') : [];
  buttons.forEach(b => b.disabled = true);
  const actionsRow = card ? card.querySelector('.approval-actions-row') : null;

  const msgEl = card ? card.querySelector('.approval-msg') : null;
  const reason = explicitReason || (msgEl ? msgEl.textContent.trim() : '');
  const approvalId = explicitApprovalId || (card ? (card.getAttribute('data-approval-id') || card.dataset?.approvalId) : '') || '';

  const url = approved ? '/api/approve' : '/api/reject';
  addTrace(approved ? 'Approving Action' : 'Rejecting Action', `${reason} [ID: ${approvalId || 'active'}]`, approved ? '✓' : '×');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason, approvalId })
    });
    const d = await res.json();
    const decisionText = d.ok ? (approved ? `✓ ${d.text}` : `✕ ${d.text}`) : `⚠ Error: ${d.error}`;

    if (card) {
      card.classList.add('decided');
      if (actionsRow) {
        actionsRow.outerHTML = `<div style="font-weight:600;font-size:12.5px;color:#92400e;margin-top:6px">${escapeHtml(decisionText)}</div>`;
      } else {
        card.insertAdjacentHTML('beforeend', `<div style="font-weight:600;font-size:12.5px;color:#92400e;margin-top:6px">${escapeHtml(decisionText)}</div>`);
      }
    }

    // Record decision state on existing message in session history to prevent duplicate cards on re-render
    if (!currentSession) {
      currentSession = sessions[0] || { id: activeRunId, title: 'Active Chat', messages: [], timestamp: Date.now() };
    }
    if (!Array.isArray(currentSession.messages)) {
      currentSession.messages = [];
    }
    const matchMsg = currentSession.messages.find(m => m && m.approval && (!approvalId || m.approval.approvalId === approvalId || !m.approval.decided));
    if (matchMsg && matchMsg.approval) {
      matchMsg.approval.decided = true;
      matchMsg.approval.decisionText = decisionText;
    }
    localStorage.setItem('claritySessions', JSON.stringify(sessions));
    refreshWorkspaceFiles();
    showToast(approved ? 'Action executed on workspace' : 'Action cancelled');

    if (d.ok) {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isFinished = Boolean(d.taskCompleted || isTaskCompletionText(d.modelResponse || ''));

      if (d.modelResponse) {
        const assistantFollowUp = {
          role: 'assistant',
          text: d.modelResponse,
          taskCompleted: isFinished,
          time: timeStr
        };
        currentSession.messages.push(assistantFollowUp);
        localStorage.setItem('claritySessions', JSON.stringify(sessions));
        appendMessageElement(assistantFollowUp);
        scrollChatToBottom();
        if (isFinished) {
          addTrace('Task Complete', 'Agent verified all tasks complete and stopped', '✓');
        } else {
          addTrace('Turn Completed', 'Action executed & verified by agent', '✓');
        }
      }

      if (d.nextApproval) {
        const nextAppMsg = {
          role: 'assistant',
          text: '',
          approval: {
            reason: d.nextApproval.reason,
            approvalId: d.nextApproval.approvalId,
            tool: d.nextApproval.tool,
            args: d.nextApproval.args,
            decided: false
          },
          time: timeStr
        };
        currentSession.messages.push(nextAppMsg);
        localStorage.setItem('claritySessions', JSON.stringify(sessions));
        appendMessageElement(nextAppMsg);
        scrollChatToBottom();
        addTrace('Approval Gate', d.nextApproval.reason, '🛡️');
      } else if (!isFinished && d.continueTurn && d.followUpPrompt) {
        addTrace('Autonomous Loop Resumed', 'Agent continuing until task is complete…', '🔄');
        setTimeout(() => {
          submitChat(d.followUpPrompt, { isAutonomousFollowUp: true, stepCount: 1 });
        }, 350);
      }
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  }
};

// ---------- SEND / STOP BUTTON CONTROLLER ----------
let isGenerating = false;
let activeAbortController = null;

function setGeneratingState(generating) {
  isGenerating = generating;
  const btn = $('btnSend');
  if (!btn) return;
  if (generating) {
    btn.classList.add('stop');
    btn.title = 'Stop agent';
    btn.setAttribute('aria-label', 'Stop agent');
    btn.innerHTML = '■';
    btn.disabled = false;
  } else {
    btn.classList.remove('stop');
    btn.title = 'Send';
    btn.setAttribute('aria-label', 'Send message');
    btn.innerHTML = '↑';
    btn.disabled = false;
  }
}

function stopCurrentGeneration() {
  if (isGenerating && activeAbortController) {
    activeAbortController.abort();
    addTrace('Agent Stopped', 'User stopped generation', '⏹');
    showToast('Agent execution stopped by user');
  }
  setGeneratingState(false);
}

// ---------- CHAT STREAMING DISPATCH ----------
async function submitChat(promptText, options = {}) {
  const text = (promptText || '').trim();
  if (!text) return;
  if (isGenerating && !options.isAutonomousFollowUp) {
    stopCurrentGeneration();
    return;
  }

  const isAutonomous = Boolean(options.isAutonomousFollowUp);
  const provider = localStorage.getItem('clarityProvider') || 'gemini';
  const apiKey = localStorage.getItem('clarityApiKey') || '';
  const model = localStorage.getItem('clarityModel') || 'gemini-3.7-flash';

  if (!currentSession) {
    currentSession = sessions[0] || { id: activeRunId, title: 'Active Chat', messages: [], timestamp: Date.now() };
  }
  if (!Array.isArray(currentSession.messages)) {
    currentSession.messages = [];
  }

  // Add User Message (or subtle Autonomous prompt trace)
  if (!isAutonomous) {
    const userMsg = { role: 'user', text, time: 'just now' };
    currentSession.messages.push(userMsg);
    appendMessageElement(userMsg);
    scrollChatToBottom();

    // Auto-name chat session if default
    if (currentSession.messages.length === 1 && currentSession.title.startsWith('Chat ')) {
      currentSession.title = text.slice(0, 24) + (text.length > 24 ? '…' : '');
      $('breadcrumbSession').textContent = currentSession.title;
      renderSessionList();
    }
    $('composerInput').value = '';
    $('composerInput').style.height = 'auto';
  } else {
    addTrace('Autonomous Step', 'Evaluating completion with complete history…', '🔄');
  }

  if (window.innerWidth <= 768) {
    closeMobileSidebar();
  }

  // Convert Send button to Stop button immediately!
  setGeneratingState(true);
  activeAbortController = new AbortController();

  addTrace('Turn Started', `Agent processing: "${text.slice(0, 40)}..."`, '▶');

  // Prepare Assistant message node for streaming
  const assistantMsg = { role: 'assistant', text: '', thinking: '', streaming: true, time: 'just now' };
  const row = appendMessageElement(assistantMsg);
  const contentWrap = row.querySelector('.message-content-wrap');
  let bubbleEl = row.querySelector('.bubble');
  let thinkingContentEl = null;
  let taskCompleted = false;
  const streamToolCardMap = {};

  try {
    // Send previous turns for context memory with full session details
    const historyPayload = Array.isArray(currentSession.messages)
      ? currentSession.messages
          .slice(0, isAutonomous ? currentSession.messages.length : -1)
          .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
          .map(m => {
            let content = cleanChatText(m.text || '');
            let parts = [];

            const toolLogs = [];
            if (Array.isArray(m.toolsExecuted) && m.toolsExecuted.length > 0) {
              for (const t of m.toolsExecuted) {
                // Attach image inline if the tool returned base64 (e.g., reading an image file)
                if (t.result && typeof t.result === 'object' && t.result.image && t.result.base64) {
                  parts.push({
                    inlineData: { mimeType: 'image/png', data: t.result.base64 }
                  });
                  const logResult = { ...t.result };
                  delete logResult.base64; // Don't bloat the text context
                  toolLogs.push(`[Tool Executed: ${t.tool}\nCommand/Input: ${typeof t.args === 'string' ? t.args : JSON.stringify(t.args)}\nExecution Result: ${JSON.stringify(logResult)} (Image passed inline)]`);
                } else {
                  toolLogs.push(`[Tool Executed: ${t.tool}\nCommand/Input: ${typeof t.args === 'string' ? t.args : JSON.stringify(t.args)}\nExecution Result: ${typeof t.result === 'string' ? t.result : JSON.stringify(t.result)}]`);
                }
              }
            } else if (m.tool) {
              toolLogs.push(`[Tool Executed: ${m.tool}\nCommand/Input: ${typeof m.toolArgs === 'string' ? m.toolArgs : JSON.stringify(m.toolArgs)}\nExecution Result: ${typeof m.toolResult === 'string' ? m.toolResult : JSON.stringify(m.toolResult)}]`);
            }

            if (toolLogs.length > 0) {
              content = content ? `${content}\n\n${toolLogs.join('\n\n')}` : toolLogs.join('\n\n');
            }

            if (m.approval) {
              const appInfo = `[Human Gate Action: ${m.approval.reason || 'Human Approval Gate'}${m.approval.decisionText ? ` | Decision: ${m.approval.decisionText}` : ''}]`;
              content = content ? `${content}\n\n${appInfo}` : appInfo;
            }

            if (content) {
              parts.unshift({ text: content });
            }

            return { role: m.role, parts, content };
          })
          .filter(m => (m.content && m.content.trim().length > 0) || (m.parts && m.parts.length > 0))
      : [];

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth <= 768;
    const userAgent = navigator.userAgent;

    const res = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: text,
        provider,
        model,
        apiKey,
        runId: activeRunId,
        tfSessionId: currentSession.tfSessionId || null,
        history: historyPayload,
        isMobile,
        userAgent
      }),
      signal: activeAbortController.signal
    });

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}: Failed to reach agent stream`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const ev = JSON.parse(payload);

          // Track session ID for persistent session continuity
          if ((ev.event === 'session.created' || ev.event === 'session.reused') && ev.sessionId) {
            currentSession.tfSessionId = ev.sessionId;
            localStorage.setItem('claritySessions', JSON.stringify(sessions));
            addTrace('Session Active', `Gemini session: ${ev.sessionId.slice(0, 10)}…`, '🔗');
          }

          // Error event
          else if (ev.error) {
            removeTypingIndicator(contentWrap);
            assistantMsg.text += `\n⚠ ${ev.error}`;
            const cleanText = cleanChatText(assistantMsg.text);
            if (!bubbleEl) {
              bubbleEl = document.createElement('div');
              bubbleEl.className = 'bubble';
              contentWrap.prepend(bubbleEl);
            }
            bubbleEl.innerHTML = formatMarkdown(cleanText || assistantMsg.text);
            addTrace('Error', ev.error, '!');
          }

          // Reasoning / Thinking
          else if (ev.reasoning_content) {
            removeTypingIndicator(contentWrap);
            assistantMsg.thinking += ev.reasoning_content;
            let details = row.querySelector('.thinking-block');
            if (!details) {
              details = document.createElement('details');
              details.className = 'thinking-block';
              details.open = true;
              details.innerHTML = `<summary class="thinking-summary">🧠 Reasoning & Process…</summary><div class="thinking-content"></div>`;
              contentWrap.prepend(details);
            }
            thinkingContentEl = details.querySelector('.thinking-content');
            thinkingContentEl.textContent = assistantMsg.thinking;
            scrollChatToBottom();
          }

          // Delta text
          else if (ev.delta) {
            removeTypingIndicator(contentWrap);
            let chunk = ev.delta;
            if (chunk.includes('<think>') || chunk.includes('</think>')) {
              chunk = chunk.replace(/<\/?think>/gi, '');
            }
            assistantMsg.text += chunk;

            if (isTaskCompletionText(assistantMsg.text)) {
              taskCompleted = true;
            }

            // Auto-collapse thinking details when real answer starts streaming
            const details = row.querySelector('.thinking-block');
            if (details && details.open) {
              details.open = false;
              const words = assistantMsg.thinking.trim().split(/\s+/).filter(Boolean).length;
              const sum = details.querySelector('.thinking-summary');
              if (sum) sum.textContent = `🧠 Thought Process (${words} words · click to view)`;
            }

            const cleanText = cleanChatText(assistantMsg.text);
            if (cleanText) {
              if (!bubbleEl) {
                bubbleEl = document.createElement('div');
                bubbleEl.className = 'bubble';
                contentWrap.appendChild(bubbleEl);
              }
              bubbleEl.innerHTML = formatMarkdown(cleanText);
              bubbleEl.style.display = 'block';
            } else if (bubbleEl) {
              bubbleEl.style.display = 'none';
            }
            scrollChatToBottom();
          }

          // Final response text
          else if (ev.final_text) {
            removeTypingIndicator(contentWrap);
            let finalClean = ev.final_text;
            if (finalClean.includes('<think>')) {
              const m = finalClean.match(/<think>([\s\S]*?)<\/think>/i);
              if (m) {
                if (!assistantMsg.thinking) assistantMsg.thinking = m[1].trim();
                finalClean = finalClean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
              }
            }
            assistantMsg.text = finalClean;
            if (isTaskCompletionText(assistantMsg.text)) {
              taskCompleted = true;
            }
            const details = row.querySelector('.thinking-block');
            if (details) {
              details.open = false;
              const words = assistantMsg.thinking.trim().split(/\s+/).filter(Boolean).length;
              const sum = details.querySelector('.thinking-summary');
              if (sum) sum.textContent = `🧠 Thought Process (${words} words · click to view)`;
            }
            const cleanText = cleanChatText(assistantMsg.text);
            if (cleanText) {
              if (!bubbleEl) {
                bubbleEl = document.createElement('div');
                bubbleEl.className = 'bubble';
                contentWrap.appendChild(bubbleEl);
              }
              bubbleEl.innerHTML = formatMarkdown(cleanText);
              bubbleEl.style.display = 'block';
            } else if (bubbleEl) {
              bubbleEl.style.display = 'none';
            }
            scrollChatToBottom();
          }

          // Automatic Tool Call started (Real-time progress notification)
          else if (ev.event === 'tool.intent' || ev.event === 'tool.call') {
            removeTypingIndicator(contentWrap);
            const toolId = ev.callId || streamToolCardMap[ev.tool] || `sse-${ev.tool}-${Date.now()}`;
            streamToolCardMap[ev.tool] = toolId;
            addTrace('Tool Invoked', `${ev.tool}: ${JSON.stringify(ev.args || '')}`, '⚙');
            createOrGetToolCard(toolId, ev.tool, ev.args, contentWrap);

            if (!assistantMsg.toolsExecuted) assistantMsg.toolsExecuted = [];
            let t = assistantMsg.toolsExecuted.find(x => x.callId === toolId || (x.tool === ev.tool && !x.result));
            if (!t) {
              t = { callId: toolId, tool: ev.tool, args: ev.args || {}, result: null };
              assistantMsg.toolsExecuted.push(t);
            } else {
              t.args = ev.args || t.args;
            }
            assistantMsg.tool = ev.tool;
            assistantMsg.toolArgs = ev.args || {};

            scrollChatToBottom();
          }

          // Tool Result (Finished execution)
          else if (ev.event === 'tool.result') {
            removeTypingIndicator(contentWrap);
            const toolId = ev.callId || streamToolCardMap[ev.tool] || `sse-${ev.tool}-${Date.now()}`;
            streamToolCardMap[ev.tool] = toolId;
            addTrace('Tool Completed', `${ev.tool} finished`, '✓');
            finishToolCard(toolId, ev.tool, ev.result || ev.output || ev, Boolean(ev.error));

            if (!assistantMsg.toolsExecuted) assistantMsg.toolsExecuted = [];
            let t = assistantMsg.toolsExecuted.find(x => x.callId === toolId || (x.tool === ev.tool && !x.result));
            if (!t) {
              t = { callId: toolId, tool: ev.tool, args: ev.args || {}, result: null };
              assistantMsg.toolsExecuted.push(t);
            }
            t.result = ev.result || ev.output || ev;
            assistantMsg.toolResult = ev.result || ev.output || ev;

            refreshWorkspaceFiles();
            scrollChatToBottom();
          }

          // Sensitive Action Approval Requested (1-time human gate)
          else if (ev.event === 'approval.requested') {
            removeTypingIndicator(contentWrap);
            addTrace('Approval Gate', ev.reason || 'Approval required', '🛡️');
            assistantMsg.approval = { reason: ev.reason, approvalId: ev.approvalId, decided: false };
            let card = (ev.approvalId ? contentWrap.querySelector(`.approval-card[data-approval-id="${escapeHtml(ev.approvalId)}"]`) : null) || contentWrap.querySelector('.approval-card');
            if (!card) {
              card = document.createElement('div');
              card.className = 'approval-card';
              if (ev.approvalId) card.setAttribute('data-approval-id', ev.approvalId);
              contentWrap.appendChild(card);
            } else {
              if (ev.approvalId) card.setAttribute('data-approval-id', ev.approvalId);
              card.classList.remove('decided');
            }
            card.innerHTML = `
              <div class="approval-header">
                <span>🛡️</span>
                <span>Human Approval Gate</span>
              </div>
              <p class="approval-msg">${escapeHtml(ev.reason)}</p>
              <div class="approval-actions-row">
                <button class="btn-approve" onclick="handleInlineDecision(this, true, null, '${escapeHtml(ev.approvalId || '')}')">✓ Approve & Execute</button>
                <button class="btn-reject" onclick="handleInlineDecision(this, false, null, '${escapeHtml(ev.approvalId || '')}')">✕ Reject</button>
              </div>
            `;
            scrollChatToBottom();
          }

          // Status Mode message
          else if (ev.event === 'status' && ev.message) {
            addTrace('Harness Status', ev.message, 'ℹ');
          }
        } catch (err) {
          // ignore malformed lines
        }
      }
    }

    assistantMsg.streaming = false;
    const details = row.querySelector('.thinking-block');
    if (details) {
      details.open = false;
      const words = assistantMsg.thinking ? assistantMsg.thinking.trim().split(/\s+/).filter(Boolean).length : 0;
      const sum = details.querySelector('.thinking-summary');
      if (sum) sum.textContent = `🧠 Thought Process (${words} words · click to view)`;
    }

    if (!assistantMsg.text.trim() && assistantMsg.thinking) {
      assistantMsg.text = "I have analyzed your request and workspace context. Let me know how you'd like to proceed.";
      if (!bubbleEl) {
        bubbleEl = document.createElement('div');
        bubbleEl.className = 'bubble';
        contentWrap.appendChild(bubbleEl);
      }
      bubbleEl.innerHTML = formatMarkdown(assistantMsg.text);
    }

    // Check if AI model outputted an inline JSON tool call:
    // e.g. {"tool": "execute_bash", "parameters": {"command": "ls"}}
    const inlineToolMatch = assistantMsg.text.match(/\{\s*"tool"\s*:\s*"([a-zA-Z0-9_-]+)"\s*,\s*"parameters"\s*:\s*(\{[\s\S]*?\})\s*\}/);
    if (inlineToolMatch && !assistantMsg.approval) {
      const toolName = inlineToolMatch[1];
      let toolArgs = {};
      try { toolArgs = JSON.parse(inlineToolMatch[2]); } catch (e) { toolArgs = {}; }

      // Deduplicate: If SSE already created/handled this tool call, do not create a duplicate card!
      if (!streamToolCardMap[toolName]) {
        const autoToolId = 'auto-' + Math.random().toString(36).slice(2, 8);
        streamToolCardMap[toolName] = autoToolId;
        addTrace('Agent Tool Execution', `Executing: ${toolName}`, '⚙');
        createOrGetToolCard(autoToolId, toolName, toolArgs, contentWrap);

        try {
          const execRes = await fetch('/execute', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tool_name: toolName, arguments: toolArgs })
          });
          const execData = await execRes.json();

          if (execData.status === 'needs_approval') {
            // File deletion approval gate
            finishToolCard(autoToolId, toolName, { status: 'waiting_for_approval', message: execData.message }, false);
            assistantMsg.approval = { reason: execData.reason, approvalId: execData.approvalId, decided: false };
            let card = document.createElement('div');
            card.className = 'approval-card';
            if (execData.approvalId) card.setAttribute('data-approval-id', execData.approvalId);
            card.innerHTML = `
              <div class="approval-header">
                <span>🛡️</span>
                <span>Human Approval Gate</span>
              </div>
              <p class="approval-msg">${escapeHtml(execData.reason)}</p>
              <div class="approval-actions-row">
                <button class="btn-approve" onclick="handleInlineDecision(this, true, null, '${escapeHtml(execData.approvalId || '')}')">✓ Approve & Execute</button>
                <button class="btn-reject" onclick="handleInlineDecision(this, false, null, '${escapeHtml(execData.approvalId || '')}')">✕ Reject</button>
              </div>
            `;
            contentWrap.appendChild(card);
            scrollChatToBottom();
            return;
          }

          finishToolCard(autoToolId, toolName, execData.output || execData.result || execData, !execData.ok && execData.status !== 'success');
          assistantMsg.tool = toolName;
          assistantMsg.toolArgs = toolArgs;
          assistantMsg.toolResult = execData.output || execData.result || execData;
          refreshWorkspaceFiles();

          // Non-stop autonomous loop: feed output directly into next turn!
          const nextPrompt = `[TOOL RESULT FOR ${toolName}]:\n${typeof execData === 'string' ? execData : JSON.stringify(execData, null, 2)}\nProceed with next steps. If all tasks are 100% complete, emit [TASK_COMPLETE] and summary.`;
          addTrace('Autonomous Continuation', `Feeding tool output to agent…`, '🔄');
          setTimeout(() => {
            submitChat(nextPrompt, { isAutonomousFollowUp: true, stepCount: Number(options.stepCount || 0) + 1 });
          }, 450);
          return;
        } catch (err) {
          finishToolCard(autoToolId, toolName, { error: err.message }, true);
        }
      }
    }

    // Show task completion badge if model declared completion
    const isDone = Boolean(taskCompleted || isTaskCompletionText(assistantMsg.text));
    if (isDone) {
      assistantMsg.taskCompleted = true;
      let badge = contentWrap.querySelector('.task-complete-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'task-complete-badge';
        badge.innerHTML = `<span>✓</span><span>Task Verified Complete · Stopped</span>`;
        contentWrap.appendChild(badge);
      }
      addTrace('Task Complete', 'Agent verified all tasks complete and stopped', '✓');
    }

    if (!currentSession) {
      currentSession = sessions[0] || { id: activeRunId, title: 'Active Chat', messages: [], timestamp: Date.now() };
    }
    if (!Array.isArray(currentSession.messages)) {
      currentSession.messages = [];
    }
    currentSession.messages.push(assistantMsg);
    localStorage.setItem('claritySessions', JSON.stringify(sessions));
    addTrace('Turn Completed', 'Agent returned response', '✓');

    // If autonomous follow-up loop was in progress, but not complete yet and no pending approval:
    const stepCount = Number(options.stepCount || 0);
    if (!isDone && !assistantMsg.approval && isAutonomous && stepCount < 8) {
      addTrace('Autonomous Loop Resumed', `Continuing execution until task is complete (step ${stepCount + 1})…`, '🔄');
      setTimeout(() => {
        submitChat('[Autonomous Continuation]: Previous step processed. Review history and proceed with remaining actions. If and only if all user requirements are 100% complete, emit [TASK_COMPLETE] and summarize.', {
          isAutonomousFollowUp: true,
          stepCount: stepCount + 1
        });
      }, 400);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      assistantMsg.text += '\n\n*(Agent stopped by user)*';
      if (!bubbleEl) {
        bubbleEl = document.createElement('div');
        bubbleEl.className = 'bubble';
        contentWrap.appendChild(bubbleEl);
      }
      bubbleEl.innerHTML = formatMarkdown(assistantMsg.text);
      addTrace('Turn Aborted', 'Execution halted by user request', '⏹');
    } else {
      assistantMsg.text += `\n⚠ Error: ${err.message}`;
      if (!bubbleEl) {
        bubbleEl = document.createElement('div');
        bubbleEl.className = 'bubble';
        contentWrap.appendChild(bubbleEl);
      }
      bubbleEl.innerHTML = formatMarkdown(assistantMsg.text);
      addTrace('Turn Failed', err.message, '!');
    }
  } finally {
    setGeneratingState(false);
    activeAbortController = null;
    scrollChatToBottom();
  }
}

// Composer submit & keydown
$('composerForm').onsubmit = (e) => {
  e.preventDefault();
  if (isGenerating) {
    stopCurrentGeneration();
    return;
  }
  submitChat($('composerInput').value);
};

$('btnSend').onclick = (e) => {
  if (isGenerating) {
    e.preventDefault();
    stopCurrentGeneration();
  }
};

$('composerInput').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitChat($('composerInput').value);
  }
};

// Auto-expand textarea
$('composerInput').oninput = function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 180) + 'px';
};

// Starter suggestions
document.querySelectorAll('.starter-card').forEach(card => {
  card.onclick = () => {
    const prompt = card.getAttribute('data-prompt');
    if (prompt) submitChat(prompt);
  };
});

// ---------- STATUS REFRESH ----------
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const d = await res.json();
    const dot = $('statusDot');
    const title = $('statusTitle');
    const subtitle = $('statusSubtitle');
    const topBadge = $('topModeBadge');
    const topText = $('topModeText');

    if (d && d.ok) {
      dot.className = 'pulse-dot';
      title.textContent = 'Gemini Engine';
      subtitle.textContent = 'Gemini AI Ready';
      topBadge.className = 'pill-badge';
      topText.textContent = 'Gemini AI Ready';
    }
  } catch (e) {
    $('statusSubtitle').textContent = 'Connecting…';
  }
}
checkHealth();
setInterval(checkHealth, 15000);

// ---------- DRAWER & MODAL CONTROLLERS ----------
// Trace Drawer
function openTrace() {
  $('traceDrawer').classList.add('open');
  $('drawerBackdrop').classList.add('show');
}
function closeTrace() {
  $('traceDrawer').classList.remove('open');
  $('drawerBackdrop').classList.remove('show');
}
$('btnOpenTrace').onclick = openTrace;
$('btnCloseTrace').onclick = closeTrace;
$('drawerBackdrop').onclick = closeTrace;

// Sidebar toggle (desktop & mobile)
function openMobileSidebar() {
  const sb = $('sidebar');
  const bd = $('sidebarBackdrop');
  if (!sb) return;
  sb.classList.remove('collapsed');
  sb.classList.add('open-mobile');
  if (bd) bd.classList.add('show');
}

function closeMobileSidebar() {
  const sb = $('sidebar');
  const bd = $('sidebarBackdrop');
  if (sb) sb.classList.remove('open-mobile');
  if (bd) bd.classList.remove('show');
}

function handleSidebarToggle(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const isMobile = window.innerWidth <= 768;
  const sb = $('sidebar');
  if (!sb) return;
  if (isMobile) {
    if (sb.classList.contains('open-mobile')) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  } else {
    sb.classList.toggle('collapsed');
  }
}

const menuBtn = $('mobileMenuBtn');
if (menuBtn) {
  menuBtn.onclick = handleSidebarToggle;
}

const sbToggle = $('sidebarToggle');
if (sbToggle) {
  sbToggle.onclick = (e) => {
    if (e) e.stopPropagation();
    if (window.innerWidth <= 768) {
      closeMobileSidebar();
    } else {
      $('sidebar').classList.toggle('collapsed');
    }
  };
}

const sbBackdrop = $('sidebarBackdrop');
if (sbBackdrop) {
  sbBackdrop.onclick = (e) => {
    if (e) e.preventDefault();
    closeMobileSidebar();
  };
}

// Settings Modal
function openSettings() {
  $('settingsModal').classList.add('open');
  $('selectProvider').value = localStorage.getItem('clarityProvider') || 'gemini';
  $('inputApiKey').value = localStorage.getItem('clarityApiKey') || '';
  $('inputModel').value = localStorage.getItem('clarityModel') || 'gemini-3.7-flash';
}
$('btnOpenSettings').onclick = openSettings;
$('topBtnSettings').onclick = openSettings;
$('btnCloseSettings').onclick = () => $('settingsModal').classList.remove('open');
$('btnToggleKey').onclick = () => {
  const el = $('inputApiKey');
  el.type = el.type === 'password' ? 'text' : 'password';
};

$('btnSaveSettings').onclick = () => {
  localStorage.setItem('clarityProvider', $('selectProvider').value);
  localStorage.setItem('clarityApiKey', $('inputApiKey').value);
  localStorage.setItem('clarityModel', $('inputModel').value);
  $('settingsModal').classList.remove('open');
  showToast('Connection settings saved');
  addTrace('Settings Updated', `Provider: ${$('selectProvider').value}`, '⚙');
};

$('btnDiscoverModels').onclick = async () => {
  const provider = $('selectProvider').value;
  const apiKey = $('inputApiKey').value;
  const status = $('discoverStatus');
  const select = $('discoveredModelsSelect');
  status.textContent = 'Discovering models via provider API...';
  select.style.display = 'none';

  try {
    const res = await fetch('/api/providers/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey })
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error);

    select.innerHTML = d.models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    select.style.display = d.models.length ? 'block' : 'none';
    status.textContent = `${d.models.length} models discovered.`;
    select.onchange = () => { $('inputModel').value = select.value; };
    if (d.models.length && !$('inputModel').value) $('inputModel').value = d.models[0];
  } catch (e) {
    status.textContent = `Discovery error: ${e.message}`;
  }
};

// Tools Modal & File Management
function openTools() {
  $('toolsModal').classList.add('open');
  refreshWorkspaceFiles();
}
$('btnOpenTools').onclick = openTools;
$('topBtnTools').onclick = openTools;
$('btnCloseTools').onclick = () => $('toolsModal').classList.remove('open');

async function refreshWorkspaceFiles() {
  const container = $('workspaceFilesContainer');
  try {
    const res = await fetch('/api/ws/list');
    const d = await res.json();
    if (!d.ok) {
      container.textContent = `Error: ${d.error}`;
      return;
    }
    if (!d.files.length) {
      container.innerHTML = '<i>Workspace is empty. Create a file or upload files below.</i>';
      return;
    }
    container.innerHTML = d.files.map(f => {
      const isImg = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name);
      const thumb = isImg ? `<img src="/uploads/${encodeURIComponent(f.name.replace(/^uploads\//, ''))}" style="width:28px;height:28px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:6px">` : '📄 ';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
          <span>${thumb} <b>${escapeHtml(f.name)}</b> <small style="color:var(--muted)">(${f.size} B)</small></span>
          <a href="/api/ws/download?path=${encodeURIComponent(f.name)}" style="color:var(--green);font-weight:600;font-size:12px;text-decoration:none">Download</a>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.textContent = `Failed to load files: ${e.message}`;
  }
}

$('toolBtnRefresh').onclick = refreshWorkspaceFiles;

$('toolBtnZip').onclick = async () => {
  $('toolsModal').classList.remove('open');
  submitChat('zip workspace');
};

$('toolBtnSample').onclick = async () => {
  $('toolsModal').classList.remove('open');
  submitChat('create file notes/welcome.md with # Welcome to Clarity\n\nAutonomous agent harness powered by Google Gemini AI.');
};

$('toolBtnDel').onclick = async () => {
  const p = prompt('Enter filename to delete (e.g. notes/welcome.md):');
  if (p) {
    $('toolsModal').classList.remove('open');
    submitChat(`delete file ${p}`);
  }
};

$('toolBtnRunCmd').onclick = async () => {
  const cmd = $('toolSandboxInput').value.trim();
  if (!cmd) return;
  const outEl = $('toolSandboxOut');
  outEl.style.display = 'block';
  outEl.textContent = `$ ${cmd}\nRunning...`;
  try {
    const res = await fetch('/api/ws/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd })
    });
    const d = await res.json();
    outEl.textContent = d.ok ? `$ ${cmd}\n${d.output}` : `$ ${cmd}\nError: ${d.error}`;
    addTrace('Sandbox Command', cmd, d.ok ? '✓' : '!');
  } catch (e) {
    outEl.textContent = `Execution failed: ${e.message}`;
  }
};

// File Upload Drag & Drop
const dropZone = $('dropZone');
const fileInput = $('fileInputEl');
$('btnUploadTrigger').onclick = () => fileInput.click();
dropZone.onclick = () => fileInput.click();

fileInput.onchange = async () => {
  await uploadFiles(fileInput.files);
  fileInput.value = '';
};

['dragover', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => e.preventDefault()));
dropZone.addEventListener('drop', async (e) => {
  await uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const files = [];
  for (const f of fileList) {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
    }
    files.push({ name: f.name, base64: btoa(bin) });
  }

  addTrace('Uploading Files', `${files.length} file(s) to uploads/`, '↗');
  try {
    const res = await fetch('/api/ws/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files })
    });
    const d = await res.json();
    if (d.ok) {
      showToast(`Uploaded ${d.files.length} file(s)`);
      addTrace('Upload Completed', `${d.files.length} files stored`, '✓');
      refreshWorkspaceFiles();
      submitChat(`I uploaded ${d.files.map(x => x.name).join(', ')} to uploads/. Inspect and summarize them.`);
    } else {
      showToast(`Upload failed: ${d.error}`);
    }
  } catch (e) {
    showToast(`Upload error: ${e.message}`);
  }
}

// Docs Modal
$('btnOpenDocs').onclick = () => $('docsModal').classList.add('open');
$('btnCloseDocs').onclick = () => $('docsModal').classList.remove('open');
$('btnDismissDocs').onclick = () => $('docsModal').classList.remove('open');

// Initial boot
renderSessionList();
renderMessages();
</script>
