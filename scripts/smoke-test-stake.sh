#!/usr/bin/env bash
# Smoke test: confirm user-funded staking model works end-to-end.
# Run against the live Fly API with a real user session.
#
# Usage:
#   SESSION_COOKIE="karion_session=..." MARKET_ID="mkt-xxx" bash scripts/smoke-test-stake.sh
#
# Requires:
#   - SESSION_COOKIE: copy from browser DevTools > Application > Cookies after logging in
#     The cookie is named karion_session (underscore, not hyphen).
#   - MARKET_ID: an OPEN on-chain market ID from /admin/markets
#   - API: pointing at https://karion-api.fly.dev (default below)
#   - jq installed

set -euo pipefail

API="${API:-https://karion-api.fly.dev}"
COOKIE="${SESSION_COOKIE:?Set SESSION_COOKIE}"
MARKET="${MARKET_ID:?Set MARKET_ID}"
STAKE_WEI="10000000000000000"   # 0.01 GEN in wei

echo "=== Karion stake smoke test ==="
echo "API:    $API"
echo "Market: $MARKET"
echo "Stake:  0.01 GEN (${STAKE_WEI} wei)"
echo ""

# 1. Get deployer address from env (read from Fly secret via API health or known address)
DEPLOYER_ADDRESS="$(
  curl -sf "$API/health" 2>/dev/null | jq -r '.deployerAddress // empty' ||
  echo "UNKNOWN — check GENLAYER_DEPLOYER_PRIVATE_KEY manually"
)"
echo "Deployer address: $DEPLOYER_ADDRESS"

# 2. Get user wallet address
echo ""
echo "--- Step 1: GET /auth/me ---"
ME="$(curl -sf -b "$COOKIE" "$API/auth/me")"
echo "$ME" | jq .
USER_WALLET="$(echo "$ME" | jq -r '.user.walletAddress')"
echo "User wallet: $USER_WALLET"

# 3. Get user wallet balance BEFORE
echo ""
echo "--- Step 2: User wallet balance BEFORE ---"
BALANCE_BEFORE="$(curl -sf -b "$COOKIE" "$API/api/wallet/balance")"
echo "$BALANCE_BEFORE" | jq .
USER_BALANCE_BEFORE_WEI="$(echo "$BALANCE_BEFORE" | jq -r '.balanceWei')"
echo "User balance before: ${USER_BALANCE_BEFORE_WEI} wei"

# 4. Get deployer balance BEFORE via RPC
if [ "$DEPLOYER_ADDRESS" != "UNKNOWN" ]; then
  echo ""
  echo "--- Step 3: Deployer balance BEFORE ---"
  DEPLOYER_BALANCE_BEFORE_RAW="$(
    curl -sf -X POST https://studio.genlayer.com/api \
      -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOYER_ADDRESS\",\"latest\"],\"id\":1}"
  )"
  DEPLOYER_BALANCE_BEFORE_HEX="$(echo "$DEPLOYER_BALANCE_BEFORE_RAW" | jq -r '.result')"
  DEPLOYER_BALANCE_BEFORE_WEI="$(printf '%d' "$DEPLOYER_BALANCE_BEFORE_HEX")"
  echo "Deployer balance before: ${DEPLOYER_BALANCE_BEFORE_WEI} wei"
fi

# 5. Get contract pool BEFORE
echo ""
echo "--- Step 4: Market detail BEFORE ---"
MARKET_BEFORE="$(curl -sf -b "$COOKIE" "$API/api/markets/$MARKET")"
echo "$MARKET_BEFORE" | jq '{status: .onChain.status, yes_pool: .onChain.yes_pool, no_pool: .onChain.no_pool}'

# 6. Submit stake YES
echo ""
echo "--- Step 5: Submit stake YES (0.01 GEN) ---"
STAKE_RESULT="$(
  curl -sf -b "$COOKIE" -X POST "$API/api/markets/$MARKET/stake/yes" \
    -H 'Content-Type: application/json' \
    -d "{\"amountWei\":\"$STAKE_WEI\",\"confirm\":true}"
)"
echo "$STAKE_RESULT" | jq .
TX_HASH="$(echo "$STAKE_RESULT" | jq -r '.txHash')"
echo "txHash: $TX_HASH"

# 7. Wait for finality (poll)
echo ""
echo "--- Step 6: Polling for finality (up to 120s) ---"
for i in $(seq 1 24); do
  sleep 5
  TX_STATUS="$(curl -sf -b "$COOKIE" "$API/api/transactions/$TX_HASH" 2>/dev/null || echo '{}')"
  STATUS="$(echo "$TX_STATUS" | jq -r '.transaction.executionResult // .transaction.status // "PENDING"')"
  echo "  [${i}] status=${STATUS}"
  if [ "$STATUS" = "SUCCESS" ] || [ "$STATUS" = "ERROR" ]; then
    break
  fi
done
echo "Final tx status: $STATUS"

# 8. Get user wallet balance AFTER
echo ""
echo "--- Step 7: User wallet balance AFTER ---"
BALANCE_AFTER="$(curl -sf -b "$COOKIE" "$API/api/wallet/balance")"
echo "$BALANCE_AFTER" | jq .
USER_BALANCE_AFTER_WEI="$(echo "$BALANCE_AFTER" | jq -r '.balanceWei')"
echo "User balance after: ${USER_BALANCE_AFTER_WEI} wei"

# 9. Get deployer balance AFTER
if [ "$DEPLOYER_ADDRESS" != "UNKNOWN" ]; then
  echo ""
  echo "--- Step 8: Deployer balance AFTER ---"
  DEPLOYER_BALANCE_AFTER_RAW="$(
    curl -sf -X POST https://studio.genlayer.com/api \
      -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOYER_ADDRESS\",\"latest\"],\"id\":1}"
  )"
  DEPLOYER_BALANCE_AFTER_HEX="$(echo "$DEPLOYER_BALANCE_AFTER_RAW" | jq -r '.result')"
  DEPLOYER_BALANCE_AFTER_WEI="$(printf '%d' "$DEPLOYER_BALANCE_AFTER_HEX")"
  echo "Deployer balance after: ${DEPLOYER_BALANCE_AFTER_WEI} wei"
fi

# 10. Get position AFTER
echo ""
echo "--- Step 9: Position AFTER ---"
POSITION="$(curl -sf -b "$COOKIE" "$API/api/markets/$MARKET/position")"
echo "$POSITION" | jq .

# 11. Summary
echo ""
echo "=== SUMMARY ==="
echo "User wallet: $USER_WALLET"
echo "User balance before:  $USER_BALANCE_BEFORE_WEI wei"
echo "User balance after:   $USER_BALANCE_AFTER_WEI wei"
echo "Stake amount:         $STAKE_WEI wei"

if [ -n "${DEPLOYER_BALANCE_BEFORE_WEI:-}" ]; then
  DEPLOYER_DIFF=$((DEPLOYER_BALANCE_BEFORE_WEI - DEPLOYER_BALANCE_AFTER_WEI))
  echo "Deployer balance before: $DEPLOYER_BALANCE_BEFORE_WEI wei"
  echo "Deployer balance after:  $DEPLOYER_BALANCE_AFTER_WEI wei"
  echo "Deployer balance change: $DEPLOYER_DIFF wei (should NOT be $STAKE_WEI)"
fi

echo ""
echo "=== EXPECTED PASS CONDITIONS ==="
echo "1. Tx status = SUCCESS"
echo "2. User balance decreased by approximately $STAKE_WEI wei (plus gas)"
echo "3. Deployer balance did NOT decrease by $STAKE_WEI wei"
echo "4. Position shows yes_stake > 0"
