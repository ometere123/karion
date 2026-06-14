# Stage 4 — End-to-End Test Summary

**Date:** 2026-06-14  
**Network:** GenLayer StudioNet (chain ID 61999)  
**Contract:** `0x90DEDD8bCef8d0872f746cfb56D15E805747BF24` (KarionMarket.py v0.2.18)  
**Test market:** `mkt-cmqcz8mnu0-1781392852858` — "Will Wikipedia list the Sun as a star before the deadline?"  
**Test user wallet:** `0x043363Cc7cC556d87E7b159A096d38535a31Ebea`

---

## Routes Tested

### Market list — `GET /api/markets`
- Returns cached market list from Postgres with pools, status, deadline.

### Market detail — `GET /api/markets/:id`
- Performs live `get_market` contract read alongside Postgres data.
- Returns `{ market: <db row>, onChain: <contract state> }`.

### Stake YES — `POST /api/markets/:id/stake/yes`
```json
{ "amountWei": "1000000000000000000", "confirm": true }
```
Result:
```json
{ "txHash": "0x0619b0b9...", "status": "PENDING", "amountWei": "1000000000000000000" }
```
Confirmed **FINALIZED / SUCCESS** via transaction poll.

### Stake NO — `POST /api/markets/:id/stake/no`
```json
{ "amountWei": "500000000000000000", "confirm": true }
```
Result:
```json
{ "txHash": "0x90dc26a1...", "status": "PENDING", "amountWei": "500000000000000000" }
```
Confirmed submitted successfully.

### Live position read — `GET /api/markets/:id/position`
Live contract read via `get_position(marketId, userAddress)`:
```json
{
  "position": { "yes_stake": "1000000000000000000", "no_stake": "500000000000000000", "claimed": false },
  "walletAddress": "0x043363Cc7cC556d87E7b159A096d38535a31Ebea"
}
```
Position attributed to user's wallet address (not deployer) — confirms sponsorship model works correctly.

### Transaction polling — `GET /api/transactions/:txHash`
```json
{
  "transaction": {
    "txHash": "0x0619b0b9...",
    "txType": "STAKE_YES",
    "status": "FINALIZED",
    "executionResult": "SUCCESS",
    "errorDescription": null
  }
}
```

### Portfolio — `GET /api/portfolio`
Returns both YES and NO positions from Postgres cache with joined market data.

### Claim guard — `POST /api/markets/:id/claim`
Correctly blocked with 409 while market is OPEN:
```json
{ "error": "Market has not been resolved yet", "marketStatus": "OPEN" }
```

### Validation guards
- Missing `confirm` → 400 `"confirm must be true"`
- `confirm: false` → 400 `"confirm must be true"`
- Decimal `amountWei` (`"1.5"`) → 400 `"amountWei must be a non-negative decimal integer string"`
- Zero amount → 400 `"amountWei must be a positive integer"`

### SESSION_SIGNING_SECRET startup validation
- Missing or invalid secret → server exits with `FATAL:` message before accepting traffic.

---

## Key Fixes Discovered During Stage 4

### 1. BigInt serialization
GenLayer returns `deadline` and pool fields as JavaScript `BigInt`. `JSON.stringify` throws on BigInt.

**Fix:** `mapToObj()` in `genlayer-client.ts` converts `bigint → string` recursively before any JSON response.

### 2. Map-to-object conversion
GenLayer returns Python dicts as JavaScript `Map` objects.

**Fix:** `mapToObj()` recursively converts `Map → plain object`.

### 3. Express 5 param typing
`req.params.id` is typed `string | string[]` in Express 5, not `string`.

**Fix:** `String(req.params.id)` casts in all param usages. `req.query.x as string | undefined` for query params.

### 4. StudioNet transaction sponsorship (major discovery)

**Problem:** User wallet accounts are rejected by StudioNet's `ConsensusMain.addTransaction` at the EVM layer with "Invalid transaction data", even when funded.

**Root cause:** StudioNet restricts who can submit EVM transactions to `ConsensusMain`. Only the pre-authorised deployer account is permitted.

**Solution:** `sendSponsoredWriteContract()` in `genlayer-client.ts`. The deployer signs the EVM transaction, but the user's wallet address is passed as the `_sender` parameter in the `addTransaction` calldata. GenLayer consensus uses this `_sender` value as `gl.message.sender_address` inside the Python contract — not the EVM `msg.sender`. Positions, stakes, and payouts are therefore correctly attributed to the user's wallet address, not the deployer's.

See [`docs/architecture.md`](./architecture.md) for full explanation.

### 5. Windows ghost server problem
On Windows, a previous `tsx` server process (from an expired context session) was still occupying port 4000. Git Bash `pkill` cannot kill Windows `node.exe` processes.

**Fix:** Use PowerShell: `Get-NetTCPConnection -LocalPort 4000` to find PID, then `Stop-Process -Id <pid> -Force`.

---

## Files Changed in Stage 4

| File | Change |
|------|--------|
| `src/lib/genlayer-client.ts` | Added `sendSponsoredWriteContract()`, BigInt handling in `mapToObj()`, consensus init polling |
| `src/lib/contract.ts` | User write functions now take `userAddress: string` instead of `account`; use sponsorship relay |
| `src/lib/wallet-signer.ts` | No change — `createUserAccountFromSession` still called to validate session/WEK |
| `src/lib/wallet.ts` | No change |
| `src/routes/markets.ts` | Full Stage 4 implementation: list, detail, position, stake YES/NO, claim routing |
| `src/routes/transactions.ts` | `String(req.params.txHash)` Express 5 fix |
| `src/routes/suggestions.ts` | `String(req.params.id)` Express 5 fix |
| `src/routes/portfolio.ts` | No change |
| `src/routes/admin/markets.ts` | Express 5 param fixes |
| `src/routes/admin/suggestions.ts` | Express 5 param fixes |
| `src/workers/market-sync.ts` | Guarded by `ENABLE_MARKET_SYNC=true` |
| `src/index.ts` | SESSION_SIGNING_SECRET startup validation; sync worker wired |
| `docs/architecture.md` | New — sponsorship model and security invariants |
| `docs/stage4-test-summary.md` | This file |
