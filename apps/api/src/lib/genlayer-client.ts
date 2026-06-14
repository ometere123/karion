// genlayer-client.ts
// Singleton GenLayer client configuration and utility helpers.
//
// SECURITY: GENLAYER_DEPLOYER_PRIVATE_KEY is read once at module load and used
// only to create the account object. It is never logged or serialised.
//
// SPONSORSHIP MODEL (StudioNet constraint):
// On StudioNet, only the pre-authorized deployer account can call
// ConsensusMain.addTransaction at the EVM layer. However, the `_sender`
// parameter in addTransaction is what GenLayer uses as gl.message.sender_address
// inside the Python contract — it is NOT derived from EVM msg.sender.
// We exploit this: the deployer signs all EVM transactions, but each user's
// wallet address is passed as `_sender`, so the contract attributes stakes,
// positions, and payouts to the correct user address.

import { createClient, createAccount, abi as glAbi } from "genlayer-js";
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

// Sends a GenLayer write transaction on behalf of a user address.
// The deployer account signs the EVM transaction (it is pre-authorized on
// StudioNet), but the user's wallet address is passed as `_sender` in the
// ConsensusMain.addTransaction call. GenLayer uses that address as
// gl.message.sender_address inside the Python contract, correctly attributing
// stakes and payouts to the user.
export async function sendSponsoredWriteContract(params: {
  userAddress: string;
  contractAddress: string;
  functionName: string;
  args?: unknown[];
  value?: bigint;
}): Promise<string> {
  await consensusReady;

  const chain = studionet as any;
  const consensusAddress: `0x${string}` = chain.consensusMainContract?.address;
  const consensusAbi = chain.consensusMainContract?.abi;

  if (!consensusAbi) {
    throw new Error("Consensus contract ABI not available");
  }

  // Encode the inner GenLayer calldata (the KarionMarket function call).
  // Only include args if non-empty, mirroring genlayer-js makeCalldataObject.
  const calldataObj: Record<string, unknown> = { method: params.functionName };
  if (params.args && params.args.length > 0) calldataObj.args = params.args;
  const innerCalldata = glAbi.calldata.encode(calldataObj as any);

  // Serialize to the transaction data bytes GenLayer expects.
  const txData = glAbi.transactions.serialize([innerCalldata, false]);

  // Encode the ConsensusMain.addTransaction call with user's address as sender.
  const encodedCalldata = encodeFunctionData({
    abi: consensusAbi,
    functionName: "addTransaction",
    args: [
      params.userAddress,
      params.contractAddress,
      chain.defaultNumberOfInitialValidators ?? 5,
      chain.defaultConsensusMaxRotations ?? 3,
      txData,
    ],
  });

  // Get the deployer's current nonce.
  const nonce = await (deployerClient as any).getCurrentNonce({
    address: deployerAccount.address,
  });

  // Build the EVM transaction — deployer is the from address.
  const txRequest = await deployerClient.prepareTransactionRequest({
    account: deployerAccount,
    to: consensusAddress,
    data: encodedCalldata,
    type: "legacy",
    nonce,
    value: params.value ?? 0n,
  } as any);

  // Sign with deployer's private key.
  const signed = await deployerAccount.signTransaction(txRequest as any);

  // Send via eth_sendRawTransaction — deployer is authorized on StudioNet.
  return (deployerClient as any).sendRawTransaction({
    serializedTransaction: signed,
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
