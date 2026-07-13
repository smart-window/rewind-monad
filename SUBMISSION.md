# Spark submission kit

Replace the bracketed fields after deploying and hosting.

## Name

Rewind

## Description

An undo window for crypto transfers on Monad.

## Problem

Every crypto transfer gives me the same anxious thought: “Did I paste the right address?” Traditional transfers settle before a human has time to notice a mistake. A single typo or clipboard error can turn into a permanent loss.

## Solution

Rewind adds a short, transparent safety window to native MON transfers. Funds wait in a public Monad contract for 1, 5, or 30 minutes. During that window, only the sender can cancel and recover them. Afterward, anyone can settle the transfer to the intended recipient. The app reads all transfer state directly from Monad—there is no database, admin, or fake activity feed.

## Required links

- Project URL: `https://smart-window.github.io/rewind-monad/`
- GitHub repository: `https://github.com/smart-window/rewind-monad`
- Category: Monad Testnet
- Contract address: `0x1FBFd6D8B06C3258d1Ca664a714303797eb48c87`
- Demo video: `[PUBLIC_DEMO_VIDEO_URL]`
- Social post: `[SOCIAL_POST_URL]`

## 90-second demo script

### 0:00–0:10 — The problem

“Every time I send crypto, I have the same thought one second too late: did I paste the right address? Rewind gives me a few minutes to answer that question.”

### 0:10–0:28 — Create a real transfer

- Show the recipient, `0.01 MON`, and the one-minute option.
- Click **Send with Rewind** and approve the wallet transaction.
- Open the MonadVision transaction link briefly.

Narration: “The MON is now held by a public Monad contract—not by a Rewind account or backend.”

### 0:28–0:48 — Prove it is live

- Scroll to **Recent protected transfers**.
- Show the real sender, recipient, amount, countdown, and contract block number.
- Refresh the page to demonstrate that the state survives and comes from the chain.

### 0:48–1:03 — Rewind

- Click **Rewind**, approve, and show the status changing to **Rewound**.
- Open the cancellation transaction on MonadVision.

Narration: “Only the original sender can do this, and only while the safety window is open.”

### 1:03–1:20 — Deliver

- Show a second transfer whose window has closed.
- Click **Settle** and show it changing to **Delivered**.

Narration: “After the deadline, anyone can trigger delivery, but nobody can redirect it.”

### 1:20–1:30 — Close

“Rewind is one real feature, fully onchain: crypto speed with human reaction time.”

## Social launch post

> I built an undo button for crypto ↶
>
> Rewind holds a MON transfer for a few minutes before delivery. Paste the wrong address? Cancel it. Everything look right? Let it settle.
>
> No backend. No admin. No fake data. Just one small pause on @monad.
>
> https://smart-window.github.io/rewind-monad/
>
> Built for @buildanythingso Spark ✨

Suggested follow-up posts:

1. A 15-second screen recording: create → live countdown → rewind.
2. A contract diagram emphasizing “no owner, no fees.”
3. A real metric after launch: protected MON, completed transfers, or unique wallets.

## Final submission review

- The hosted homepage works in a private/incognito window.
- Wallet connection adds or switches to Monad Testnet.
- A judge with test MON can finish the full flow without instructions.
- Every button works twice across separate transfers.
- The repository is public and has meaningful commit history after the event start.
- `README.md` contains the deployed address and current screenshots.
- Deployment metadata and verified source match the submission address.
- The video is public and shorter than three minutes.
- The social post link is included for the viral prize.
