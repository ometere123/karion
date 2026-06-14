# Karion — Production Deployment Checklist

Contract address (DO NOT CHANGE): `0x90DEDD8bCef8d0872f746cfb56D15E805747BF24`

---

## Architecture

| Layer | Local Development | Production |
|---|---|---|
| API | `npm run dev` (apps/api) | Fly.io — `karion-api` |
| Database | Docker Postgres | Neon Postgres (cloud) |
| Redis | Docker Redis (available locally) | Upstash Redis — optional, future only |
| Frontend | `npm run dev` (apps/web) | Vercel |

**Redis note:** Karion currently has no Redis code. Docker Redis is available locally for future use. Do not add `REDIS_URL` to production secrets until Redis code exists in the app.

---

## Local development — Docker setup

### What Docker is used for here

- Docker runs a local Postgres database and a local Redis instance on your machine
- This lets you develop without installing Postgres or Redis natively
- **Docker Postgres is NOT the production database** — production uses Neon
- Docker Redis is available locally but Karion does not currently use Redis

---

### Step 1 — Install Docker Desktop

Download and install Docker Desktop for Windows:
https://www.docker.com/products/docker-desktop/

After installing:
- Open Docker Desktop and wait for it to say "Engine running"
- Docker must be open and running before any `docker` commands will work

---

### Step 2 — Confirm Docker is working

```bash
docker --version
docker compose version
docker ps
```

Expected output: version numbers for the first two, and an empty table for `docker ps` (no containers running yet). If you get "command not found" or "Cannot connect", Docker Desktop is not open.

---

### Step 3 — Start local services

From the repo root (where `docker-compose.yml` lives):

```bash
docker compose up -d
```

This starts Postgres on port 5432 and Redis on port 6379 in the background. Data is stored under `.data/` in the repo root (this folder is gitignored).

---

### Step 4 — Confirm services are running

```bash
docker compose ps
```

Both `postgres` and `redis` should show status `running`.

---

### Step 5 — Set local DATABASE_URL

In `apps/api/.env`, set:

```env
DATABASE_URL="postgresql://karion:karion@localhost:5432/karion"
```

Local Redis URL (available but unused until Redis code is added):

```env
# REDIS_URL="redis://localhost:6379"
```

---

### Step 6 — Run migrations against local Docker Postgres

```bash
cd apps/api
npx prisma migrate deploy
npx prisma generate
```

This applies both migrations (`20260613200321_init` and `20260614000000_schema_sync`) to your local Docker Postgres database and creates all 19 tables.

---

### Step 7 — Stop Docker services

```bash
docker compose down
```

Stops the containers. Your data in `.data/` is preserved — next `docker compose up -d` picks up where you left off.

---

### Step 8 — Reset local database completely

```bash
docker compose down -v
```

> **Warning:** This deletes all local Docker database data permanently. Your `.data/` folder is wiped. Use this when you want a clean slate.

---

### Troubleshooting

**Port 5432 already in use**
Your machine has native Postgres running (installed separately). Either:
- Stop native Postgres: open Services on Windows and stop `postgresql-x64-18`
- Or change the Docker port in `docker-compose.yml`: change `"5432:5432"` to `"5433:5432"` and update `DATABASE_URL` to use port 5433

**Docker Desktop not open**
All `docker` commands fail with "Cannot connect to the Docker daemon". Open Docker Desktop and wait for "Engine running" before retrying.

**Prisma cannot connect**
- Confirm `DATABASE_URL` in `apps/api/.env` uses `localhost:5432` (or your changed port)
- Confirm `docker compose ps` shows postgres as `running`
- Confirm you ran `docker compose up -d` first

---

## Pre-flight: migration repair (already completed)

Both migrations are ready in `apps/api/prisma/migrations/`:
- `20260613200321_init/migration.sql`
- `20260614000000_schema_sync/migration.sql`

These have been tested on a fresh empty database. All 19 tables confirmed. Do not delete or rewrite these files.

The Fly release command runs `npx prisma migrate deploy` automatically on first deploy. Neon starts empty — both migrations apply cleanly.

---

## Step 1 — Create Neon Postgres project

1. Go to https://neon.tech and sign up / log in
2. Create a new project — name it `karion`
3. Choose region closest to `lhr` (London) — select **EU West** or **Europe**
4. Once created, go to **Connection Details**
5. Copy the **Direct connection string** — it looks like:
   ```
   postgresql://<user>:<password>@<host>.neon.tech/<dbname>?sslmode=require
   ```
6. This becomes your `DATABASE_URL` Fly secret

Use the **direct** connection string, not the pooled one.

---

## Step 2 — Generate fresh production secrets

Run these two commands in your terminal. Save each output in a password manager. They must be different values.

```bash
# SESSION_SIGNING_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# SYSTEM_RECOVERY_SECRET — run again for a different value
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 3 — Set Fly secrets

```bash
fly secrets set \
  DATABASE_URL="<neon-direct-connection-string>" \
  SESSION_SIGNING_SECRET="<64-char-hex-from-step-2>" \
  SYSTEM_RECOVERY_SECRET="<different-64-char-hex-from-step-2>" \
  GENLAYER_DEPLOYER_PRIVATE_KEY="<your-studionet-deployer-private-key>" \
  FRONTEND_URL="https://karionmarket.vercel.app" \
  SMTP_HOST="smtp-relay.brevo.com" \
  SMTP_PORT="587" \
  SMTP_SECURE="false" \
  SMTP_USER="<your-brevo-smtp-user>" \
  SMTP_PASS="<your-brevo-smtp-pass>" \
  EMAIL_FROM="Karion <convertyourcodes@gmail.com>" \
  UPLOADTHING_TOKEN="<your-uploadthing-token>" \
  ADMIN_EMAIL="convertyourcodes@gmail.com" \
  --app karion-api
