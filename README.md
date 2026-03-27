# SusuOnX

AI-powered yield agent for X Layer. Chat with your personal DeFi advisor to discover, analyze, and execute yield strategies — without touching complex interfaces.

Built on OKX Agentic Wallet, integrated with Uniswap V3 on X Layer, powered by AI agents with configurable risk personas.

## Features

- **AI Yield Advisor** — Natural language chat interface to explore yield strategies tailored to your goals
- **Risk-Based Personas** — Configure your risk tolerance; the AI adapts its recommendations accordingly
- **One-Click Deposits** — Execute strategy deposits directly through chat using the OKX Agentic Wallet
- **Multi-Token Support** — USDT, USDC, OKB, WOKB, xBTC on X Layer
- **Real-Time Portfolio** — Track your active positions and returns

## Architecture

```
src/
├── app/
│   ├── api/           # API routes (chat, wallet, strategies, DeFi)
│   ├── dashboard/     # Main dashboard UI
│   └── page.tsx       # Landing page
├── components/
│   ├── views/         # Page-level view components
│   └── ui/            # Shared UI components
├── lib/
│   ├── okx-server.ts   # OKX Agentic Wallet server-side signing
│   ├── okx-crypto.ts    # Ed25519 signing & HPKE encryption
│   ├── strategies.ts    # X Layer yield strategies & token definitions
│   └── uniswap.ts       # Uniswap V3 liquidity pool utilities
└── providers/
    └── app-provider.tsx # App-wide state management
```

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **AI**: Vercel AI SDK + OpenAI
- **Wallet**: OKX Agentic Wallet (Ed25519 + HPKE)
- **Database**: PostgreSQL + Prisma
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Animations**: Framer Motion
- **Chain**: X Layer (chain index 196)

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- OKX Developer account (for Agentic Wallet API)

### Environment Variables

Copy `.env.local.example` to `.env` and configure:

```bash
DATABASE_URL=           # PostgreSQL connection string
OPENAI_API_KEY=         # OpenAI API key for AI chat
OKX_CLIENT_ID=          # OKX app client ID
OKX_CLIENT_SECRET=      # OKX app client secret
```

### Installation

```bash
npm install
npm run build           # Generates Prisma client + Next.js build
npm run dev             # Start development server
```

Open [http://localhost:3000](http://localhost:3000) to access the app.

## Yield Strategies

| Strategy | Protocol | Risk | APY | Token |
|----------|----------|------|-----|-------|
| USDT/OKB LP | Uniswap V3 | Medium | ~9.8% | USDT |
| USDC/OKB LP | Uniswap V3 | Medium | ~7.2% | USDC |
| USDT/xBTC LP | Uniswap V3 | High | ~12.5% | USDT |

Strategies are managed via the OKX DeFi API with deposits handled through the OKX Agentic Wallet.

## Key Dependencies

- `@ai-sdk/react` — AI chat UI hooks
- `@noble/curves`, `@noble/hashes` — Cryptographic signing (Ed25519)
- `hpke-js` — HPKE encryption for session keys
- `ethers` — Ethereum utilities
- `qrcode.react` — Wallet QR code display
