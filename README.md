# Greek Budget Copilot

A budget planning tool for fraternity/sorority treasurers, powered by Cloudflare Workers and AI.

**[Live Demo](https://e497e243.cf-ai-greek-pay-agent.pages.dev/)**

## What It Does

Managing chapter finances is tricky—you're balancing dues, expenses, and member counts while trying to answer questions like "what if we raise dues by $50?" or "can we afford this event?"

This app lets treasurers:
- Set their chapter budget (members, dues per member, expenses)
- Run what-if simulations to see the impact of changes
- Chat with an AI copilot that understands their actual numbers

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────┐
│   Browser   │────▶│  Cloudflare      │────▶│ BudgetManager │
│  (frontend) │     │  Worker (router) │     │ (Durable Obj) │
└─────────────┘     └──────────────────┘     └───────┬───────┘
                                                     │
                                                     ▼
                                            ┌───────────────┐
                                            │  Workers AI   │
                                            │ (Llama 3.3)   │
                                            └───────────────┘
```

## Why These Technologies

**Cloudflare Workers** — The main entry point. Handles routing and CORS. Stateless and runs at the edge, so it's fast globally.

**Durable Objects** — I needed somewhere to store budget state that persists across requests. Durable Objects give me a single-instance stateful backend with built-in storage. The `BudgetManager` class holds the budget data and handles all the business logic.

**Workers AI** — Powers the chat feature. I'm using Llama 3.3 70B to give context-aware responses. The AI sees the stored budget numbers, so when a user asks "is raising dues a good idea?", it can actually reason about their specific situation.

## Getting Started

Prerequisites: Node.js 18+, a Cloudflare account

```bash
# Install dependencies
npm install

# Run locally
npx wrangler dev

# Deploy
npx wrangler deploy
```

The frontend is in `frontend/index.html`. For local testing, open it directly or serve it with any static server.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/budget` | GET | Get current budget and summary |
| `/api/budget` | POST | Save budget `{members, duesPerMember, expenses}` |
| `/api/chat` | POST | Chat with AI `{message}` |
| `/api/simulate` | POST | What-if simulation (partial updates, doesn't save) |

---

Built by Joseph Croney
