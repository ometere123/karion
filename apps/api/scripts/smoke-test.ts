/**
 * Karion Stage 3 smoke test.
 *
 * Flow:
 *   1. Create a market with a 5-minute deadline
 *   2. Stake YES (0.01 GEN) and NO (0.01 GEN) from the deployer account
 *   3. Test zero-stake rejection (execution_result === "ERROR" via receipt)
 *   4. Wait until the deadline has passed
 *   5. Resolve the market via GenLayer non-deterministic consensus
 *   6. Claim payout (RESOLVED) or refund (INVALID / UNRESOLVED)
 *   7. Verify double-claim is rejected (execution_result === "ERROR" via receipt)
 *
 * NOTE on GenLayer rejection testing:
 *   writeContract() always returns a tx hash immediately — the contract logic runs
 *   during consensus. To confirm a rejection, submit the tx, wait for the receipt,
 *   and check receipt.consensus_data.leader_receipt[0].execution_result === "ERROR".
 *
 * Run: tsx apps/api/scripts/smoke-test.ts
 * Requires GENLAYER_DEPLOYER_PRIVATE_KEY and GENLAYER_CONTRACT_ADDRESS in apps/api/.env
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, createAccount } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { TransactionHash } from "genlayer-js/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const PRIVATE_KEY = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.GENLAYER_CONTRACT_ADDRESS;

if (!PRIVATE_KEY) {
  console.error("GENLAYER_DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}
if (!CONTRACT_ADDRESS) {
  console.error("GENLAYER_CONTRACT_ADDRESS not set — run deploy-contract.ts first");
  process.exit(1);
}

const studionet = { ...localnet } as typeof localnet;
(studionet as any).name = "GenLayer StudioNet";
(studionet as any).rpcUrls = {
  default: { http: ["https://studio.genlayer.com/api"] },
};

const STAKE = 10_000_000_000_000_000n; // 0.01 GEN in wei
const MARKET_ID = `smoke-${Date.now()}`;

// Deadline: 5 minutes from now — allows time for create + stake txs before lock.
const DEADLINE = Math.floor(Date.now() / 1000) + 300;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Wait for a tx to reach FINALIZED status and return the receipt.
async function waitFinalized(client: any, hash: string, label: string) {
  console.log(`  [${label}] tx: ${hash}`);
  console.log(`  [${label}] waiting for FINALIZED...`);
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    retries: 300,
  });
  if (
    receipt.status !== TransactionStatus.FINALIZED &&
    receipt.status !== TransactionStatus.ACCEPTED
  ) {
    throw new Error(`[${label}] tx failed: ${JSON.stringify(receipt)}`);
  }
  console.log(`  [${label}] finalized (${receipt.status})`);
  return receipt;
}

// Check that a tx was rejected by the contract (execution_result === "ERROR").
// GenLayer writeContract() always returns a hash — rejection must be confirmed via receipt.
async function assertRejected(client: any, hash: string, label: string) {
  console.log(`  [${label}] tx: ${hash}`);
  console.log(`  [${label}] waiting for receipt (checking for rejection)...`);
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    retries: 200,
  });
  const lr0 = (receipt as any).consensus_data?.leader_receipt?.[0];
  const execResult: string = lr0?.execution_result ?? "unknown";
  const errDesc: string = lr0?.genvm_result?.error_description ?? "";
  if (execResult === "ERROR") {
    console.log(`  [${label}] correctly rejected (execution_result=ERROR)`);
    if (errDesc) console.log(`  [${label}] error: ${errDesc.slice(0, 120)}`);
    return true;
  }
  console.error(
    `  [${label}] ERROR: expected rejection but got execution_result=${execResult}`
  );
  return false;
}

// Read a Python dict from readContract (returned as JS Map<string, CalldataEncodable>).
function mapToObj(m: Map<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(m.entries());
}

async function main() {
  const account = createAccount(PRIVATE_KEY as `0x${string}`);
  const client = createClient({ chain: studionet as any, account });

  console.log(`Deployer  : ${account.address}`);
  console.log(`Contract  : ${CONTRACT_ADDRESS}`);
  console.log(`Market ID : ${MARKET_ID}`);
  console.log(`Deadline  : ${new Date(DEADLINE * 1000).toISOString()}`);

  console.log("\nInitializing consensus contract...");
  await client.initializeConsensusSmartContract();

  // ── [1/7] create market ───────────────────────────────────────────────────
  console.log("\n[1/7] Creating market...");
  const createHash = await client.writeContract({
    address: CONTRACT_ADDRESS as any,
    functionName: "create_market",
    args: [
      MARKET_ID,
      "Is the Sun classified as a star in astronomy?",
      "The evidence explicitly states that the Sun is a star.",
      "The evidence explicitly states that the Sun is NOT a star.",
      "The question is unanswerable or nonsensical based on the evidence.",
      "https://en.wikipedia.org/wiki/Sun",
      "Determine whether the Wikipedia article on the Sun classifies it as a star.",
      BigInt(DEADLINE),
    ],
    value: 0n,
  });
  await waitFinalized(client, createHash, "create_market");

  // ── [2/7] stake YES ───────────────────────────────────────────────────────
  console.log("\n[2/7] Staking YES (0.01 GEN)...");
  const yesHash = await client.writeContract({
    address: CONTRACT_ADDRESS as any,
    functionName: "stake_yes",
    args: [MARKET_ID],
    value: STAKE,
  });
  await waitFinalized(client, yesHash, "stake_yes");

  // ── [3/7] stake NO ────────────────────────────────────────────────────────
  console.log("\n[3/7] Staking NO (0.01 GEN)...");
  const noHash = await client.writeContract({
    address: CONTRACT_ADDRESS as any,
    functionName: "stake_no",
    args: [MARKET_ID],
    value: STAKE,
  });
  await waitFinalized(client, noHash, "stake_no");

  // ── [4/7] zero-stake rejection ────────────────────────────────────────────
  // The market is still OPEN and we're still before the deadline — correct window
  // for testing the zero-stake guard (assert v > u256(0)).
  console.log("\n[4/7] Testing zero-stake rejection...");
  const zeroHash = await client.writeContract({
    address: CONTRACT_ADDRESS as any,
    functionName: "stake_yes",
    args: [MARKET_ID],
    value: 0n,
  });
  const zeroRejected = await assertRejected(client, zeroHash, "zero_stake");
  if (!zeroRejected) {
    console.error("FATAL: zero-stake was not rejected");
    process.exit(1);
  }

  // ── [5/7] wait for deadline ───────────────────────────────────────────────
  const nowMs = Date.now();
  const deadlineMs = DEADLINE * 1000;
  const waitMs = deadlineMs + 10_000 - nowMs;
  if (waitMs > 0) {
    console.log(
      `\n[5/7] Waiting ${Math.ceil(waitMs / 1000)} s for deadline to pass...`
    );
    await sleep(waitMs);
  } else {
    console.log("\n[5/7] Deadline already passed.");
  }

  // ── [6/7] resolve market ──────────────────────────────────────────────────
  console.log("\n[6/7] Resolving market (GenLayer non-det consensus)...");
  console.log("      gl.nondet.web.get  → fetches Wikipedia live");
  console.log("      gl.nondet.exec_prompt  → LLM judges the evidence");
  console.log("      gl.eq_principle.strict_eq  → validators must agree on {outcome, confidence}");
  const resolveHash = await client.writeContract({
    address: CONTRACT_ADDRESS as any,
    functionName: "resolve_market",
    args: [MARKET_ID],
    value: 0n,
  });
  await waitFinalized(client, resolveHash, "resolve_market");

  // Read final market state — readContract returns Map<string, CalldataEncodable>
  const marketMap = (await client.readContract({
    address: CONTRACT_ADDRESS as any,
    functionName: "get_market",
    args: [MARKET_ID],
  })) as Map<string, unknown>;
  const market = mapToObj(marketMap);

  console.log(`\n  status           : ${market.status}`);
  console.log(`  outcome          : ${market.outcome || "(none)"}`);
  console.log(`  confidence       : ${market.confidence || "(none)"}`);
  console.log(`  resolution_note  : ${market.resolution_note}`);
  console.log(`  yes_pool         : ${market.yes_pool} wei`);
  console.log(`  no_pool          : ${market.no_pool} wei`);

  const resolvedStatus = market.status as string;
  const outcome = market.outcome as string;

  // ── [7/7] claim + double-claim guard ─────────────────────────────────────
  console.log("\n[7/7] Claiming...");
  let claimHash: string;
  let claimFn: string;

  if (resolvedStatus === "RESOLVED") {
    claimFn = "claim_payout";
    claimHash = await client.writeContract({
      address: CONTRACT_ADDRESS as any,
      functionName: "claim_payout",
      args: [MARKET_ID],
      value: 0n,
    });
  } else if (
    resolvedStatus === "INVALID" ||
    resolvedStatus === "UNRESOLVED" ||
    resolvedStatus === "CANCELLED"
  ) {
    claimFn = "claim_refund";
    claimHash = await client.writeContract({
      address: CONTRACT_ADDRESS as any,
      functionName: "claim_refund",
      args: [MARKET_ID],
      value: 0n,
    });
  } else {
    throw new Error(`Unexpected market status after resolve: ${resolvedStatus}`);
  }

  const claimReceipt = await waitFinalized(client, claimHash, claimFn);
  const claimLr0 = (claimReceipt as any).consensus_data?.leader_receipt?.[0];
  if (claimLr0?.execution_result !== "SUCCESS") {
    throw new Error(`${claimFn} did not succeed: ${claimLr0?.execution_result}`);
  }
  console.log(`  ${claimFn} execution_result: SUCCESS`);

  // Verify position is marked claimed
  const posMap = (await client.readContract({
    address: CONTRACT_ADDRESS as any,
    functionName: "get_position",
    args: [MARKET_ID, account.address],
  })) as Map<string, unknown>;
  const pos = mapToObj(posMap);
  console.log(`  position.claimed: ${pos.claimed}`);
  if (!pos.claimed) {
    throw new Error("position.claimed should be true after successful claim");
  }

  // Double-claim rejection
  console.log("\n  Testing double-claim rejection...");
  const doubleHash = await client.writeContract({
    address: CONTRACT_ADDRESS as any,
    functionName: claimFn,
    args: [MARKET_ID],
    value: 0n,
  });
  const dcRejected = await assertRejected(client, doubleHash, "double_claim");
  if (!dcRejected) {
    console.error("FATAL: double-claim was not rejected — this is a bug!");
    process.exit(1);
  }

  console.log("\n✓ Smoke test PASSED");
  console.log(`  Market ID  : ${MARKET_ID}`);
  console.log(`  Status     : ${market.status}`);
  console.log(`  Outcome    : ${outcome || resolvedStatus}`);
  console.log(`  Confidence : ${market.confidence || "(none)"}`);
  console.log(`  Note       : ${market.resolution_note}`);
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err);
  process.exit(1);
});
