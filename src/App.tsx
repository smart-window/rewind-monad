import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserProvider,
  Contract,
  ContractTransactionReceipt,
  Eip1193Provider,
  formatEther,
  getAddress,
  isAddress,
  isError,
  parseEther,
} from "ethers";
import {
  CONTRACT_ADDRESS,
  HAS_CONTRACT_ADDRESS,
  MONAD_TESTNET,
  REWIND_ABI,
  readProvider,
} from "./lib/contract";

type TransferStatus = 0 | 1 | 2;

type RewindTransfer = {
  id: bigint;
  sender: string;
  recipient: string;
  amount: bigint;
  releaseAt: number;
  status: TransferStatus;
};

type Notice = {
  tone: "success" | "error" | "info";
  title: string;
  message: string;
  hash?: string;
};

const DELAYS = [
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "30 min", value: 1_800 },
] as const;

function ArrowUpRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5h14.5A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18V6a1.5 1.5 0 0 1 1.5-1.5H17" />
      <path d="M15.5 12h4.5v4h-4.5a2 2 0 1 1 0-4Z" />
      <circle cx="16" cy="14" r=".5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.5 3.1 7.8 7.5 9.5 4.4-1.7 7.5-5 7.5-9.5V6L12 3Z" />
      <path d="m8.7 12.2 2.1 2.1 4.6-4.7" />
    </svg>
  );
}

function RewindMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`rewind-mark${small ? " rewind-mark--small" : ""}`} aria-hidden="true">
      <span>↶</span>
    </span>
  );
}

function shortAddress(address: string, size = 4) {
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

function cleanAmount(value: bigint) {
  const amount = Number(formatEther(value));
  return amount.toLocaleString(undefined, { maximumFractionDigits: 5 });
}

function remainingTime(releaseAt: number, now: number) {
  const seconds = Math.max(0, releaseAt - now);
  if (seconds === 0) return "Ready";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function friendlyError(error: unknown) {
  if (isError(error, "TRANSACTION_REPLACED") && error.cancelled) {
    return "The pending transaction was cancelled in your wallet.";
  }
  if (!(error instanceof Error)) return "Something went wrong. Please try again.";
  const message = error.message;
  if (message.includes("user rejected") || message.includes("ACTION_REJECTED")) {
    return "The wallet request was cancelled.";
  }
  if (message.includes("insufficient funds")) {
    return "This wallet does not have enough MON for the transfer and gas.";
  }
  if (message.includes("SafetyWindowOpen")) return "This transfer is still inside its safety window.";
  if (message.includes("SafetyWindowClosed")) return "The safety window has already closed.";
  return "The transaction could not be completed. Check your wallet and try again.";
}

async function waitForConfirmedHash(transaction: {
  wait: () => Promise<ContractTransactionReceipt | null>;
}) {
  try {
    const receipt = await transaction.wait();
    if (!receipt) throw new Error("Transaction confirmation unavailable");
    return receipt.hash;
  } catch (error) {
    if (isError(error, "TRANSACTION_REPLACED") && !error.cancelled) return error.receipt.hash;
    throw error;
  }
}

async function switchToMonad() {
  if (!window.ethereum) throw new Error("No injected wallet");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MONAD_TESTNET.chainIdHex }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: MONAD_TESTNET.chainIdHex,
          chainName: MONAD_TESTNET.name,
          nativeCurrency: MONAD_TESTNET.currency,
          rpcUrls: [MONAD_TESTNET.rpcUrl],
          blockExplorerUrls: [MONAD_TESTNET.explorerUrl],
        },
      ],
    });
  }
}

