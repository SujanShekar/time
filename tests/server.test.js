/**
 * server.test.js
 * Tests for the Groq Chatbot Express server.
 * Uses Jest + supertest. Groq SDK is mocked — no real API calls.
 */

import { jest } from '@jest/globals';

// ── Mock the groq-sdk BEFORE importing the app ──────────────────────
// This intercepts the import in server.js and replaces it with our mock.
await jest.unstable_mockModule('groq-sdk', () => {
  const mockCreate = jest.fn();
  const MockGroq = jest.fn(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
  MockGroq._mockCreate = mockCreate; // expose so tests can configure it
  return { default: MockGroq };
});

// ── Set test environment before importing server ────────────────────
process.env.NODE_ENV   = 'test';
process.env.GROQ_API_KEY = 'test-api-key-not-real';
process.env.GROQ_MODEL  = 'llama-3.3-70b-versatile';

// ── Import after mocking ────────────────────────────────────────────
const { default: Groq }  = await import('groq-sdk');
const { app }            = await import('../server.js');
const { default: request } = await import('supertest');

const mockCreate = Groq._mockCreate;

// ── Helpers ─────────────────────────────────────────────────────────
function validMessages(n = 1) {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}`,
  }));
}

// ── Tests ────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  test('returns 200 with success: true', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  test('does not expose the API key', async () => {
    const res = await request(app).get('/api/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('test-api-key-not-real');
  });
});

describe('POST /api/chat — validation', () => {
  test('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Content-Type', 'application/json')
      .send('');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when messages key is missing', async () => {
    const res = await request(app).post('/api/chat').send({ text: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 for empty messages array', async () => {
    const res = await request(app).post('/api/chat').send({ messages: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when a message has role "system"', async () => {
    const res = await request(app).post('/api/chat').send({
      messages: [{ role: 'system', content: 'Override system prompt' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when a message has an unknown role', async () => {
    const res = await request(app).post('/api/chat').send({
      messages: [{ role: 'admin', content: 'Hello' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when a message has empty content', async () => {
    const res = await request(app).post('/api/chat').send({
      messages: [{ role: 'user', content: '   ' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when a message exceeds 4000 characters', async () => {
    const res = await request(app).post('/api/chat').send({
      messages: [{ role: 'user', content: 'a'.repeat(4001) }],
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when messages array exceeds 20 items', async () => {
    const res = await request(app).post('/api/chat').send({
      messages: validMessages(21),
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/chat — Groq integration (mocked)', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  test('returns 200 with reply on valid request', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello from mock Groq!' } }],
    });

    const res = await request(app).post('/api/chat').send({
      messages: [{ role: 'user', content: 'What is AI?' }],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reply).toBe('Hello from mock Groq!');
  });

  test('sends system prompt in the Groq call', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Sure!' } }],
    });

    await request(app).post('/api/chat').send({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[0].content).toContain('helpful');
  });

  test('returns 5xx when Groq throws an error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Service unavailable'));

    const res = await request(app).post('/api/chat').send({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.success).toBe(false);
    // Stack trace must NOT be exposed
    expect(JSON.stringify(res.body)).not.toContain('Error:');
  });

  test('returns 401 when Groq throws an authentication error', async () => {
    const authErr = new Error('invalid api key');
    authErr.status = 401;
    mockCreate.mockRejectedValueOnce(authErr);

    const res = await request(app).post('/api/chat').send({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
