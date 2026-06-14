// contract.ts
// Typed wrappers for all KarionMarket contract interactions.
//
// RULES enforced here:
//   1. All readContract calls go through getMarket() or getPosition() — no
//      route or service may call readContract directly.
//   2. mapToObj() is applied to every readContract result before it leaves
//      this module, converting JS Map returns to plain objects.
//   3. The contract remains the sole source of truth for all financial state.
//      These functions return on-chain values; callers must not override them
//      with Postgres-cached data for financial decisions.
//   4. Write functions accept an explicit account so callers control which
//      signer is used (deployer for admin actions, user account for staking).

import { TransactionStatus } from "genlayer-js/types";
import type { TransactionHash } from "genlayer-js/types";
import {
  CONTRACT_ADDRESS,
  deployerClient,
  deployerAccount,
  sendSponsoredWriteContract,
  mapToObj,
} from "./genlayer-client.js";

export interface ContractMarket {
  question: string;
  yes_condition: string;
  no_condition: string;
  invalid_condition: string;
  resolution_url: string;
  resolution_query: string;
  deadline: number;
  yes_pool: number;
  no_pool: number;
  status: string;       // OPEN | LOCKED | RESOLVED | INVALID | UNRESOLVED | CANCELLED
  outcome: string;      // "" | "YES" | "NO"
  confidence: string;   // "" | "HIGH" | "MEDIUM" | "LOW"
  resolution_note: string;
  resolved_at: string;
  creator: string;
}

export interface ContractPosition {
  yes_stake: number;
  no_stake: number;
  claimed: boolean;
}

export interface CreateMarketParams {
  marketId: string;
  question: string;
  yesCondition: string;
  noCondition: string;
  invalidCondition: string;
  resolutionUrl: string;
  resolutionQuery: string;
  deadline: bigint; // unix timestamp in seconds
}

// ── Reads ────────────────────────────────────────────────────────────────────

// Genlayer-js Address type requires a 42-char branded string — use `as any`
// to satisfy its internal type while CONTRACT_ADDRESS is a plain 0x string.
const addr = CONTRACT_ADDRESS as any;

export async function getMarket(marketId: string): Promise<ContractMarket> {
  const raw = await deployerClient.readContract({
    address: addr,
    functionName: "get_market",
    args: [marketId],
  });
  return mapToObj(raw) as ContractMarket;
}

export async function getPosition(
  marketId: string,
  userAddress: string
): Promise<ContractPosition> {
  const raw = await deployerClient.readContract({
    address: addr,
    functionName: "get_position",
    args: [marketId, userAddress],
  });
  return mapToObj(raw) as ContractPosition;
}

// ── Deployer writes ───────────────────────────────────────────────────────────
// These use the deployer account and are admin-only at the route layer.

export async function createMarket(params: CreateMarketParams): Promise<string> {
  const txHash = await deployerClient.writeContract({
    address: addr,
    functionName: "create_market",
    args: [
      params.marketId,
      params.question,
      params.yesCondition,
      params.noCondition,
      params.invalidCondition,
      params.resolutionUrl,
      params.resolutionQuery,
      params.deadline,
    ],
    value: 0n,
  });
  return txHash as string;
}

export async function lockMarket(marketId: string): Promise<string> {
  const txHash = await deployerClient.writeContract({
    address: addr,
    functionName: "lock_market",
    args: [marketId],
    value: 0n,
  });
  return txHash as string;
}

export async function resolveMarket(marketId: string): Promise<string> {
  const txHash = await deployerClient.writeContract({
    address: addr,
    functionName: "resolve_market",
    args: [marketId],
    value: 0n,
  });
  return txHash as string;
}

// ── User writes — StudioNet relay / sponsorship model ────────────────────────
//
// On StudioNet, only the pre-authorised deployer account may call
// ConsensusMain.addTransaction at the EVM layer. New user wallet accounts are
// rejected by the network regardless of their GEN balance.
//
// However, ConsensusMain.addTransaction takes an explicit `_sender` parameter
// (address) in its calldata. GenLayer's consensus layer uses that value as
// gl.message.sender_address when executing the Python contract — it does NOT
// derive it from the EVM transaction's msg.sender.
//
// We exploit this: sendSponsoredWriteContract() builds the EVM transaction
// signed by the deployer, but places the user's embedded wallet address as
// `_sender`. Inside KarionMarket.py the contract therefore sees:
//
//   gl.message.sender_address  ==  user's wallet address  (NOT the deployer)
//
// Consequences:
//   - Stakes are stored under the user's address as the position key.
//   - claim_payout / claim_refund read the position by the user's address.
//   - The GEN transfer (emit_transfer) targets the user's wallet address.
//
// The deployer is a relay only. It does not own, control, or receive any
// position or payout belonging to a user. Misreading this as deployer ownership
// of user positions would be incorrect.

export async function stakeYes(
  userAddress: string,
  marketId: string,
  valueWei: bigint
): Promise<string> {
  return sendSponsoredWriteContract({
    userAddress,
    contractAddress: addr,
    functionName: "stake_yes",
    args: [marketId],
    value: valueWei,
  });
}

export async function stakeNo(
  userAddress: string,
  marketId: string,
  valueWei: bigint
): Promise<string> {
  return sendSponsoredWriteContract({
    userAddress,
    contractAddress: addr,
    functionName: "stake_no",
    args: [marketId],
    value: valueWei,
  });
}

export async function claimPayout(
  userAddress: string,
  marketId: string
): Promise<string> {
  return sendSponsoredWriteContract({
    userAddress,
    contractAddress: addr,
    functionName: "claim_payout",
    args: [marketId],
  });
}

export async function claimRefund(
  userAddress: string,
  marketId: string
): Promise<string> {
  return sendSponsoredWriteContract({
    userAddress,
    contractAddress: addr,
    functionName: "claim_refund",
    args: [marketId],
  });
}

// ── Receipt helpers ────────────────────────────────────────────────────────────

export interface ReceiptOutcome {
  status: "FINALIZED" | "PENDING" | "ERROR";
  executionResult: "SUCCESS" | "ERROR" | null;
  errorDescription: string | null;
}

// Waits for a tx to finalise with the given retry budget.
// Returns a normalised outcome regardless of the underlying receipt shape.
export async function waitForReceipt(
  txHash: string,
  retries = 300
): Promise<ReceiptOutcome> {
  const receipt = await deployerClient.waitForTransactionReceipt({
    hash: txHash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    retries,
  });
  const lr0 = (receipt as any).consensus_data?.leader_receipt?.[0];
  const execResult: "SUCCESS" | "ERROR" | null =
    lr0?.execution_result ?? null;
  const errorDescription: string | null =
    lr0?.genvm_result?.error_description ?? null;
  return {
    status: "FINALIZED",
    executionResult: execResult,
    errorDescription: execResult === "ERROR" ? errorDescription : null,
  };
}

// Non-blocking receipt check — polls once with retries:1.
// Returns null if the tx is not yet finalised.
export async function pollReceiptOnce(
  txHash: string
): Promise<ReceiptOutcome | null> {
  try {
    return await waitForReceipt(txHash, 1);
  } catch {
    return null; // not yet finalised
  }
}
