// genlayer-client.ts
// Singleton GenLayer client configuration and utility helpers.
//
// SECURITY: GENLAYER_DEPLOYER_PRIVATE_KEY is read once at module load and used
// only to create the account object. It is never logged or serialised.
//
// TRANSACTION MODEL:
// User-funded staking: stake_yes, stake_no, claim_payout, claim_refund are
// submitted by the user's embedded wallet account via sendUserFundedWriteContract.
// The user's wallet signs the EVM transaction and pays the GEN stake value.
// gl.message.sender_address in the Python contract is the user's wallet address.
//
// Admin-only writes (create_market, lock_market, resolve_market) use the deployer
// account via deployerClient.writeContract directly — no value is transferred.

import { createClient, createAccount, abi as glAbi } from "genlayer-js";
import type { Account } from "viem";
import { localnet } from "genlayer-js/chains";
import { encodeFunctionData } from "viem";

// StudioNet inherits the localnet chain ID (61999) with a live RPC endpoint.
const studionet = {
  ...localnet,
  name: "GenLayer StudioNet",
  rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
} as typeof localnet;

export const CONTRACT_ADDRESS =
  process.env.GENLAYER_CONTRACT_ADDRESS as `0x${string}`;

// SECURITY: deployer private key is never logged.
export const deployerAccount = createAccount(
  process.env.GENLAYER_DEPLOYER_PRIVATE_KEY as `0x${string}`
);

export const deployerClient = createClient({
  chain: studionet as any,
  account: deployerAccount,
});

// Consensus contract initializes asynchronously at client creation.
// Store the promise so sendSponsoredWriteContract can await it on first call.
const consensusReady: Promise<void> = new Promise((resolve, reject) => {
  // createClient fires initializeConsensusSmartContract internally.
  // Poll until the address is set (non-null, non-zero-address is OK on StudioNet).
  let attempts = 0;
  const check = () => {
    attempts++;
    if ((studionet as any).consensusMainContract?.abi) {
      resolve();
    } else if (attempts > 20) {
      reject(new Error("Consensus contract initialization timed out"));
    } else {
      setTimeout(check, 300);
    }
  };
  setTimeout(check, 300);
});

// Sends a GenLayer write transaction signed and funded by the user's embedded
// wallet. The user account signs the EVM transaction, pays the GEN value, and
// is passed as _sender in ConsensusMain.addTransaction — so gl.message.sender_address
// inside the Python contract is the user's address. The deployer does not pay
// and does not appear as sender in contract state.
//
// Uses deployerClient's already-initialized chain (consensusMainContract address
// and ABI) so no second initialization round-trip is needed.
export async function sendUserFundedWriteContract(params: {
  userAccount: Account;
  contractAddress: string;
  functionName: string;
  args?: unknown[];
  value?: bigint;
}): Promise<string> {
  await consensusReady;

  return deployerClient.writeContract({
    account: params.userAccount,
    address: params.contractAddress as any,
    functionName: params.functionName,
    args: params.args as any,
    value: params.value ?? 0n,
  }) as Promise<string>;
}

// Admin-only deployer write — used for create_market, lock_market, resolve_market.
// No value is transferred; the deployer is the authorized admin submitter.
export async function sendDeployerWriteContract(params: {
  contractAddress: string;
  functionName: string;
  args?: unknown[];
}): Promise<string> {
  await consensusReady;

  return deployerClient.writeContract({
    address: params.contractAddress as any,
    functionName: params.functionName,
    args: params.args as any,
    value: 0n,
  }) as Promise<string>;
}

// Recursively converts Map<string, unknown> → plain object and BigInt → string.
// GenLayer readContract returns Python dicts as JS Map objects and integer fields
// as BigInt. Both must be normalised before the result is JSON-serialisable.
export function mapToObj(val: unknown): unknown {
  if (val instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of val.entries()) {
      obj[k] = mapToObj(v);
    }
    return obj;
  }
  if (Array.isArray(val)) return val.map(mapToObj);
  if (typeof val === "bigint") return val.toString();
  return val;
}
