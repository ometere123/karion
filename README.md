# Karion

A decentralized prediction market platform built on [GenLayer StudioNet](https://studio.genlayer.com). Users stake tokens on real-world outcomes; the on-chain contract uses AI-powered consensus to resolve markets without manual admin intervention.

**Live**
- Frontend: [karionmarket.vercel.app](https://karionmarket.vercel.app)
- API: [karion-api.fly.dev](https://karion-api.fly.dev)
- Contract: `0x90DEDD8bCef8d0872f746cfb56D15E805747BF24` on StudioNet (chain ID 61999)

---

## How it works

1. Users register and an embedded wallet is created for them (encrypted, stored server-side per user)
2. Users fund their embedded wallet with StudioNet GEN before staking
3. Anyone can suggest a market question — admin reviews and approves it
4. Approved markets go on-chain via the deployer relay account
5. Users stake YES or NO — the stake transaction is signed by and paid from the user's embedded wallet. The deployer is not the economic funder of user bets. Contract positions, payouts, and refunds are all attributed to the user's wallet address
6. At deadline, the sync worker triggers resolution: the contract fetches the resolution URL, applies AI consensus, and sets the outcome (YES / NO / INVALID / UNRESOLVED)
7. Winners claim their proportional share of the pool; the contract handles all payouts

The **contract is the authoritative source of truth** for all financial state. Postgres caches market data for fast reads only.

---

## Stack

| Layer | Technology |
|---|---|
| Smart contract | Python on GenLayer (AI-native EVM-compatible chain) |
| API | Node.js + Express + TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Frontend | Next.js 15 + React 19 + Tailwind CSS 4 |
| Auth | Custom session-based auth (signed JWT in HttpOnly cookie) |
| Email | Brevo SMTP |
| File uploads | UploadThing |
| State | Zustand (client) |

**Production infrastructure**

| Layer | Service |
|---|---|
| API | Fly.io (`karion-api`, London region) |
| Database | Neon Postgres (serverless) |
| Frontend | Vercel |

**Local development**

| Layer | Service |
|---|---|
| Database | Docker Postgres 16 |
| Redis | Docker Redis 7 (available, not yet wired into app code) |

---

## Project structure

```
karion/
├── apps/
│   ├── api/                    # Express API
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── index.ts        # App entry, env validation, route wiring
│   │   │   ├── lib/
│   │   │   │   ├── contract.ts         # All on-chain read/write wrappers
│   │   │   │   ├── genlayer-client.ts  # Deployer client; user-funded and deployer write helpers
│   │   │   │   ├── wallet.ts           # Encrypted per-user wallet management
│   │   │   │   ├── session.ts          # JWT cookie creation and validation
│   │   │   │   ├── crypto.ts           # WEK encrypt/decrypt (AES-256-GCM)
│   │   │   │   ├── email.ts            # Brevo SMTP send helpers
│   │   │   │   ├── resolution.ts       # Resolution trigger and retry logic
│   │   │   │   └── events.ts           # Activity event writers
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts             # Session validation, role guard
│   │   │   │   ├── csrf.ts             # Origin header CSRF check
│   │   │   │   ├── rateLimit.ts        # Per-IP rate limiting
│   │   │   │   └── validate.ts         # Zod request body validation
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts             # Register, login, logout, verify email
│   │   │   │   ├── wallet.ts           # Balance, address, transactions
│   │   │   │   ├── markets.ts          # Market list, detail, stake
│   │   │   │   ├── suggestions.ts      # Submit market suggestions
│   │   │   │   ├── portfolio.ts        # User positions and P&L
│   │   │   │   ├── transactions.ts     # Transaction history
│   │   │   │   ├── activity.ts         # Public activity feed
│   │   │   │   ├── resolution-centre.ts # Markets grouped by resolution state
│   │   │   │   └── admin/
│   │   │   │       ├── suggestions.ts  # Approve/reject suggestions
│   │   │   │       ├── markets.ts      # Create markets, sync, force resolve
│   │   │   │       └── activity.ts     # Admin audit log viewer
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts     # Registration, login, email verification
│   │   │   │   └── wallet.service.ts   # Wallet creation and key derivation
│   │   │   └── workers/
│   │   │       └── market-sync.ts      # Periodic sync: reads contract state into Postgres
│   │   ├── Dockerfile
│   │   ├── fly.toml
│   │   └── tsconfig.json
│   └── web/                    # Next.js frontend
│       └── src/
│           ├── app/            # App Router pages
│           │   ├── markets/    # Market list and detail
│           │   ├── suggest/    # Suggest a market
│           │   ├── portfolio/  # User positions
│           │   ├── resolution-centre/
│           │   ├── admin/      # Admin panel (suggestions, markets, activity)
│           │   ├── login/
│           │   ├── signup/
│           │   └── profile/
│           ├── components/     # Shared UI components
│           ├── lib/
│           │   ├── api.ts      # Typed fetch wrappers for all API calls
│           │   └── store.ts    # Zustand auth store
│           └── types/
├── contracts/
│   └── KarionMarket.py         # GenLayer Python smart contract
├── scripts/
│   └── DEPLOY.md               # Full deployment guide
├── docker-compose.yml          # Local dev: Postgres + Redis
└── package.json                # Monorepo root
```

---

## Contract — KarionMarket.py

Written in Python for the GenLayer runtime. Key design decisions:

- **User-funded embedded wallet staking**: Each user receives an embedded wallet at signup and funds it with StudioNet GEN before staking. YES/NO stake transactions are signed by the user's embedded wallet, and the stake value is paid from that wallet. The backend decrypts and uses the embedded wallet only inside the secure signing flow. The deployer is not the economic funder of user bets; it remains reserved for admin or protocol actions such as market creation, locking, and resolution where needed. Contract state remains the source of truth for pools, positions, outcomes, payouts, and refunds.

  > **StudioNet / mainnet note**: StudioNet gas behaviour may differ from mainnet. The current balance check verifies stake amount, but a production mainnet version should account for stake plus gas.
- **AI resolution**: The contract fetches `resolution_url` and uses GenLayer's equivalence principle (`eq_principle_strict_eq` / `eq_principle_prompt_comparative`) to determine the outcome autonomously.
- **No manual override**: The contract does not expose a function for admin to set outcomes. Resolution is fully deterministic based on the fetched data.
- **Confidence levels**: Post-consensus, the contract sets `HIGH / MEDIUM / LOW` confidence on each resolved market.

Market statuses: `OPEN → LOCKED → RESOLVED / INVALID / UNRESOLVED / CANCELLED`

---

## API — key security properties

- **Fail-fast env validation**: `SESSION_SIGNING_SECRET` and `SYSTEM_RECOVERY_SECRET` are validated as 64-char hex on startup. Server refuses to start if either is missing or malformed.
- **No secret logging**: Private keys, WEK, recovery keys, and encrypted wallet material are never written to logs.
- **CSRF protection**: All state-changing routes check the `Origin` header against `FRONTEND_URL`. The session cookie is `HttpOnly; Secure; SameSite=None` in production (required because Vercel and Fly are different eTLD+1 domains).
- **Audit log**: Every admin write action writes to `admin_audit_logs` with `userId`, `action`, `target`, and `metadata`. All admin write routes require `confirm: true` in the request body.
- **Contract authority**: Postgres never overrides contract values for financial decisions. The sync worker reads from contract → writes to Postgres cache → API reads Postgres for display only. Stakes, balances, and payouts are always resolved on-chain.

---

## Local development

### Prerequisites

- Node.js 22+
- Docker Desktop

### 1. Start local services

```bash
docker compose up -d
```

Postgres on `localhost:5432`, Redis on `localhost:6379`.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy and fill in `apps/api/.env.example` → `apps/api/.env`:

```env
DATABASE_URL="postgresql://karion:karion@localhost:5432/karion"
SESSION_SIGNING_SECRET="<64-char-hex>"
SYSTEM_RECOVERY_SECRET="<different-64-char-hex>"
GENLAYER_CONTRACT_ADDRESS="0x90DEDD8bCef8d0872f746cfb56D15E805747BF24"
GENLAYER_DEPLOYER_PRIVATE_KEY="<your-studionet-deployer-key>"
GENLAYER_RPC_URL="https://studio.genlayer.com/api"
GENLAYER_CHAIN_ID="61999"
FRONTEND_URL="http://localhost:3000"
ADMIN_EMAIL="<your-email>"
```

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Run migrations

```bash
cd apps/api
npx prisma migrate deploy
npx prisma generate
```

### 5. Start the API

```bash
cd apps/api
npm run dev
```

### 6. Start the frontend

```bash
cd apps/web
npm run dev
```

App runs at `http://localhost:3000`, API at `http://localhost:4000`.

---

## Deployment

See [scripts/DEPLOY.md](scripts/DEPLOY.md) for the complete step-by-step guide covering:

- Neon Postgres setup
- Fly.io secrets and deploy
- Vercel environment variables and deploy
- Post-deploy smoke test checklist
- Auth cookie verification

---

## Database schema (19 tables)

`users` · `sessions` · `wallets` · `markets` · `positions` · `suggestions` · `contract_transactions` · `email_verification_tokens` · `password_reset_tokens` · `admin_audit_logs` · `activity_events` · and supporting enum tables.

Two migrations applied in order:
1. `20260613200321_init` — baseline schema
2. `20260614000000_schema_sync` — adds session encryption fields, market resolution columns, audit enums, drops legacy Better Auth tables

---

## Environment variables reference

### API (`apps/api/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SIGNING_SECRET` | Yes | 64-char hex, signs session JWTs |
| `SYSTEM_RECOVERY_SECRET` | Yes | 64-char hex, used for WEK recovery — must differ from above |
| `GENLAYER_CONTRACT_ADDRESS` | Yes | Deployed contract address — do not change |
| `GENLAYER_DEPLOYER_PRIVATE_KEY` | Yes | StudioNet deployer private key |
| `GENLAYER_RPC_URL` | Yes | `https://studio.genlayer.com/api` |
| `GENLAYER_CHAIN_ID` | Yes | `61999` |
| `FRONTEND_URL` | Yes | Allowed CORS origin |
| `ADMIN_EMAIL` | Yes | Gets ADMIN role on first sign-up |
| `SMTP_HOST` | Email | `smtp-relay.brevo.com` |
| `SMTP_PORT` | Email | `587` |
| `SMTP_USER` | Email | Brevo SMTP login |
| `SMTP_PASS` | Email | Brevo SMTP password |
| `EMAIL_FROM` | Email | Verified sender address |
| `UPLOADTHING_TOKEN` | Uploads | UploadThing API token |
| `ENABLE_MARKET_SYNC` | No | `true` to run the sync worker |
| `SYNC_INTERVAL_MS` | No | Default `60000` (1 min) |
| `MIN_STAKE_WEI` | No | Minimum stake enforcement — unset to disable |

### Frontend (`apps/web/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | API base URL |
| `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` | Contract address |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | GenLayer RPC URL |
| `NEXT_PUBLIC_GENLAYER_EXPLORER_URL` | Explorer base URL |
| `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61999` |
| `UPLOADTHING_TOKEN` | UploadThing token (server-side Next.js route) |

---

## License

MIT
