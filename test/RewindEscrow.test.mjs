import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import ganache from "ganache";
import solc from "solc";
import {
  BrowserProvider,
  ContractFactory,
  parseEther,
} from "ethers";

const artifact = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "artifacts", "RewindEscrow.json"), "utf8"),
);

const rejectingRecipientSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract RejectingRecipient {
    receive() external payable {
        revert("MON rejected");
    }
}
`;

const helperCompilation = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "RejectingRecipient.sol": { content: rejectingRecipientSource } },
      settings: {
        evmVersion: "shanghai",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);
const rejectingRecipientArtifact =
  helperCompilation.contracts["RejectingRecipient.sol"].RejectingRecipient;

describe("RewindEscrow", () => {
  let chain;
  let provider;
  let sender;
  let recipient;
  let stranger;
  let contract;

  before(() => {
    chain = ganache.provider({
      logging: { quiet: true },
      wallet: { totalAccounts: 5, defaultBalance: 1_000 },
      chain: { chainId: 10143, hardfork: "shanghai" },
    });
    provider = new BrowserProvider(chain);
  });

  after(async () => {
    await chain.disconnect();
  });

  beforeEach(async () => {
    sender = await provider.getSigner(0);
    recipient = await provider.getSigner(1);
    stranger = await provider.getSigner(2);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, sender);
    contract = await factory.deploy();
    await contract.waitForDeployment();
  });

  async function createTransfer({ delay = 60, value = "1" } = {}) {
    const tx = await contract.createTransfer(await recipient.getAddress(), delay, {
      value: parseEther(value),
    });
    await tx.wait();
    return 1n;
  }

  async function advanceTime(seconds) {
    await chain.request({ method: "evm_increaseTime", params: [seconds] });
    await chain.request({ method: "evm_mine", params: [] });
  }

  async function assertTxReverts(transactionPromise) {
    await assert.rejects(async () => {
      const transaction = await transactionPromise;
      await transaction.wait();
    });
  }

  async function rawBalance(address) {
    return BigInt(
      await chain.request({ method: "eth_getBalance", params: [address, "latest"] }),
    );
  }

  it("creates a funded delayed transfer with live contract state", async () => {
    const id = await createTransfer();
    const transfer = await contract.getTransfer(id);

    assert.equal(transfer.sender, await sender.getAddress());
    assert.equal(transfer.recipient, await recipient.getAddress());
    assert.equal(transfer.amount, parseEther("1"));
    assert.equal(transfer.status, 0n);
    assert.equal(await provider.getBalance(await contract.getAddress()), parseEther("1"));
    assert.equal(await contract.nextTransferId(), 2n);
  });

  it("rejects unsafe transfer inputs", async () => {
    await assertTxReverts(
      contract.createTransfer("0x0000000000000000000000000000000000000000", 60, {
        value: parseEther("1"),
      }),
    );
    await assertTxReverts(
      contract.createTransfer(await sender.getAddress(), 60, { value: parseEther("1") }),
    );
    await assertTxReverts(
      contract.createTransfer(await recipient.getAddress(), 29, { value: parseEther("1") }),
    );
    await assertTxReverts(
      contract.createTransfer(await recipient.getAddress(), 30 * 24 * 60 * 60 + 1, {
        value: parseEther("1"),
      }),
    );
    await assertTxReverts(
      contract.createTransfer(await recipient.getAddress(), 60, { value: 0 }),
    );
    assert.equal(await contract.nextTransferId(), 1n);
    assert.equal(await provider.getBalance(await contract.getAddress()), 0n);
  });

  it("lets only the sender cancel while the safety window is open", async () => {
    const id = await createTransfer();

    await assertTxReverts(contract.connect(stranger).cancelTransfer(id));
    await (await contract.cancelTransfer(id)).wait();

    const transfer = await contract.getTransfer(id);
    assert.equal(transfer.status, 2n);
    assert.equal(await provider.getBalance(await contract.getAddress()), 0n);
    await assertTxReverts(contract.cancelTransfer(id, { gasLimit: 300_000 }));
  });

  it("releases to the recipient only after the deadline", async () => {
    const id = await createTransfer();
    const balanceBefore = await rawBalance(await recipient.getAddress());

    await assertTxReverts(contract.connect(stranger).releaseTransfer(id));
    await advanceTime(61);
    await (await contract.connect(stranger).releaseTransfer(id, { gasLimit: 300_000 })).wait();

    const transfer = await contract.getTransfer(id);
    const balanceAfter = await rawBalance(await recipient.getAddress());
    assert.equal(transfer.status, 1n);
    assert.equal(balanceAfter - balanceBefore, parseEther("1"));
    assert.equal(await provider.getBalance(await contract.getAddress()), 0n);
    await assertTxReverts(contract.releaseTransfer(id, { gasLimit: 300_000 }));
  });

  it("closes cancellation exactly when settlement becomes available", async () => {
    const id = await createTransfer({ delay: 30 });
    await advanceTime(31);

    await assertTxReverts(contract.cancelTransfer(id));
    await (await contract.releaseTransfer(id)).wait();
    assert.equal((await contract.getTransfer(id)).status, 1n);
  });

  it("rejects direct payments so funds cannot become untracked", async () => {
    await assertTxReverts(
      sender.sendTransaction({ to: await contract.getAddress(), value: parseEther("0.1") }),
    );
  });

  it("keeps a transfer pending and funded when its recipient rejects the payout", async () => {
    const rejectingFactory = new ContractFactory(
      rejectingRecipientArtifact.abi,
      `0x${rejectingRecipientArtifact.evm.bytecode.object}`,
      sender,
    );
    const rejectingRecipient = await rejectingFactory.deploy();
    await rejectingRecipient.waitForDeployment();

    await (
      await contract.createTransfer(await rejectingRecipient.getAddress(), 30, {
        value: parseEther("1"),
      })
    ).wait();
    await advanceTime(31);

    await assertTxReverts(contract.releaseTransfer(1n, { gasLimit: 300_000 }));

    const transfer = await contract.getTransfer(1n);
    assert.equal(transfer.status, 0n);
    assert.equal(await provider.getBalance(await contract.getAddress()), parseEther("1"));
  });

  it("keeps escrow accounting exact across delivered, rewound, and pending transfers", async () => {
    const recipientAddress = await recipient.getAddress();
    for (const [value, delay] of [["1", 30], ["2", 90], ["3", 120]]) {
      await (
        await contract.createTransfer(recipientAddress, delay, {
          value: parseEther(value),
        })
      ).wait();
    }

    await (await contract.cancelTransfer(2n)).wait();
    await advanceTime(31);
    await (await contract.releaseTransfer(1n)).wait();

    assert.equal((await contract.getTransfer(1n)).status, 1n);
    assert.equal((await contract.getTransfer(2n)).status, 2n);
    assert.equal((await contract.getTransfer(3n)).status, 0n);
    assert.equal(await contract.nextTransferId(), 4n);
    assert.equal(await provider.getBalance(await contract.getAddress()), parseEther("3"));
  });
});
