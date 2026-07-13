# Rewind

**A safety window for crypto transfers on Monad.**

Rewind solves a small, personal problem: the moment of panic after sending crypto and wondering whether the recipient address was correct. Instead of transferring immediately, Rewind holds native MON in a public smart contract for a short period. The sender can cancel while the window is open; afterward, anyone can trigger delivery to the intended recipient.

The product is intentionally narrow. It does one real thing end-to-end and exposes every state transition onchain.

## Product flow

1. Connect a browser wallet to Monad Testnet.
2. Enter a recipient, an amount, and a 1-, 5-, or 30-minute safety window.
3. Rewind escrows the MON and displays the live transfer from contract storage.
4. During the window, only the original sender can cancel and recover the funds.
5. When the window closes, anyone can trigger settlement to the recipient.

There is no owner, admin key, backend, database, platform fee, or placeholder transaction feed.

## Architecture

```text
Browser wallet
     │
     │ create / cancel / release
     ▼
RewindEscrow.sol ───────► Recipient
     │                  after releaseAt
     │ getTransfer
     ▼
React + ethers frontend
     │
     └──── Monad Testnet RPC + MonadVision links
```

- `contracts/RewindEscrow.sol` — native-MON time-delayed escrow.
- `test/RewindEscrow.test.mjs` — local end-to-end contract tests on Ganache.
- `scripts/compile.mjs` — reproducible Solidity compilation.
- `scripts/deploy.mjs` — guarded Monad Testnet deployment.
- `src/App.tsx` — wallet, live-state, countdown, cancellation, and settlement UI.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
cp .env.example .env
npm test
npm run dev
```

Until a deployed contract is configured, the UI presents an honest deployment-pending and empty state. It never inserts sample transactions.

## Deploy to Monad Testnet

1. Create a fresh deployment wallet and fund it with test MON from the [Monad faucet](https://faucet.monad.xyz).
2. Copy `.env.example` to `.env`.
3. Set `PRIVATE_KEY` in `.env`. Never commit or share this file.
4. Deploy:

```bash
npm run deploy:testnet
```

The script refuses to deploy unless the connected chain ID is `10143`. It writes public deployment metadata to `deployments/10143.json` and prints the contract address.

5. Add the printed address to `.env`:

```dotenv
VITE_CONTRACT_ADDRESS=0xYourDeployedContract
```

6. Build and verify the production bundle:

```bash
npm run build
npm run preview
```

Deploy the generated `dist/` directory to Vercel, Netlify, Cloudflare Pages, or another static host. Add `VITE_CONTRACT_ADDRESS` and `VITE_RPC_URL` to the host's build environment.

## Contract guarantees

- Transfers cannot use the zero address or the sender as recipient.
- The amount must be nonzero.
- Delay must be between 30 seconds and 30 days.
- Only the original sender can cancel.
- Cancellation closes exactly when settlement becomes available.
- State changes occur before external value transfers.
- A reentrancy guard protects payout functions.
- Failed payouts revert the complete state transition.
- Direct native-token payments revert, preventing untracked balances.
- A transfer cannot be cancelled or released twice.

Run all six behavior and adversarial tests with `npm test`.

## Verification checklist

Before submitting:

- [ ] Deploy `RewindEscrow` after the hackathon start time.
- [ ] Add the address to `.env` and the public deployment JSON to Git.
- [ ] Verify the contract source in MonadVision or Monadscan.
- [ ] Create, cancel, and settle real testnet transfers through the hosted UI.
- [ ] Confirm explorer links and the recent-transfer feed use the deployed address.
- [ ] Replace every bracketed field in `SUBMISSION.md`.
- [ ] Record the demo using the script in `SUBMISSION.md`.
- [ ] Keep the demo under three minutes and make it publicly viewable.

## Network

- Chain: Monad Testnet
- Chain ID: `10143`
- RPC: `https://testnet-rpc.monad.xyz`
- Explorer: `https://testnet.monadvision.com`
- Currency: MON

Network details come from the [official Monad documentation](https://docs.monad.xyz/developer-essentials/testnets).

## Security scope

This is hackathon software and has not received a professional audit. Use testnet funds for evaluation. See [SECURITY.md](SECURITY.md) for assumptions and known limitations.

## License

MIT
