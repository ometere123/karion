# Karion API — Architecture Notes

## StudioNet Transaction Sponsorship Model

### Background

GenLayer's StudioNet uses a two-layer execution model:

1. **EVM layer** — transactions are submitted to an EVM-compatible node. This layer handles ordering and authentication of who is allowed to *submit* transactions.
2. **GenLayer consensus layer** — a network of validators executes the Python intelligent contract. This layer uses its own concept of `gl.message.sender_address`, derived from the transaction calldata — **not** from the EVM `msg.sender`.

### The Constraint

On StudioNet, `ConsensusMain.addTransaction` (the entry point for all GenLayer contract calls) is access-controlled. Only the pre-authorised deployer account is allowed to submit EVM transactions to it. Any other account — including funded user wallets — is rejected at the EVM layer with an "Invalid transaction data" error from `eth_sendRawTransaction`.

This is by design: StudioNet is built for a trusted-backend model where an authorised submitter (the deployer) relays all transactions.

### The `_sender` Parameter

`ConsensusMain.addTransaction` signature:

```
addTransaction(
  address _sender,
  address _recipient,
  uint256 _numOfInitialValidators,
  uint256 _maxRotations,
  bytes   _txData
)
```

The `_sender` field is an explicit calldata parameter. The GenLayer consensus layer takes this value and exposes it inside the Python contract as `gl.message.sender_address`. It does **not** use the EVM transaction's `msg.sender` (the deployer) for this purpose.

### How Karion Uses This

When a user stakes, claims, or refunds:

1. The backend decrypts the user's embedded wallet (from their session) and reads their wallet address.
2. `sendSponsoredWriteContract()` in `genlayer-client.ts` builds a `ConsensusMain.addTransaction` call where:
   - **EVM `from`** = deployer address (authorised on StudioNet)
   - **`_sender` arg** = user's embedded wallet address
   - **`_txData`** = the encoded KarionMarket function call (`stake_yes`, `claim_payout`, etc.)
3. The deployer signs and submits the EVM transaction.
4. GenLayer consensus validators execute KarionMarket.py and see:

   ```
   gl.message.sender_address  →  user's wallet address
   ```

### Why Positions Are Correctly Attributed

Inside KarionMarket.py, every write function uses the caller identity for storage:

```python
def stake_yes(self, market_id: str) -> None:
    caller = str(gl.message.sender_address)   # user's wallet address
    key = self._pos_key(market_id, caller)
    # position stored under user's address

def claim_payout(self, market_id: str) -> None:
    caller = str(gl.message.sender_address)   # user's wallet address
    key = self._pos_key(market_id, caller)
    pos = self.positions.get(key, ...)
    # payout sent to user's wallet address
    _EOARecipient(Address(caller)).emit_transfer(value=payout)
```

Because `_sender` = user's wallet address, all of the following are attributed to the correct user:

| Action | Attributed to |
|--------|--------------|
| YES / NO stake | user's wallet address |
| Position storage key | user's wallet address |
| `claim_payout` eligibility | user's wallet address |
| `claim_refund` eligibility | user's wallet address |
| GEN payout / refund transfer | user's wallet address |

### What the Deployer Does NOT Do

- The deployer does **not** own any user position.
- The deployer does **not** receive any user payout or refund.
- The deployer is a **relay only** — it signs the EVM envelope so the transaction reaches StudioNet's network, but the GenLayer contract executes in the user's identity.

### Implementation Reference

- `apps/api/src/lib/genlayer-client.ts` — `sendSponsoredWriteContract()`
- `apps/api/src/lib/contract.ts` — `stakeYes()`, `stakeNo()`, `claimPayout()`, `claimRefund()`

---

## Security Invariants

| Invariant | Where enforced |
|-----------|---------------|
| SESSION_SIGNING_SECRET validated (64 hex chars) at startup; server exits if missing | `src/index.ts` |
| SESSION_SIGNING_SECRET never logged | `src/lib/wallet-signer.ts`, `src/index.ts` |
| Deployer private key never logged | `src/lib/genlayer-client.ts` |
| User private key lives only as local variable, never stored after request | `src/lib/wallet-signer.ts` |
| WEK (wallet encryption key) never logged | `src/lib/wallet-signer.ts`, `src/lib/wallet.ts` |
| `encryptedWek` cleared from Session on logout and session deletion | `src/routes/auth.ts`, `src/lib/session.ts` |
| `encryptedWek` cleared when password reset invalidates sessions | `src/services/auth.service.ts` |
| Value-moving routes require `confirm: true` in body | `src/routes/markets.ts` via zod schema |
| All stake amounts use BigInt — `Number()` never used for GEN values | `src/routes/markets.ts` `parseStakeAmount()` |
| All contract reads go through `contract.ts` and `mapToObj` | enforced by code structure |
| Postgres is cache only — contract is authoritative for financial state | architecture rule |
| Market sync worker disabled by default | `src/workers/market-sync.ts` guards `ENABLE_MARKET_SYNC` |
| Backend never calculates payouts as source of truth | architecture rule; contract does this |

---

## Data Model: Postgres as Cache

Postgres holds a cached view of market and position data for fast API reads. The contract on StudioNet is always the authoritative source for:

- Market status (`OPEN` / `LOCKED` / `RESOLVED` / `INVALID` / `UNRESOLVED` / `CANCELLED`)
- Pool sizes (`yes_pool`, `no_pool`)
- Outcome and confidence
- User positions (`yes_stake`, `no_stake`, `claimed`)

The `GET /api/markets/:id` route always performs a live contract read alongside the Postgres data.
The `GET /api/markets/:id/position` route reads exclusively from the contract.
The market sync worker (`ENABLE_MARKET_SYNC=true`) periodically updates the Postgres cache.

---

## Known Constraints

- **No user-signed transactions on StudioNet.** Users cannot submit transactions directly to StudioNet. The sponsorship model is required. If GenLayer changes this in a future network version, the `sendSponsoredWriteContract` calls in `contract.ts` can be replaced with user-signed equivalents without any contract changes.
- **`sim_fundAccount` works on StudioNet** with an integer amount parameter (not a string). Useful for funding test wallets during development.
- **BigInt serialization.** GenLayer returns integer fields (deadlines, pool sizes) as JavaScript `BigInt`. `mapToObj()` in `genlayer-client.ts` converts these to strings for JSON safety.
- **Map-to-object conversion.** GenLayer returns Python dicts as JavaScript `Map` objects. `mapToObj()` recursively converts them to plain objects.
