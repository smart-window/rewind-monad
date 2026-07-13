import { JsonRpcProvider, ZeroAddress, isAddress } from "ethers";

export const MONAD_TESTNET = {
  chainId: 10143,
  chainIdHex: "0x279f",
  name: "Monad Testnet",
  currency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrl: import.meta.env.VITE_RPC_URL || "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadvision.com",
  faucetUrl: "https://faucet.monad.xyz",
} as const;

const configuredAddress = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() ?? "";

export const CONTRACT_ADDRESS =
  configuredAddress && isAddress(configuredAddress) ? configuredAddress : ZeroAddress;
export const HAS_CONTRACT_ADDRESS = CONTRACT_ADDRESS !== ZeroAddress;

export const readProvider = new JsonRpcProvider(
  MONAD_TESTNET.rpcUrl,
  { chainId: MONAD_TESTNET.chainId, name: MONAD_TESTNET.name },
  { staticNetwork: true },
);

export const REWIND_ABI = [
  {
    type: "function",
    name: "nextTransferId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTransfer",
    stateMutability: "view",
    inputs: [{ name: "transferId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "releaseAt", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "createTransfer",
    stateMutability: "payable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "delaySeconds", type: "uint64" },
    ],
    outputs: [{ name: "transferId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelTransfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "transferId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "releaseTransfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "transferId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "TransferCreated",
    anonymous: false,
    inputs: [
      { name: "transferId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "releaseAt", type: "uint64", indexed: false },
    ],
  },
] as const;