function App() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [delay, setDelay] = useState<number>(300);
  const [transfers, setTransfers] = useState<RewindTransfer[]>([]);
  const [contractReady, setContractReady] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const chainTimeOffset = useRef(0);

  const contractExplorerUrl = `${MONAD_TESTNET.explorerUrl}/address/${CONTRACT_ADDRESS}`;

  const refreshTransfers = useCallback(async () => {
    if (!HAS_CONTRACT_ADDRESS) {
      setContractReady(false);
      setFeedError(false);
      setLoadingFeed(false);
      return;
    }

    try {
      const code = await readProvider.getCode(CONTRACT_ADDRESS);
      if (code === "0x") {
        setContractReady(false);
        setFeedError(false);
        setLoadingFeed(false);
        return;
      }

      setContractReady(true);
      const readContract = new Contract(CONTRACT_ADDRESS, REWIND_ABI, readProvider);
      const nextId = (await readContract.nextTransferId()) as bigint;
      const newestId = nextId - 1n;
      const firstId = newestId > 11n ? newestId - 11n : 1n;
      const ids: bigint[] = [];
      for (let id = newestId; id >= firstId && id > 0n; id -= 1n) ids.push(id);

      const loaded = await Promise.all(
        ids.map(async (id) => {
          const item = await readContract.getTransfer(id);
          return {
            id,
            sender: item.sender as string,
            recipient: item.recipient as string,
            amount: item.amount as bigint,
            releaseAt: Number(item.releaseAt),
            status: Number(item.status) as TransferStatus,
          } satisfies RewindTransfer;
        }),
      );
      setTransfers(loaded);
      const latestBlock = await readProvider.getBlock("latest");
      if (latestBlock) {
        const chainNow = Number(latestBlock.timestamp);
        chainTimeOffset.current = chainNow - Math.floor(Date.now() / 1000);
        setNow(chainNow);
        setBlockNumber(latestBlock.number);
      }
      setFeedError(false);
    } catch {
      setFeedError(true);
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const refreshWallet = useCallback(async (requestedAccount?: string) => {
    if (!window.ethereum) return;
    try {
      const browserProvider = new BrowserProvider(window.ethereum as Eip1193Provider);
      const accounts =
        requestedAccount !== undefined
          ? requestedAccount
            ? [requestedAccount]
            : []
          : ((await browserProvider.send("eth_accounts", [])) as string[]);
      const nextAccount = accounts[0] ?? "";
      setAccount(nextAccount);
      setBalance(null);
      if (!nextAccount) return;

      try {
        setBalance(await readProvider.getBalance(nextAccount));
      } catch {
        setBalance(null);
      }
    } catch {
      setAccount("");
      setBalance(null);
    }
  }, []);

  useEffect(() => {
    void refreshTransfers();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshTransfers();
    };
    const feedInterval = window.setInterval(refreshWhenVisible, 15_000);
    const clockInterval = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000) + chainTimeOffset.current),
      1_000,
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(feedInterval);
      window.clearInterval(clockInterval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshTransfers]);

  useEffect(() => {
    void refreshWallet();
    const handleAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      void refreshWallet(accounts?.[0] ?? "");
    };
    const handleChain = () => void refreshWallet();
    window.ethereum?.on?.("accountsChanged", handleAccounts);
    window.ethereum?.on?.("chainChanged", handleChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum?.removeListener?.("chainChanged", handleChain);
    };
  }, [refreshWallet]);

  const stats = useMemo(() => {
    const protectedAmount = transfers.reduce((sum, transfer) => sum + transfer.amount, 0n);
    const rewound = transfers.filter((transfer) => transfer.status === 2).length;
    return { protectedAmount, rewound };
  }, [transfers]);

  async function connectWallet() {
    if (!window.ethereum) {
      setNotice({
        tone: "error",
        title: "Wallet not found",
        message: "Install a browser wallet such as MetaMask or Phantom, then refresh this page.",
      });
      return;
    }
    try {
      setBusy("connect");
      await switchToMonad();
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      await refreshWallet(accounts[0]);
    } catch (error) {
      setNotice({ tone: "error", title: "Could not connect", message: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  }

  async function signerContract() {
    if (!window.ethereum) throw new Error("No injected wallet");
    await switchToMonad();
    const provider = new BrowserProvider(window.ethereum as Eip1193Provider);
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(MONAD_TESTNET.chainId)) throw new Error("Wrong network");
    return new Contract(CONTRACT_ADDRESS, REWIND_ABI, await provider.getSigner());
  }

  async function createTransfer(event: FormEvent) {
    event.preventDefault();
    setNotice(null);

    if (!contractReady) {
      setNotice({
        tone: "error",
        title: feedError ? "Monad is temporarily unavailable" : "Contract is not live",
        message: feedError
          ? "Rewind could not confirm the live contract. Retry when the network reconnects."
          : "The Rewind contract has not been deployed at this address yet.",
      });
      return;
    }
    if (!account) {
      await connectWallet();
      return;
    }
    if (!isAddress(recipient)) {
      setNotice({ tone: "error", title: "Check the recipient", message: "Enter a valid EVM address." });
      return;
    }
    if (getAddress(recipient) === getAddress(account)) {
      setNotice({
        tone: "error",
        title: "That is your wallet",
        message: "Choose a different recipient so Rewind can protect a real transfer.",
      });
      return;
    }

    let value: bigint;
    try {
      value = parseEther(amount);
      if (value <= 0n) throw new Error("Zero amount");
    } catch {
      setNotice({ tone: "error", title: "Check the amount", message: "Enter an amount greater than zero." });
      return;
    }
    if (balance !== null && value >= balance) {
      setNotice({
        tone: "error",
        title: "Not enough MON",
        message: "Lower the amount so your wallet keeps enough MON to pay network gas.",
      });
      return;
    }

    try {
      setBusy("create");
      const contract = await signerContract();
      const transaction = await contract.createTransfer(getAddress(recipient), delay, { value });
      setNotice({
        tone: "info",
        title: "Opening your safety window",
        message: "Your transaction is being confirmed on Monad.",
        hash: transaction.hash,
      });
      const confirmedHash = await waitForConfirmedHash(transaction);
      setAmount("");
      setRecipient("");
      setNotice({
        tone: "success",
        title: "Transfer protected",
        message: `You have ${DELAYS.find((item) => item.value === delay)?.label ?? "time"} to change your mind.`,
        hash: confirmedHash,
      });
      await Promise.all([refreshTransfers(), refreshWallet(account)]);
      document.querySelector("#live")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setNotice({ tone: "error", title: "Transfer not created", message: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  }

  async function actOnTransfer(transfer: RewindTransfer, action: "cancel" | "release") {
    if (!account) {
      await connectWallet();
      return;
    }
    try {
      setBusy(`${action}-${transfer.id}`);
      const contract = await signerContract();
      const transaction =
        action === "cancel"
          ? await contract.cancelTransfer(transfer.id)
          : await contract.releaseTransfer(transfer.id);
      setNotice({
        tone: "info",
        title: action === "cancel" ? "Rewinding transfer" : "Settling transfer",
        message: "Waiting for Monad to confirm the transaction.",
        hash: transaction.hash,
      });
      const confirmedHash = await waitForConfirmedHash(transaction);
      setNotice({
        tone: "success",
        title: action === "cancel" ? "Transfer rewound" : "Transfer settled",
        message:
          action === "cancel"
            ? "The escrowed MON has been returned to the sender."
            : "The escrowed MON has reached its recipient.",
        hash: confirmedHash,
      });
      await Promise.all([refreshTransfers(), refreshWallet(account)]);
    } catch (error) {
      setNotice({
        tone: "error",
        title: action === "cancel" ? "Could not rewind" : "Could not settle",
        message: friendlyError(error),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Rewind home">
          <RewindMark small />
          <span>rewind</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#live">Live transfers</a>
          {HAS_CONTRACT_ADDRESS && (
            <a href={contractExplorerUrl} target="_blank" rel="noreferrer">
              Contract <ArrowUpRightIcon />
            </a>
          )}
        </nav>
        <button className="wallet-button" type="button" onClick={connectWallet} disabled={busy !== null}>
          <WalletIcon />
          {account ? shortAddress(account) : busy === "connect" ? "Connecting…" : "Connect wallet"}
        </button>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span /> Built on Monad · No fees, no owner</div>
            <h1>
              Make every send
              <span className="headline-accent"> reversible.</span>
            </h1>
            <p className="hero-lede">
              Rewind holds your crypto for a few minutes before delivery—so a typo never has to become
              an expensive lesson.
            </p>
            <div className="hero-proof">
              <div className="avatar-stack" aria-hidden="true">
                <span>0x</span><span>↶</span><span>✓</span>
              </div>
              <p><strong>One tiny pause.</strong><br />A lot less wallet anxiety.</p>
            </div>
          </div>

          <div className="send-card-wrap">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <form className="send-card" onSubmit={createTransfer}>
              <div className="send-card__header">
                <div>
                  <span className="kicker">Protected transfer</span>
                  <h2>Send with a safety window</h2>
                </div>
                <RewindMark />
              </div>

              {feedError && !loadingFeed ? (
                <div className="setup-banner">
                  <span className="setup-banner__dot" />
                  <div>
                    <strong>Monad connection interrupted</strong>
                    <p>Live state could not refresh. Rewind will keep retrying automatically.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLoadingFeed(true);
                      void refreshTransfers();
                    }}
                  >
                    Retry now
                  </button>
                </div>
              ) : !contractReady && !loadingFeed ? (
                <div className="setup-banner">
                  <span className="setup-banner__dot" />
                  <div>
                    <strong>Deployment pending</strong>
                    <p>Add the deployed contract address to enable real transfers.</p>
                  </div>
                </div>
              ) : null}

              <label>
                <span>Recipient</span>
                <input
                  type="text"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <label>
                <span>Amount</span>
                <div className="amount-input">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                  />
                  <strong>MON</strong>
                </div>
                <small>
                  {account
                    ? balance === null
                      ? "Monad balance unavailable · your wallet will verify"
                      : `${cleanAmount(balance)} MON available`
                    : "Connect a wallet to see your balance"}
                </small>
              </label>

              <fieldset>
                <legend>Safety window</legend>
                <div className="delay-options">
                  {DELAYS.map((item) => (
                    <button
                      className={delay === item.value ? "active" : ""}
                      type="button"
                      key={item.value}
                      aria-pressed={delay === item.value}
                      onClick={() => setDelay(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="route-preview">
                <div><span className="route-node">YOU</span><small>Now</small></div>
                <div className="route-line"><span style={{ width: `${Math.min(94, 22 + delay / 22)}%` }} /></div>
                <div><span className="route-node route-node--end">TO</span><small>After {DELAYS.find((item) => item.value === delay)?.label}</small></div>
              </div>

              <button className="primary-action" type="submit" disabled={busy !== null || loadingFeed}>
                {busy === "create" ? "Protecting transfer…" : account ? "Send with Rewind" : "Connect wallet to send"}
                <span>↗</span>
              </button>
              <p className="microcopy"><ShieldIcon /> Funds stay in the public contract until release.</p>
            </form>
          </div>
        </section>

        {notice && (
          <aside
            className={`notice notice--${notice.tone}`}
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live={notice.tone === "error" ? "assertive" : "polite"}
          >
            <div className="notice-icon">{notice.tone === "success" ? "✓" : notice.tone === "error" ? "!" : "…"}</div>
            <div>
              <strong>{notice.title}</strong>
              <p>{notice.message}</p>
            </div>
            {notice.hash && (
              <a href={`${MONAD_TESTNET.explorerUrl}/tx/${notice.hash}`} target="_blank" rel="noreferrer">
                View transaction <ArrowUpRightIcon />
              </a>
            )}
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button>
          </aside>
        )}

        <section className="principle-strip" aria-label="Product principles">
          <div><span>01</span><strong>Non-custodial</strong><p>The contract follows your instructions. Nobody else can cancel.</p></div>
          <div><span>02</span><strong>Fully onchain</strong><p>Every transfer and status comes directly from Monad.</p></div>
          <div><span>03</span><strong>Zero platform fees</strong><p>Rewind takes nothing. You only pay network gas.</p></div>
        </section>

        <section className="how-section" id="how">
          <div className="section-heading">
            <span className="kicker">How it works</span>
            <h2>Crypto speed.<br /><em>Human reaction time.</em></h2>
          </div>
          <div className="steps">
            <article>
              <span className="step-number">1</span>
              <div className="step-visual step-visual--send"><span>0.1</span><b>MON</b><i>↗</i></div>
              <h3>Send normally</h3>
              <p>Choose the recipient, amount, and a short safety window.</p>
            </article>
            <article>
              <span className="step-number">2</span>
              <div className="step-visual step-visual--hold"><span className="timer-ring">4:59</span></div>
              <h3>Take a breath</h3>
              <p>Your MON waits transparently in the contract—not in our hands.</p>
            </article>
            <article>
              <span className="step-number">3</span>
              <div className="step-visual step-visual--decide"><span>↶ Rewind</span><span>✓ Deliver</span></div>
              <h3>Rewind or relax</h3>
              <p>Cancel during the window, or settle it once the window closes.</p>
            </article>
          </div>
        </section>

        <section className="live-section" id="live">
          <div className="live-heading">
            <div>
              <span className="kicker">Live contract state</span>
              <h2>Recent protected transfers</h2>
            </div>
            <div className={`network-pill${feedError ? " network-pill--warning" : ""}`}>
              <span /> {feedError ? "RPC reconnecting" : `Monad Testnet${blockNumber ? ` · #${blockNumber.toLocaleString()}` : ""}`}
            </div>
          </div>

          <div className="stat-row">
            <div><small>Recent volume protected</small><strong>{cleanAmount(stats.protectedAmount)} <span>MON</span></strong></div>
            <div><small>Transfers shown</small><strong>{transfers.length}</strong></div>
            <div><small>Successfully rewound</small><strong>{stats.rewound}</strong></div>
          </div>

          <div className="transfer-list">
            {loadingFeed ? (
              <div className="empty-state"><span className="loader" /><h3>Reading Monad…</h3></div>
            ) : feedError && transfers.length === 0 ? (
              <div className="empty-state">
                <RewindMark />
                <h3>Monad is taking a breath</h3>
                <p>The live contract could not be reached. Rewind will retry automatically without inventing placeholder data.</p>
                <button
                  className="empty-state__button"
                  type="button"
                  onClick={() => {
                    setLoadingFeed(true);
                    void refreshTransfers();
                  }}
                >
                  Retry now
                </button>
              </div>
            ) : transfers.length === 0 ? (
              <div className="empty-state">
                <RewindMark />
                <h3>No transfers yet</h3>
                <p>The first real protected transfer will appear here—no sample data, no smoke and mirrors.</p>
                <a href="#top">Create the first transfer ↑</a>
              </div>
            ) : (
              transfers.map((transfer) => {
                const isPending = transfer.status === 0;
                const windowOpen = isPending && now < transfer.releaseAt;
                const isSender = account.toLowerCase() === transfer.sender.toLowerCase();
                const statusLabel = transfer.status === 1 ? "Delivered" : transfer.status === 2 ? "Rewound" : windowOpen ? "Protected" : "Ready";
                return (
                  <article className="transfer-row" key={transfer.id.toString()}>
                    <div className="transfer-id"><span>#{transfer.id.toString()}</span><small>Transfer</small></div>
                    <div className="transfer-route">
                      <a href={`${MONAD_TESTNET.explorerUrl}/address/${transfer.sender}`} target="_blank" rel="noreferrer">{shortAddress(transfer.sender)}</a>
                      <span className="mini-route"><i /><b>→</b><i /></span>
                      <a href={`${MONAD_TESTNET.explorerUrl}/address/${transfer.recipient}`} target="_blank" rel="noreferrer">{shortAddress(transfer.recipient)}</a>
                    </div>
                    <div className="transfer-amount"><strong>{cleanAmount(transfer.amount)}</strong><small>MON</small></div>
                    <div className={`status status--${transfer.status === 2 ? "cancelled" : transfer.status === 1 ? "released" : "pending"}`}>
                      <span /> {statusLabel}
                    </div>
                    <div className="countdown"><small>{windowOpen ? "Time to rewind" : "Settlement"}</small><strong>{windowOpen ? remainingTime(transfer.releaseAt, now) : transfer.status === 0 ? "Available" : "Complete"}</strong></div>
                    <div className="transfer-action">
                      {windowOpen && isSender && (
                        <button type="button" onClick={() => actOnTransfer(transfer, "cancel")} disabled={busy !== null}>
                          {busy === `cancel-${transfer.id}` ? "Rewinding…" : "Rewind"}
                        </button>
                      )}
                      {!windowOpen && isPending && (
                        <button type="button" onClick={() => actOnTransfer(transfer, "release")} disabled={busy !== null}>
                          {busy === `release-${transfer.id}` ? "Settling…" : "Settle"}
                        </button>
                      )}
                      {(!isPending || (windowOpen && !isSender)) && <span className="action-done">{isPending ? "Locked" : "✓"}</span>}
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <div className="live-footnote">
            <span>
              {feedError && transfers.length > 0
                ? "Showing the last confirmed contract state while Monad reconnects."
                : "Showing up to 12 latest transfers, read directly from contract storage."}
            </span>
            <a href={contractExplorerUrl} target="_blank" rel="noreferrer">
              Contract {shortAddress(CONTRACT_ADDRESS)} <ArrowUpRightIcon />
            </a>
          </div>
        </section>

        <section className="closing-section">
          <div className="closing-mark"><span>↶</span><i /></div>
          <div>
            <span className="kicker">Built from one anxious question</span>
            <h2>“What if I pasted the wrong address?”</h2>
            <p>Rewind turns irreversible panic into a calm, verifiable pause.</p>
          </div>
          <a className="closing-action" href="#top">Protect a transfer <span>↑</span></a>
        </section>
      </main>

      <footer>
        <a className="brand" href="#top"><RewindMark small /><span>rewind</span></a>
        <p>An open experiment for the BuildAnything Spark hackathon.</p>
        <div>
          <a href="https://github.com/smart-window/rewind-monad" target="_blank" rel="noreferrer">Source code <ArrowUpRightIcon /></a>
          <a href={MONAD_TESTNET.faucetUrl} target="_blank" rel="noreferrer">Get test MON <ArrowUpRightIcon /></a>
          <a href="https://docs.monad.xyz" target="_blank" rel="noreferrer">Monad docs <ArrowUpRightIcon /></a>
        </div>
      </footer>
    </div>
  );
}

export default App;
