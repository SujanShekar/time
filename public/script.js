/* ── Groq Chatbot — frontend script ──────────────────────────────── */

// ── State ──────────────────────────────────────────────────────────
let messages   = [];   // conversation history { role, content }
let isLoading  = false;
let lastUserMsg = '';  // kept for retry

// ── DOM refs ────────────────────────────────────────────────────────
const messagesArea    = document.getElementById('messages-area');
const welcomeScreen   = document.getElementById('welcome-screen');
const messageInput    = document.getElementById('message-input');
const sendBtn         = document.getElementById('send-btn');
const clearBtn        = document.getElementById('clear-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const statusIndicator = document.getElementById('status-indicator');
const statusText      = document.getElementById('status-text');

// ── Utilities ───────────────────────────────────────────────────────

/** Returns HH:MM string for right now */
function getTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Scroll messages area to the bottom */
function scrollToBottom() {
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

/** Escape HTML to prevent XSS */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Very small Markdown → safe HTML parser.
 * Handles: fenced code blocks, inline code, bold, italic,
 *          headings (# ## ### ####), unordered/ordered lists, paragraphs.
 * All text is HTML-escaped before any replacement so no raw user/model
 * content ever becomes executable HTML.
 */
function parseMarkdown(raw) {
  // 1. Protect fenced code blocks first (extract, escape, restore)
  const codeBlocks = [];
  let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const escaped = escapeHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // 2. Escape remaining HTML
  text = escapeHtml(text);

  // 3. Inline code  `...`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 4. Bold  **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // 5. Italic  *text* or _text_
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // 6. Headings  (## Heading)
  text = text.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  text = text.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 7. Unordered lists  (- item or * item)
  text = text.replace(/^(?:[-*])\s+(.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  // wrap consecutive <li> groups
  text = text.replace(/(<li>[^<]*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // 8. Ordered lists  (1. item)
  text = text.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>[^<]*<\/li>\n?)+/g, (match) => {
    // if already wrapped in <ul>, skip
    return match.startsWith('<ul>') ? match : `<ol>${match}</ol>`;
  });

  // 9. Paragraphs — split on double newlines
  const paragraphs = text.split(/\n{2,}/);
  text = paragraphs.map((para) => {
    para = para.trim();
    if (!para) return '';
    // Don't wrap block elements
    if (/^<(h[1-4]|ul|ol|pre|li)/.test(para)) return para;
    // Convert single newlines inside a paragraph to <br>
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // 10. Restore code blocks
  text = text.replace(/\x00CODE(\d+)\x00/g, (_m, i) => codeBlocks[parseInt(i, 10)]);

  return text;
}

// ── API status check ────────────────────────────────────────────────
async function checkApiStatus() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      statusIndicator.className = 'status-dot online';
      statusText.textContent = 'Online';
    } else {
      throw new Error('not ok');
    }
  } catch {
    statusIndicator.className = 'status-dot offline';
    statusText.textContent = 'Offline';
  }
}

// ── Render a message bubble ─────────────────────────────────────────
/**
 * @param {'user'|'assistant'|'error'} role
 * @param {string} content
 * @param {boolean} [showRetry]
 * @returns {HTMLElement}
 */
function renderMessage(role, content, showRetry = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${role}`;
  wrapper.setAttribute('aria-label', `${role === 'user' ? 'You' : 'Assistant'}: ${content.slice(0, 80)}`);

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';

  if (role === 'user') {
    // User messages: plain text only (XSS safe)
    contentEl.textContent = content;
  } else {
    // Assistant / error: parsed markdown (HTML-escaped inside parser)
    contentEl.innerHTML = parseMarkdown(content);
  }

  bubble.appendChild(contentEl);
  wrapper.appendChild(bubble);

  // Meta row (time + copy for assistant)
  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = getTime();
  meta.appendChild(time);

  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.setAttribute('aria-label', 'Copy response');
    copyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      Copy`;
    copyBtn.addEventListener('click', () => copyText(content, copyBtn));
    meta.appendChild(copyBtn);
  }

  wrapper.appendChild(meta);

  // Retry button for errors
  if (showRetry && lastUserMsg) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = '↺ Retry';
    retryBtn.setAttribute('aria-label', 'Retry last message');
    retryBtn.addEventListener('click', () => {
      wrapper.remove();
      sendMessage(lastUserMsg);
    });
    wrapper.appendChild(retryBtn);
  }

  return wrapper;
}

// ── Copy to clipboard ───────────────────────────────────────────────
async function copyText(text, btn) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for non-HTTPS / older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    const original = btn.innerHTML;
    btn.innerHTML = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('copied');
    }, 2000);
  } catch {
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }
}

