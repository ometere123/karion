import dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, createAccount } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { TransactionHash } from "genlayer-js/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const PRIVATE_KEY = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("GENLAYER_DEPLOYER_PRIVATE_KEY not set in .env");
  process.exit(1);
}

// StudioNet shares chain ID 61999 with localnet — only the RPC URL differs.
const studionet = { ...localnet } as typeof localnet;
(studionet as any).name = "GenLayer StudioNet";
(studionet as any).rpcUrls = {
  default: { http: ["https://studio.genlayer.com/api"] },
};

async function main() {
  const account = createAccount(PRIVATE_KEY as `0x${string}`);
  console.log(`Deployer: ${account.address}`);

  const client = createClient({ chain: studionet as any, account });

  console.log("Initializing consensus contract...");
  await client.initializeConsensusSmartContract();
  console.log("Consensus contract ready.");

  const contractPath = path.resolve(
    __dirname,
    "../../../contracts/KarionMarket.py"
  );
  const contractCode = new Uint8Array(readFileSync(contractPath));
  console.log(`Contract: ${contractPath} (${contractCode.length} bytes)`);
  console.log("Deploying KarionMarket...");

  const txHash = await client.deployContract({
    code: contractCode,
    args: [],
  });
  console.log(`Deploy tx hash: ${txHash}`);
  console.log("Waiting for FINALIZED...");

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    retries: 300,
  });

  if (
    receipt.status !== TransactionStatus.FINALIZED &&
    receipt.status !== TransactionStatus.ACCEPTED
  ) {
    console.error("Deployment failed. Receipt:", JSON.stringify(receipt, null, 2));
    process.exit(1);
  }

  const contractAddress = (receipt.data as any)?.contract_address as
    | string
    | undefined;
  if (!contractAddress) {
    console.error(
      "No contract_address in receipt.data:",
      JSON.stringify(receipt.data)
    );
    process.exit(1);
  }

  console.log("\n✓ Contract deployed successfully!");
  console.log(`  Address : ${contractAddress}`);
  console.log(`  Status  : ${receipt.status}`);
  console.log("\nAdd to apps/api/.env:");
  console.log(`GENLAYER_CONTRACT_ADDRESS="${contractAddress}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
