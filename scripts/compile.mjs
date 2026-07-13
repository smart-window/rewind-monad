import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
const sourcePath = path.join(root, "contracts", "RewindEscrow.sol");
const source = fs.readFileSync(sourcePath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "contracts/RewindEscrow.sol": { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // Shanghai bytecode keeps the artifact compatible with local Ganache while
    // remaining fully supported by Monad.
    evmVersion: "shanghai",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors ?? [];

for (const issue of errors) {
  const writer = issue.severity === "error" ? console.error : console.warn;
  writer(issue.formattedMessage);
}

if (errors.some((issue) => issue.severity === "error")) {
  process.exit(1);
}

const compiled = output.contracts["contracts/RewindEscrow.sol"].RewindEscrow;
const artifact = {
  contractName: "RewindEscrow",
  sourceName: "contracts/RewindEscrow.sol",
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
  metadata: compiled.metadata,
  compiler: solc.version(),
};

const artifactDir = path.join(root, "artifacts");
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(
  path.join(artifactDir, "RewindEscrow.json"),
  `${JSON.stringify(artifact, null, 2)}\n`,
);

console.log(`Compiled RewindEscrow with ${solc.version()}`);