// ── Send a message ──────────────────────────────────────────────────
async function sendMessage(content) {
  if (isLoading) return;
  content = content.trim();
  if (!content) return;

  lastUserMsg = content;

  // Hide welcome screen on first message
  if (welcomeScreen) welcomeScreen.style.display = 'none';

  // Add user bubble
  messages.push({ role: 'user', content });
  const userEl = renderMessage('user', content);
  messagesArea.appendChild(userEl);
  scrollToBottom();

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateSendBtn();

  // Show loading
  setLoading(true);
  messagesArea.appendChild(loadingIndicator);
  loadingIndicator.hidden = false;
  scrollToBottom();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Send last 10 messages to keep context bounded
        messages: messages.slice(-10),
      }),
    });

    loadingIndicator.hidden = true;

    const data = await res.json().catch(() => ({ success: false, error: 'Invalid server response.' }));

    if (res.ok && data.success) {
      const reply = data.reply || '(No response)';
      messages.push({ role: 'assistant', content: reply });
      const assistantEl = renderMessage('assistant', reply);
      messagesArea.appendChild(assistantEl);
    } else {
      const errMsg = data.error || `Request failed (${res.status}).`;
      const errEl = renderMessage('error', errMsg, true);
      messagesArea.appendChild(errEl);
      // Remove the failed user message from history so retry works cleanly
      messages.pop();
    }
  } catch (err) {
    loadingIndicator.hidden = true;
    const netErr = 'Network error — please check your connection and try again.';
    const errEl = renderMessage('error', netErr, true);
    messagesArea.appendChild(errEl);
    messages.pop();
  }

  setLoading(false);
  scrollToBottom();
  messageInput.focus();
}

// ── Loading state helper ────────────────────────────────────────────
function setLoading(state) {
  isLoading = state;
  sendBtn.disabled = state || messageInput.value.trim().length === 0;
}

// ── Send button enable/disable ──────────────────────────────────────
function updateSendBtn() {
  sendBtn.disabled = isLoading || messageInput.value.trim().length === 0;
}

// ── Clear chat ──────────────────────────────────────────────────────
function clearChat() {
  messages = [];
  lastUserMsg = '';

  // Remove all messages except the welcome screen
  const children = [...messagesArea.children];
  children.forEach((child) => {
    if (child.id !== 'welcome-screen') child.remove();
  });

  // Move loading indicator back (it may have been appended to messagesArea)
  loadingIndicator.hidden = true;

  // Show welcome screen again
  if (welcomeScreen) welcomeScreen.style.display = '';

  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateSendBtn();
  messageInput.focus();
}

// ── Auto-resize textarea ────────────────────────────────────────────
function autoResize() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// ── Event listeners ─────────────────────────────────────────────────

messageInput.addEventListener('input', () => {
  autoResize();
  updateSendBtn();
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage(messageInput.value);
  }
});

sendBtn.addEventListener('click', () => sendMessage(messageInput.value));

clearBtn.addEventListener('click', clearChat);

// Example prompt buttons
document.querySelectorAll('.example-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt;
    if (prompt) sendMessage(prompt);
  });
});

// ── Init ────────────────────────────────────────────────────────────
checkApiStatus();
messageInput.focus();
