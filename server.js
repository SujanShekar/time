import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';
import Groq from 'groq-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;
const GROQ_TIMEOUT_MS = 30000;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

const SYSTEM_PROMPT =
  'You are a helpful, friendly AI assistant. Answer questions clearly and ' +
  'accurately using simple language when appropriate. Explain technical topics ' +
  'step by step when useful. If you do not know an answer, say so rather than ' +
  'inventing facts. Format responses using readable Markdown when appropriate. ' +
  'Do not claim to have accessed the internet or external systems unless that ' +
  'capability is actually available.';

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.static(join(__dirname, 'public')));

// Rate limiter: 30 requests per 15 minutes per IP
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a few minutes and try again.' },
});

// ── Helpers ────────────────────────────────────────────────────────────────
function safeError(code, message) {
  return { success: false, error: message, code };
}

function groqErrorToResponse(err, res) {
  const msg = err?.message || '';

  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
    return res.status(503).json(safeError('no_api_key', 'API key is not configured. Please set GROQ_API_KEY in your .env file.'));
  }
  if (err?.status === 401 || msg.toLowerCase().includes('invalid api key') || msg.toLowerCase().includes('authentication')) {
    return res.status(401).json(safeError('invalid_api_key', 'Invalid API key. Please check your GROQ_API_KEY in the .env file.'));
  }
  if (err?.status === 429 || msg.toLowerCase().includes('rate limit')) {
    return res.status(429).json(safeError('rate_limit', 'Groq rate limit reached. Please wait a moment and try again.'));
  }
  if (err?.status === 404 || msg.toLowerCase().includes('model') || msg.toLowerCase().includes('not found')) {
    return res.status(400).json(safeError('invalid_model', `Model "${process.env.GROQ_MODEL}" was not found. Please check GROQ_MODEL in your .env file. Available models: qwen/qwen3.8-27b, openai/gpt-oss-20b, openai/gpt-oss-120b, allam-2-7b`));
  }
  if (err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || msg.toLowerCase().includes('timeout')) {
    return res.status(504).json(safeError('timeout', 'The request timed out. Please try again.'));
  }

  return res.status(502).json(safeError('groq_error', 'The AI service returned an error. Please try again shortly.'));
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    model: process.env.GROQ_MODEL || 'not configured',
  });
});

// Chat endpoint
app.post('/api/chat', chatLimiter, async (req, res) => {
  // ── Validate request body ──────────────────────────────────────────────
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json(safeError('invalid_body', 'Request body must be valid JSON.'));
  }

  const { messages } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json(safeError('missing_messages', 'messages must be an array.'));
  }
  if (messages.length === 0) {
    return res.status(400).json(safeError('empty_messages', 'messages array must not be empty.'));
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json(safeError('too_many_messages', `A maximum of ${MAX_MESSAGES} messages is allowed per request.`));
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object') {
      return res.status(400).json(safeError('invalid_message', `Message at index ${i} is not a valid object.`));
    }
    if (!ALLOWED_ROLES.has(m.role)) {
      return res.status(400).json(safeError('invalid_role', `Invalid role "${m.role}" at index ${i}. Only "user" and "assistant" are allowed.`));
    }
    if (typeof m.content !== 'string' || m.content.trim().length === 0) {
      return res.status(400).json(safeError('empty_content', `Message content at index ${i} must be a non-empty string.`));
    }
    if (m.content.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json(safeError('message_too_long', `Message at index ${i} exceeds the ${MAX_MESSAGE_LENGTH} character limit.`));
    }
  }

  // ── Check API key ──────────────────────────────────────────────────────
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
    return res.status(503).json(safeError('no_api_key', 'API key is not configured. Please set GROQ_API_KEY in your .env file.'));
  }

  // ── Build messages with server-side system prompt ──────────────────────
  const groqMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content.trim() })),
  ];

  // ── Call Groq ──────────────────────────────────────────────────────────
  try {
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
      timeout: GROQ_TIMEOUT_MS,
    });

    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    const completion = await groq.chat.completions.create({
      model,
      messages: groqMessages,
      max_tokens: 1024,
      temperature: 0.7,
    });

    const message = completion?.choices?.[0]?.message;
    // Some Groq models (reasoning models) put their output in `reasoning`
    // instead of `content`. Fall back gracefully.
    const reply = message?.content || message?.reasoning;

    if (!reply) {
      return res.status(502).json(safeError('empty_reply', 'The AI returned an empty response. Please try again.'));
    }

    return res.json({ success: true, reply });
  } catch (err) {
    return groqErrorToResponse(err, res);
  }
});

// SPA fallback — serve index.html for all non-API GET routes
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── Start server (skip in test mode) ──────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Groq Chatbot running at http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   Press Ctrl+C to stop\n`);
  });
}

export { app };
