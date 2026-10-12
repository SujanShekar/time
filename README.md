# Groq AI Chatbot

A simple, fast AI chatbot built with Node.js, Express, and the Groq API.  
Ask it anything — explanations, code help, ideas, and more.

---

## Features

- 💬 Real-time chat with conversation history (per session)
- ⚡ Fast responses powered by Groq's LPU hardware
- 📱 Responsive — works on mobile, tablet, and desktop
- 📋 Copy any assistant response with one click
- 🔁 Retry button when a request fails
- 🛡️ Input validation and rate limiting on the server
- 🚀 Ready to deploy to Render

---

## Tech stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Frontend  | HTML5, CSS3, Vanilla JavaScript   |
| Backend   | Node.js, Express.js (ES modules)  |
| AI        | Groq API via `groq-sdk`           |
| Dev tool  | nodemon                           |
| Tests     | Jest + supertest                  |

---

## Folder structure

```
groq-chatbot/
├── public/
│   ├── index.html   ← the chat UI
│   ├── style.css    ← all styles
│   └── script.js    ← frontend logic
├── server.js        ← Express + Groq integration
├── tests/
│   └── server.test.js
├── package.json
├── .env             ← your secrets (gitignored)
├── .env.example     ← template (committed to Git)
├── .gitignore
└── README.md
```

---

## Prerequisites

- **Node.js LTS** (v18 or later) — download from https://nodejs.org
- **Git** — download from https://git-scm.com
- A **Groq API key** — free from https://console.groq.com

---

## Installation

### 1. Open the project in Kiro (or any terminal)

Open this folder in Kiro IDE. Then open the integrated terminal:  
**View → Terminal** or press `` Ctrl+` ``

### 2. Install dependencies

Run this in the project folder:

```bash
npm install
```

### 3. Get a Groq API key

1. Go to https://console.groq.com
2. Sign up or log in.
3. Click **API Keys** → **Create API Key**.
4. Copy the key (you only see it once).

### 4. Create your `.env` file

The `.env` file already exists with a placeholder. Open it and replace the placeholder:

```
GROQ_API_KEY=gsk_your_real_key_here
GROQ_MODEL=llama-3.3-70b-versatile
PORT=3000
NODE_ENV=development
```

> **Important:** Never share `.env` or commit it to Git.

### 5. Start the development server

```bash
npm run dev
```

You will see:

```
🚀 Groq Chatbot running at http://localhost:3000
   Health check: http://localhost:3000/api/health
   Press Ctrl+C to stop
```

### 6. Open the app

Visit **http://localhost:3000** in your browser.

### 7. Stop the server

Press **Ctrl+C** in the terminal.

---

## Available commands

| Command       | What it does                          |
|---------------|---------------------------------------|
| `npm run dev` | Start with auto-reload (development)  |
| `npm start`   | Start without auto-reload (production)|
| `npm test`    | Run the test suite                    |

---

## Changing the Groq model

Edit `GROQ_MODEL` in your `.env` file. Currently available production models:

| Model ID                    | Speed     | Notes                  |
|-----------------------------|-----------|------------------------|
| `llama-3.3-70b-versatile`   | 280 T/s   | Best quality (default) |
| `llama-3.1-8b-instant`      | 560 T/s   | Faster, lighter        |
| `openai/gpt-oss-20b`        | 1000 T/s  | Pay-per-token          |
| `openai/gpt-oss-120b`       | 500 T/s   | Pay-per-token, largest |

Check https://console.groq.com/docs/models for the latest list.

---

## How it works (simple explanation)

```
Browser (index.html + script.js)
    │
    │  POST /api/chat  { messages: [...] }
    ▼
Express server (server.js)
    │  validates input
    │  adds system prompt
    │  calls Groq API
    ▼
Groq Cloud (LPU inference)
    │  returns generated text
    ▼
Express server
    │  returns { success: true, reply: "..." }
    ▼
Browser
    renders assistant bubble
```

Your API key stays on the server. The browser never sees it.

---

## Testing

```bash
npm test
```

Tests use Jest and supertest. The Groq SDK is mocked — no API key needed, no credits consumed.

---

## GitHub setup (step by step)

### 1. Check Git is installed

```bash
git --version
```

### 2. Configure your name and email (first time only)

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### 3. Initialise a repository (if not already done)

```bash
git init
git branch -M main
```

### 4. Create a repository on GitHub

Go to https://github.com/new, give it a name (e.g. `groq-chatbot`), set it to public or private, and click **Create repository**. Do **not** add a README or .gitignore on GitHub — you already have them locally.

### 5. Connect and push

Replace the URL with your actual repository URL:

```bash
git remote add origin https://github.com/YOUR_USERNAME/groq-chatbot.git
git add .
git commit -m "Initial Groq chatbot implementation"
git push -u origin main
```

### 6. Verify on GitHub

Open your repository URL — you should see all files except `node_modules/` and `.env`.

### 7. Push future changes

```bash
git add .
git commit -m "Describe what changed"
git push
```

---

## Render deployment (step by step)

> **Note:** Render free services sleep after ~15 minutes of inactivity. The first response after sleeping may take 30–60 seconds. Paid plans keep the service awake.

### 1. Push to GitHub first (see above)

### 2. Sign in to Render

Go to https://render.com and sign in with GitHub.

### 3. Create a new Web Service

- Click **New → Web Service**
- Connect your GitHub account if prompted
- Select your `groq-chatbot` repository

### 4. Configure the service

| Setting           | Value              |
|-------------------|--------------------|
| Environment       | Node                |
| Branch            | `main`              |
| Build command     | `npm install`       |
| Start command     | `npm start`         |
| Health check path | `/api/health`       |

### 5. Add environment variables

In the **Environment** section add:

| Key            | Value                        |
|----------------|------------------------------|
| `GROQ_API_KEY` | your real Groq API key       |
| `GROQ_MODEL`   | `llama-3.3-70b-versatile`    |
| `NODE_ENV`     | `production`                 |

Do **not** set `PORT` — Render injects it automatically.

### 6. Deploy

Click **Create Web Service**. Watch the build logs.

### 7. Test the deployment

Once the status shows **Live**:
- Open `https://your-service-name.onrender.com`
- Test a question
- Check `https://your-service-name.onrender.com/api/health`

### 8. Automatic redeployment

Every push to `main` triggers a new deployment automatically.

---

## Security notes

- Your API key is stored only in `.env` (local) or Render's environment settings. It never reaches the browser.
- All user input is validated on the server before being sent to Groq.
- User messages are displayed as plain text (not HTML) to prevent XSS.
- Rate limiting: 30 requests per IP per 15 minutes. This resets on server restarts and is not shared across multiple instances — not enterprise-grade, but suitable for a small public project.
- Request body is limited to 10 KB.

---

## Common errors and fixes

| Error | Fix |
|-------|-----|
| `API key is not configured` | Open `.env` and set a real `GROQ_API_KEY` |
| `Invalid API key` | Check the key in `.env` — copy it again from console.groq.com |
| `Model not found` | Update `GROQ_MODEL` in `.env` to a supported model ID |
| `Port 3000 already in use` | Change `PORT=3001` in `.env`, or kill the other process |
| `Cannot find module 'groq-sdk'` | Run `npm install` |
| `Too many requests` | Wait a few minutes — rate limit applies |
| Render deploy fails | Check build logs; confirm env vars are set in Render dashboard |

---

## License

MIT
