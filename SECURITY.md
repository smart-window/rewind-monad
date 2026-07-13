# Security notes

Rewind is a hackathon prototype and has not received a professional security audit. The initial deployment should be evaluated with Monad Testnet funds only.

## Trust model

- The contract has no owner, administrator, upgrade mechanism, pause function, or fee recipient.
- The sender chooses the recipient and release delay at creation.
- Only the sender can cancel before `releaseAt`.
- Anyone can call settlement after `releaseAt`; the destination cannot be changed.
- The frontend is optional. Users can inspect and call the verified contract directly.

## Known limitations

- Rewind protects only native MON, not ERC-20 tokens or NFTs.
- A recipient contract that refuses native MON will prevent settlement until it can accept payment. Funds remain pending because failed payouts revert.
- Settlement is not automated by a keeper. Any account must call `releaseTransfer` after maturity.
- Public-chain transfers reveal sender, recipient, amount, and timing.
- A malicious or compromised hosted frontend could present a false recipient. Users should verify wallet transaction details and the deployed contract address.

## Reporting an issue

Open a GitHub issue without including private keys, seed phrases, or other sensitive information. For an issue that could put deployed funds at immediate risk, contact the repository owner privately before publishing details.
