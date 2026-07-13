import fs from "node:fs";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

const privateKey = process.env.PRIVATE_KEY;
const rpcUrl = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";
const expectedChainId = BigInt(process.env.EXPECTED_CHAIN_ID ?? "10143");

if (!privateKey) {
  throw new Error("Set PRIVATE_KEY in .env. Never commit that file.");
}

const artifact = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "artifacts", "RewindEscrow.json"), "utf8"),
);
const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();

if (network.chainId !== expectedChainId) {
  throw new Error(`Expected chain ${expectedChainId}, connected to ${network.chainId}.`);
}

const signer = new Wallet(privateKey, provider);
const balance = await provider.getBalance(signer.address);
console.log(`Deploying from ${signer.address} with ${balance} wei`);

const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
const contract = await factory.deploy();
await contract.waitForDeployment();
const address = await contract.getAddress();
const receipt = await contract.deploymentTransaction().wait();

const deployment = {
  contract: "RewindEscrow",
  address,
  chainId: Number(network.chainId),
  deployer: signer.address,
  transactionHash: receipt.hash,
  blockNumber: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
};

const deploymentsDir = path.join(process.cwd(), "deployments");
fs.mkdirSync(deploymentsDir, { recursive: true });
fs.writeFileSync(
  path.join(deploymentsDir, `${network.chainId}.json`),
  `${JSON.stringify(deployment, null, 2)}\n`,
);

console.log(`RewindEscrow deployed to ${address}`);
console.log(`Set VITE_CONTRACT_ADDRESS=${address} in .env, then run npm run build.`);