```

Also remove the stale `DATABASE_DIRECT_URL` secret left over from the previous Fly Managed Postgres attempt:

```bash
fly secrets unset DATABASE_DIRECT_URL --app karion-api
```

**Notes per secret:**

| Secret | Notes |
|---|---|
| `DATABASE_URL` | Neon direct connection string from Step 1 |
| `SESSION_SIGNING_SECRET` | Fresh value from Step 2 |
| `SYSTEM_RECOVERY_SECRET` | Fresh value from Step 2 — must differ from above |
| `GENLAYER_DEPLOYER_PRIVATE_KEY` | Your StudioNet deployer key — same as dev, contract already deployed. Never put in code, docs, or git. |
| `FRONTEND_URL` | Must match Vercel URL exactly, no trailing slash |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_SECURE` | `false` for port 587 (STARTTLS) |
| `EMAIL_FROM` | Must be a verified Brevo sender |
| `ADMIN_EMAIL` | Gets ADMIN role on first sign-up |

`MIN_STAKE_WEI` is optional — leave unset to disable minimum stake enforcement.

`REDIS_URL` is not required — Karion has no Redis code yet. Add it only when Redis is added to the app.

---

## Fly API — non-secret env vars (already in fly.toml)

No action needed — applied automatically on `fly deploy`:

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `API_PORT` | `4000` |
| `GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
| `GENLAYER_CHAIN_ID` | `61999` |
| `GENLAYER_EXPLORER_URL` | `https://explorer-studio.genlayer.com` |
| `GENLAYER_CONTRACT_ADDRESS` | `0x90DEDD8bCef8d0872f746cfb56D15E805747BF24` |
| `ENABLE_MARKET_SYNC` | `true` |
| `SYNC_INTERVAL_MS` | `60000` |
| `RESOLVE_RETRY_COOLDOWN_MS` | `600000` |

---

## Step 4 — Deploy API to Fly

```bash
cd apps/api
fly deploy -a karion-api
```

Release command runs automatically: `npx prisma migrate deploy` → applies both migrations to fresh Neon DB → all 19 tables created → app starts.

**Gate:** do not proceed until deploy reports success.

```bash
curl https://karion-api.fly.dev/health
# Expected: 200 {"status":"ok"}
```

---

## Step 5 — Set Vercel environment variables

Vercel dashboard → Project → Settings → Environment Variables → Production:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://karion-api.fly.dev` |
| `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` | `0x90DEDD8bCef8d0872f746cfb56D15E805747BF24` |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
| `NEXT_PUBLIC_GENLAYER_EXPLORER_URL` | `https://explorer-studio.genlayer.com` |
| `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61999` |
| `UPLOADTHING_TOKEN` | Same token as Fly secret |

Vercel project settings:
- **Root Directory**: `apps/web`
- **Framework**: Next.js (auto-detected)

---

## Step 6 — Deploy frontend to Vercel

Push the branch or trigger from the Vercel dashboard.

**Auth cookie check** — after deploy:
1. Open `https://karionmarket.vercel.app` in a browser
2. Register a new account
3. DevTools → Application → Cookies → find `karion_session`
4. Confirm: `HttpOnly` ✓, `Secure` ✓, `SameSite: None`

---

## Step 7 — Production smoke test

```
→ /markets — loads, may be empty
→ /suggest — submit a suggestion
→ /resolution-centre — empty state shown
→ /admin (logged in as ADMIN_EMAIL) — suggestions, markets, activity, transactions
→ No 401 / 403 / 500 in browser console
→ Email received on register/verify
```

---

## Deploy order summary

```
1. Create Neon project → copy direct connection string

2. Generate SESSION_SIGNING_SECRET + SYSTEM_RECOVERY_SECRET locally

3. fly secrets set (all secrets) + fly secrets unset DATABASE_DIRECT_URL

4. fly deploy -a karion-api
   → release: prisma migrate deploy (Neon, fresh DB, all 19 tables)
   → app: node dist/index.js

5. curl https://karion-api.fly.dev/health → 200 {"status":"ok"}

6. Vercel: set env vars

7. Vercel: deploy

8. Browser: register → confirm karion_session cookie SameSite=None, Secure, HttpOnly
   URL: https://karionmarket.vercel.app

9. Smoke test
```

---

## Optional future: Upstash Redis

When Redis code is added to Karion (rate limiting, caching, etc.):
1. Create a database at https://upstash.com — free tier available
2. Copy the Redis URL
3. `fly secrets set REDIS_URL="<upstash-redis-url>" --app karion-api`
4. Add Redis client to `apps/api` and use `REDIS_URL`

Do not set `REDIS_URL` before Redis code exists in the app.

---

## Security checklist

- [ ] `.env` files not staged in git
- [ ] Contract address unchanged: `0x90DEDD8bCef8d0872f746cfb56D15E805747BF24`
- [ ] `SESSION_SIGNING_SECRET` and `SYSTEM_RECOVERY_SECRET` are different values
- [ ] Neither secret is logged anywhere
- [ ] `GENLAYER_DEPLOYER_PRIVATE_KEY` not in fly.toml, git, docs, or screenshots
- [ ] `DATABASE_DIRECT_URL` removed from Fly secrets (stale from MPG attempt)
- [ ] `prisma migrate deploy` release command in fly.toml
- [ ] Cookie `SameSite=None` confirmed in DevTools after deploy
- [ ] `FRONTEND_URL` matches Vercel URL exactly (no trailing slash)
