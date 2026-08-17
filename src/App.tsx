import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Check,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  RefreshCw,
  ShieldCheck,
  Vault,
  Wallet,
  X,
} from "lucide-react";
import { chains } from "./data";
import {
  FEE_TOKEN_SYMBOL,
  formatTokenAmount,
  getPoolFee,
  getShieldedBalances,
  getTokenSymbol,
  getVesuVaults,
  lendToVesu,
  normalizeAddress,
  parseShieldedBalances,
  privateTransfer,
  shield,
  strk20Network,
  TOKENS,
  type TokenSymbol,
  unlendFromVesu,
  type VesuVault,
  vesuHelperAddress,
  withdraw,
} from "./strk20";
import {
  actionErrorNotice,
  configuredNetworkLabel,
  gateLiveWallet,
  isNotRegistered,
  revertedTransactionError,
  transactionStatus,
  walletMatchesConfiguredNetwork,
} from "./walletGuards";
import { useWallet } from "./useWallet";

type Modal =
  | "deposit"
  | "withdraw"
  | "transfer"
  | "lend"
  | "unlend"
  | "wallet"
  | "privacy"
  | null;
type Toast = { title: string; detail: string; type: "ok" | "error" } | null;
type SessionTx = { hash: string; label: string; status: string; time: string };

const vaults = getVesuVaults();

function Logo() {
  return (
    <div className="logo" aria-label="Sotto">
      <span className="logo-mark">
        <span />
      </span>
      <span>Sotto</span>
    </div>
  );
}

function ModalShell({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function App() {
  const wallet = useWallet();
  const [modal, setModal] = useState<Modal>(null);
  const [hideBalance, setHideBalance] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedChain, setSelectedChain] = useState(chains[0]);
  const [token, setToken] = useState<TokenSymbol>("USDC");
  const [amount, setAmount] = useState("100");
  const [recipient, setRecipient] = useState("");
  const [selectedVault, setSelectedVault] = useState<VesuVault | undefined>(
    vaults[0],
  );
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
  const [balanceState, setBalanceState] = useState<
    | "disconnected"
    | "loading"
    | "live"
    | "unregistered"
    | "wrongNetwork"
    | "error"
  >("disconnected");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [transactions, setTransactions] = useState<SessionTx[]>([]);
  const [poolFee, setPoolFee] = useState<bigint | null>(null);
  const syncInFlight = useRef<Promise<void> | null>(null);
  /** `address:chainId` last auto-synced, so one prompt is raised per account+network. */
  const lastSyncedIdentity = useRef("");

  const knownBalances = [...balances.entries()]
    .map(([address, balance]) => {
      const known = Object.entries(TOKENS).find(
        ([, config]) => normalizeAddress(config.address) === address,
      );
      const vault = vaults.find(
        (item) => normalizeAddress(item.vTokenAddress) === address,
      );
      const decimals = vault
        ? vault.vTokenDecimals
        : (known?.[1].decimals ?? 18);
      return {
        address,
        balance,
        symbol: vault ? `v${vault.underlying}` : getTokenSymbol(address),
        decimals,
        vault,
      };
    })
    .filter((entry) => entry.balance > 0n);
  const liquidBalances = knownBalances.filter((entry) => !entry.vault);
  const positionBalances = knownBalances.filter((entry) => entry.vault);

  function notify(next: Toast) {
    setToast(next);
    window.setTimeout(() => setToast(null), 5000);
  }

  function displayAmount(entry: {
    balance: bigint;
    decimals: number;
    symbol: string;
  }) {
    return hideBalance
      ? "••••••"
      : `${formatTokenAmount(entry.balance, entry.decimals)} ${entry.symbol}`;
  }

  // Every strk20Balances call raises a wallet approval prompt. React StrictMode invokes effects
  // twice in development, and a capability or network update can retrigger them, so without this
  // guard the user gets a stack of identical "Share private balances?" windows. Concurrent callers
  // share the one in-flight request instead of each opening their own.
  function syncBalances(showToast = true): Promise<void> {
    if (syncInFlight.current) return syncInFlight.current;
    const run = runSyncBalances(showToast).finally(() => {
      syncInFlight.current = null;
    });
    syncInFlight.current = run;
    return run;
  }

  async function runSyncBalances(showToast: boolean) {
    if (!wallet.account) {
      setBalances(new Map());
      setBalanceState("disconnected");
      return;
    }
    // Network first. On the wrong chain every downstream call fails for reasons that have nothing
    // to do with the real problem, so short-circuit before touching the wallet's STRK20 surface and
    // give the one instruction that fixes it.
    if (!walletMatchesConfiguredNetwork(wallet.networkName, strk20Network)) {
      setBalances(new Map());
      setBalanceState("wrongNetwork");
      if (showToast)
        notify({
          title: "Switch network",
          detail: `Sotto is running on ${configuredNetworkLabel(strk20Network)}. Switch your wallet to ${configuredNetworkLabel(strk20Network)} to continue.`,
          type: "error",
        });
      return;
    }
    if (!wallet.strk20Capable) {
      setBalances(new Map());
      setBalanceState("error");
      if (showToast)
        notify({
          title: "Privacy API unavailable",
          detail: "This wallet does not report Wallet API 0.10.3 or newer.",
          type: "error",
        });
      return;
    }
    setBalanceState("loading");
    try {
      const result = await getShieldedBalances(wallet.account);
      setBalances(parseShieldedBalances(result));
      setBalanceState("live");
      if (showToast)
        notify({
          title: "Private balances synchronized",
          detail:
            "Balances came directly from your wallet's STRK20 note discovery.",
          type: "ok",
        });
    } catch (error) {
      // NOT_REGISTERED is the expected state for an account that has never used the pool, not a
      // failure. Registration is wallet-owned and one-time; no dapp-callable method exists.
      if (isNotRegistered(error)) {
        setBalances(new Map());
        setBalanceState("unregistered");
        if (showToast)
          notify({
            title: "Not registered with STRK20 yet",
            detail:
              "Register the privacy pool once in your wallet, then sync again.",
            type: "error",
          });
        return;
      }
      setBalanceState("error");
      notify({
        ...actionErrorNotice(error, "Balance query failed"),
        type: "error",
      });
    }
  }

  const syncBalancesOnConnect = useEffectEvent(() => syncBalances(false));

  const loadPoolFee = useEffectEvent(async () => {
    if (!wallet.account) return;
    try {
      setPoolFee(await getPoolFee(wallet.account.provider));
    } catch {
      // A missing fee reads as unknown rather than zero: claiming a transaction is free when the
      // pool charges 6 STRK would be worse than saying nothing.
      setPoolFee(null);
    }
  });

  /** Shielded balance available for a token, in base units. */
  function shieldedBalanceOf(address: string): bigint {
    return balances.get(normalizeAddress(address)) ?? 0n;
  }

  /** "Available: 12.5 STRK" line shown wherever an amount is entered. */
  function AvailableLine({
    address,
    decimals,
    symbol,
  }: {
    address: string;
    decimals: number;
    symbol: string;
  }) {
    const available = shieldedBalanceOf(address);
    return (
      <p className="field-note">
        <span>Shielded balance</span>
        <button
          type="button"
          className="link-button"
          disabled={available <= 0n}
          onClick={() =>
            setAmount(formatTokenAmount(available, decimals, decimals))
          }
        >
          {hideBalance
            ? "••••••"
            : `${formatTokenAmount(available, decimals)} ${symbol}`}
        </button>
      </p>
    );
  }

  /** Discloses the pool's flat per-transaction fee, which is charged on top of the amount moved. */
  function FeeLine() {
    if (poolFee === null) return null;
    return (
      <p className="field-note fee-note">
        <span>STRK20 pool fee</span>
        <b>
          {formatTokenAmount(poolFee, 18)} {FEE_TOKEN_SYMBOL}
        </b>
      </p>
    );
  }

  // Auto-sync exactly once per account+network. Reading shielded balances raises its own wallet
  // approval prompt, so this must key on stable primitives: `wallet.account` is a fresh object on
  // every attach, and depending on it re-fired the read — and the prompt — on every wallet event.
  // Switching account or network still resyncs, because the key changes. The refresh button calls
  // syncBalances directly and is unaffected.
  useEffect(() => {
    if (!wallet.address) {
      setBalances(new Map());
      setBalanceState("disconnected");
      lastSyncedIdentity.current = "";
      return;
    }
    const identity = `${wallet.address}:${wallet.chainId}`;
    if (lastSyncedIdentity.current === identity) return;
    lastSyncedIdentity.current = identity;
    void syncBalancesOnConnect();
    // Plain RPC read, so it raises no wallet prompt and can run alongside the balance sync.
    void loadPoolFee();
  }, [wallet.address, wallet.chainId, syncBalancesOnConnect, loadPoolFee]);

  async function confirmTransaction(hash: string, label: string) {
    setTransactions((items) => [
      { hash, label, status: "Confirming", time: "Now" },
      ...items,
    ]);
    const receipt = await wallet.account!.provider.waitForTransaction(hash, {
      retries: 400,
      retryInterval: 3000,
    });
    const succeeded = receipt.isSuccess();
    setTransactions((items) =>
      items.map((item) =>
        item.hash === hash
          ? { ...item, status: transactionStatus(succeeded) }
          : item,
      ),
    );
    if (!succeeded) throw revertedTransactionError();
  }

  async function requireLiveWallet() {
    const gate = gateLiveWallet({
      hasAccount: Boolean(wallet.account),
      strk20Capable: wallet.strk20Capable,
      networkName: wallet.networkName,
      configuredNetwork: strk20Network,
    });
    if (gate.ok) return true;
    if (gate.openWalletModal) {
      setModal("wallet");
      return false;
    }
    notify({ title: gate.title, detail: gate.detail, type: "error" });
    return false;
  }

  async function runAssetAction(kind: "deposit" | "withdraw") {
    if (!(await requireLiveWallet())) return;
    if (kind === "deposit" && selectedChain.id !== "starknet") {
      notify({
        title: "Cross-chain route disabled",
        detail:
          "The CCTP bridge contracts, prover, indexer and paymaster must be configured before Sotto can accept EVM funds.",
        type: "error",
      });
      return;
    }
    if (kind === "withdraw" && !recipient.trim()) {
      notify({
        title: "Recipient required",
        detail: "Enter a fresh Starknet address.",
        type: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const response =
        kind === "deposit"
          ? await shield(wallet.account!, token, amount)
          : await withdraw(wallet.account!, token, amount, recipient.trim());
      const label =
        kind === "deposit"
          ? `Shield ${amount} ${token}`
          : `Withdraw ${amount} ${token}`;
      setModal(null);
      notify({
        title: "Proof submitted",
        detail: `Waiting for ${response.transaction_hash.slice(0, 10)}… to confirm.`,
        type: "ok",
      });
      await confirmTransaction(response.transaction_hash, label);
      await syncBalances(false);
      notify({
        title: "Transaction confirmed",
        detail: `${label} settled on ${wallet.networkName}.`,
        type: "ok",
      });
    } catch (error) {
      notify({
        ...actionErrorNotice(error, "Transaction failed"),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runLend() {
    if (!(await requireLiveWallet()) || !selectedVault) return;
    setBusy(true);
    try {
      const response = await lendToVesu(
        wallet.account!,
        selectedVault,
        amount,
        wallet.address,
      );
      const label = `Lend ${amount} ${selectedVault.underlying} on Vesu`;
      setModal(null);
      notify({
        title: "Private lending submitted",
        detail:
          "The wallet dry run passed and the real proof is now confirming.",
        type: "ok",
      });
      await confirmTransaction(response.transaction_hash, label);
      await syncBalances(false);
      notify({
        title: "Vesu position confirmed",
        detail: "Your vToken shares are now held as a private STRK20 note.",
        type: "ok",
      });
    } catch (error) {
      notify({
        ...actionErrorNotice(error, "Private lending failed"),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runUnlend() {
    if (!(await requireLiveWallet()) || !selectedVault) return;
    setBusy(true);
    try {
      const response = await unlendFromVesu(
        wallet.account!,
        selectedVault,
        amount,
        wallet.address,
      );
      const label = `Redeem ${amount} v${selectedVault.underlying} on Vesu`;
      setModal(null);
      notify({
        title: "Private redemption submitted",
        detail:
          "The wallet dry run passed and the real proof is now confirming.",
        type: "ok",
      });
      await confirmTransaction(response.transaction_hash, label);
      await syncBalances(false);
      notify({
        title: "Vesu position closed",
        detail: `Your ${selectedVault.underlying} is back in a private STRK20 note.`,
        type: "ok",
      });
    } catch (error) {
      notify({
        ...actionErrorNotice(error, "Private redemption failed"),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runPrivateTransfer() {
    if (!(await requireLiveWallet())) return;
    if (!recipient.trim()) {
      notify({
        title: "Recipient required",
        detail: "Enter a registered Starknet privacy address.",
        type: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const response = await privateTransfer(
        wallet.account!,
        token,
        amount,
        recipient,
      );
      const label = `Transfer ${amount} ${token}`;
      setModal(null);
      notify({
        title: "Private transfer submitted",
        detail: `Waiting for ${response.transaction_hash.slice(0, 10)}… to confirm.`,
        type: "ok",
      });
      await confirmTransaction(response.transaction_hash, label);
      await syncBalances(false);
      notify({
        title: "Private transfer confirmed",
        detail: `The recipient will discover the new ${token} note through their wallet.`,
        type: "ok",
      });
    } catch (error) {
      notify({
        ...actionErrorNotice(error, "Private transfer failed"),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const accountStatus = wallet.restoring
    ? "Reconnecting"
    : !wallet.account
      ? "Connect wallet"
      : balanceState === "wrongNetwork"
        ? `Switch to ${configuredNetworkLabel(strk20Network)}`
        : !wallet.strk20Capable
          ? "API unsupported"
          : balanceState === "unregistered"
            ? "Not registered"
            : balanceState === "live"
              ? "Live"
              : balanceState === "loading"
                ? "Synchronizing"
                : "Unavailable";

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <nav
          className={menuOpen ? "nav-open" : ""}
          aria-label="Primary navigation"
        >
          <a className="active" href="#overview">
            <LayoutDashboard size={17} />
            Overview
          </a>
          <a href="#positions">
            <Vault size={17} />
            Positions
          </a>
          <a href="#activity">
            <Activity size={17} />
            Activity
          </a>
        </nav>
        <div className="top-actions">
          <button className="privacy-chip" onClick={() => setModal("privacy")}>
            <ShieldCheck size={15} />
            STRK20
          </button>
          <button className="wallet-button" onClick={() => setModal("wallet")}>
            <Wallet size={16} />
            {wallet.address
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : wallet.restoring
                ? "Reconnecting…"
                : "Connect"}
          </button>
          <button
            className="menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main>
        <section className="intro" id="overview">
          <div>
            <p className="eyebrow">PRIVATE YIELD ACCOUNT</p>
            <h1>
              Your capital,
              <br />
              <span>off the record.</span>
            </h1>
          </div>
          <p className="intro-copy">
            Sotto reads encrypted notes, sends private transfers, and routes
            configured assets through STRK20 anonymizers using your privacy
            wallet. No viewing keys enter the app.
          </p>
        </section>
        <section className="balance-panel live-account">
          <div className="balance-head">
            <div>
              <div className="label-row">
                <span>SHIELDED ASSETS</span>
                <button
                  className="icon-button small"
                  onClick={() => setHideBalance(!hideBalance)}
                  aria-label="Toggle balances"
                >
                  {hideBalance ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div
                className={`hero-balance${knownBalances.length > 1 ? " multi" : ""}`}
              >
                {!wallet.account
                  ? "—"
                  : hideBalance
                    ? "••••••"
                    : knownBalances.length
                      ? knownBalances.map((entry) => (
                          <span className="hero-holding" key={entry.address}>
                            {formatTokenAmount(entry.balance, entry.decimals)}
                            <i>{entry.symbol}</i>
                          </span>
                        ))
                      : "0"}
              </div>
              <div className="balance-gain">
                <span>{accountStatus}</span>
                <span>{wallet.networkName}</span>
                <span className="muted">wallet-owned note discovery</span>
              </div>
            </div>
            <div className="balance-actions">
              <button
                className="button primary"
                onClick={() => setModal("deposit")}
              >
                <ArrowDownLeft size={18} />
                Deposit
              </button>
              <button
                className="button secondary"
                onClick={() => setModal("transfer")}
              >
                <ArrowRightLeft size={18} />
                Transfer
              </button>
              <button
                className="button secondary"
                onClick={() => setModal("withdraw")}
              >
                <ArrowUpRight size={18} />
                Withdraw
              </button>
              <button
                className="icon-button bordered"
                onClick={() => syncBalances()}
                disabled={balanceState === "loading"}
                aria-label="Synchronize balances"
              >
                <RefreshCw
                  size={18}
                  className={balanceState === "loading" ? "spin" : ""}
                />
              </button>
            </div>
          </div>
          <div className="live-balances">
            {wallet.restoring ? (
              <div className="account-empty">
                <RefreshCw className="spin" />
                <strong>Reconnecting your wallet</strong>
                <span>
                  Restoring the session you approved earlier. No new approval is
                  needed.
                </span>
              </div>
            ) : !wallet.account ? (
              <div className="account-empty">
                <LockKeyhole />
                <strong>Connect a privacy-enabled Starknet wallet</strong>
                <span>
                  Sotto cannot read private balances without wallet approval.
                </span>
              </div>
            ) : balanceState === "loading" ? (
              <div className="account-empty">
                <RefreshCw className="spin" />
                <strong>Discovering encrypted notes</strong>
                <span>Your wallet is scanning STRK20 channels.</span>
              </div>
            ) : balanceState === "wrongNetwork" ? (
              <div className="account-empty error">
                <ArrowRightLeft />
                <strong>
                  Switch to Starknet {configuredNetworkLabel(strk20Network)}
                </strong>
                <span>
                  This deployment runs on{" "}
                  {configuredNetworkLabel(strk20Network)}, and your wallet is on{" "}
                  {wallet.networkName}. Change the network in your wallet —
                  Sotto reconnects on its own.
                </span>
              </div>
            ) : balanceState === "unregistered" ? (
              <div className="account-empty">
                <Fingerprint />
                <strong>Register with STRK20 once</strong>
                <span>
                  This account has never used the privacy pool. Registration is
                  a one-time on-chain step your wallet owns — complete it in
                  your wallet, then sync again.
                </span>
              </div>
            ) : balanceState === "error" ? (
              <div className="account-empty error">
                <CircleHelp />
                <strong>Private balances unavailable</strong>
                <span>
                  Confirm Wallet API 0.10.3 support and the connected network.
                </span>
              </div>
            ) : knownBalances.length ? (
              knownBalances.map((entry) => (
                <div className="token-balance" key={entry.address}>
                  <span className="token-symbol">
                    {entry.symbol.slice(0, 1)}
                  </span>
                  <p>
                    <strong>{entry.symbol}</strong>
                    <small>
                      {entry.vault
                        ? "Vesu private position"
                        : "Shielded balance"}
                    </small>
                  </p>
                  <b>{displayAmount(entry)}</b>
                </div>
              ))
            ) : (
              <div className="account-empty">
                <ShieldCheck />
                <strong>No shielded balances</strong>
                <span>
                  Deposit an asset to create your first encrypted note.
                </span>
              </div>
            )}
          </div>
          <div className="metrics-row">
            <div>
              <span>LIQUID ASSETS</span>
              <strong>{liquidBalances.length}</strong>
              <small>Wallet-reported</small>
            </div>
            <div>
              <span>YIELD POSITIONS</span>
              <strong>{positionBalances.length}</strong>
              <small>Configured vTokens</small>
            </div>
            <div>
              <span>VESU ROUTE</span>
              <strong>
                {vesuHelperAddress ? "Configured" : "Not deployed"}
              </strong>
              <small>{vaults.length} verified vaults</small>
            </div>
            <div>
              <span>ACCOUNT STATUS</span>
              <strong className="status-strong">
                <i />
                {accountStatus}
              </strong>
              <small>
                {wallet.apiProbeError
                  ? `API probe failed: ${wallet.apiProbeError}`
                  : wallet.walletApiVersions.join(", ") ||
                    "Wallet reported no API versions"}
              </small>
            </div>
          </div>
        </section>
        <section className="section" id="positions">
          <div className="section-head">
            <div>
              <p className="eyebrow">ON-CHAIN POSITIONS</p>
              <h2>Private yield</h2>
              <p className="section-subtitle">
                Shielded capital routed into verified lending markets.
              </p>
            </div>
            <button
              className="button text-button"
              disabled={!vaults.length}
              onClick={() => setModal("lend")}
            >
              <Vault size={17} />
              <span>Open position</span>
            </button>
          </div>
          <div className="allocation-layout">
            <div className="allocation-list">
              <div className="position-header" aria-hidden="true">
                <span>PROTOCOL</span>
                <span>ASSET</span>
                <span>ROUTE</span>
                <span>SHARES</span>
                <span className="align-right">POSITION VALUE</span>
                <span />
              </div>
              {vaults.length ? (
                vaults.map((vault) => {
                  const entry = positionBalances.find(
                    (item) =>
                      item.address === normalizeAddress(vault.vTokenAddress),
                  );
                  return (
                    <article className="position-row" key={vault.id}>
                      <div className="position-name">
                        <span className="protocol-mark">V</span>
                        <div>
                          <strong>Vesu</strong>
                          <span>{vault.label}</span>
                        </div>
                      </div>
                      <div className="position-stat">
                        <span>UNDERLYING</span>
                        <strong>{vault.underlying}</strong>
                      </div>
                      <div className="position-stat">
                        <span>ROUTE</span>
                        <strong className="apy">Live</strong>
                      </div>
                      <div className="position-stat">
                        <span>SHARES</span>
                        <strong>
                          {entry
                            ? formatTokenAmount(
                                entry.balance,
                                vault.vTokenDecimals,
                              )
                            : "0"}
                        </strong>
                      </div>
                      <div className="position-value">
                        <strong>
                          {entry
                            ? displayAmount(entry)
                            : `0 v${vault.underlying}`}
                        </strong>
                        <span>STRK20 open note</span>
                      </div>
                      <button
                        className="button text-button"
                        disabled={!entry}
                        onClick={() => {
                          setSelectedVault(vault);
                          setAmount(
                            entry
                              ? formatTokenAmount(
                                  entry.balance,
                                  vault.vTokenDecimals,
                                )
                              : "0",
                          );
                          setModal("unlend");
                        }}
                      >
                        <ArrowUpRight size={16} />
                        <span>Close</span>
                      </button>
                    </article>
                  );
                })
              ) : (
                <div className="route-empty">
                  <CircleHelp />
                  <div>
                    <strong>No lending route deployed</strong>
                    <span>
                      Set the audited Vesu helper and verified vault addresses
                      to enable real positions.
                    </span>
                  </div>
                </div>
              )}
            </div>
            <aside className="allocation-summary route-status">
              <div className="shield-orbit">
                <Fingerprint />
              </div>
              <p className="eyebrow">EXECUTION ROUTE</p>
              <h3>Wallet → STRK20 → helper → Vesu</h3>
              <p>
                The helper action and amount are public. The initiating wallet
                and private vToken owner are hidden.
              </p>
              <dl>
                <div>
                  <dt>Dry run</dt>
                  <dd>Required</dd>
                </div>
                <div>
                  <dt>External invokes</dt>
                  <dd>1 per transaction</dd>
                </div>
                <div>
                  <dt>Helper</dt>
                  <dd>
                    {vesuHelperAddress
                      ? `${vesuHelperAddress.slice(0, 8)}…`
                      : "Missing"}
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        </section>
        <section className="lower-grid">
          <div className="section activity-section" id="activity">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">CURRENT SESSION</p>
                <h2>Submitted transactions</h2>
              </div>
            </div>
            <div className="activity-list">
              {transactions.length ? (
                transactions.map((item) => (
                  <a
                    className="activity-row live-tx"
                    key={item.hash}
                    href={`${wallet.networkName === "Sepolia" ? "https://sepolia.voyager.online" : "https://voyager.online"}/tx/${item.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="activity-icon">
                      <Activity />
                    </span>
                    <div className="activity-copy">
                      <strong>{item.label}</strong>
                      <span>
                        {item.hash.slice(0, 12)}…{item.hash.slice(-6)}
                      </span>
                    </div>
                    <span className="activity-time">{item.time}</span>
                    <div className="activity-amount">
                      <strong>{item.status}</strong>
                      <span>Open explorer</span>
                    </div>
                  </a>
                ))
              ) : (
                <div className="route-empty">
                  <Activity />
                  <div>
                    <strong>No transactions this session</strong>
                    <span>
                      Confirmed history is never fabricated. Submit a live
                      STRK20 action to populate this list.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <aside className="privacy-card">
            <div className="privacy-card-top">
              <span className="shield-orbit">
                <LockKeyhole />
              </span>
              <span className="privacy-live">
                <i />
                PROTOCOL
              </span>
            </div>
            <p className="eyebrow">PRIVACY BOUNDARY</p>
            <h2>Private, not invisible.</h2>
            <p>
              Pool balances and ownership are encrypted. Deposits, withdrawals,
              timing, and anonymizer output amounts remain public.
            </p>
            <div className="privacy-checks">
              <span>
                <Check />
                Viewing key stays in wallet
              </span>
              <span>
                <Check />
                Proof generated wallet-side
              </span>
              <span>
                <Check />
                Receipts verified on Starknet
              </span>
            </div>
            <button onClick={() => setModal("privacy")}>
              View exact privacy model <ArrowUpRight size={16} />
            </button>
          </aside>
        </section>
      </main>
      <footer>
        <Logo />
        <p>Live data only. No simulated yield.</p>
        <div>
          <a
            href="https://strk20-by-example.org/what-is-strk20"
            target="_blank"
            rel="noreferrer"
          >
            STRK20 docs
          </a>
          <a
            href="https://github.com/starkware-libs/starknet-privacy"
            target="_blank"
            rel="noreferrer"
          >
            Protocol
          </a>
        </div>
      </footer>

      {modal === "wallet" && (
        <ModalShell
          title="Connect Starknet"
          eyebrow="LIVE WALLET"
          onClose={() => setModal(null)}
        >
          <p className="modal-copy">
            Sotto requires Wallet API 0.10.3 or newer. Viewing keys, notes and
            proof generation remain inside your wallet.
          </p>
          {wallet.address ? (
            <div className="connected-wallet">
              <span>
                <Check />
              </span>
              <div>
                <strong>
                  {wallet.address.slice(0, 12)}…{wallet.address.slice(-8)}
                </strong>
                <small>
                  {wallet.networkName} ·{" "}
                  {wallet.strk20Capable
                    ? "STRK20 ready"
                    : "Privacy API unsupported"}
                </small>
              </div>
              <button
                onClick={() => {
                  wallet.disconnect();
                  setModal(null);
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="wallet-list">
              {wallet.wallets.length ? (
                wallet.wallets.map((item) => (
                  <button
                    key={item.name}
                    disabled={wallet.connecting}
                    onClick={() => wallet.connect(item)}
                  >
                    <img src={item.icon} alt="" />
                    <span>
                      <strong>{item.name}</strong>
                      <small>Check STRK20 support on connect</small>
                    </span>
                    <ArrowUpRight />
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <Wallet />
                  <strong>No Starknet wallet detected</strong>
                  <span>
                    Install a privacy-enabled Starknet wallet such as Ready.
                  </span>
                </div>
              )}
            </div>
          )}
          {wallet.error && <p className="form-error">{wallet.error}</p>}
        </ModalShell>
      )}
      {modal === "deposit" && (
        <ModalShell
          title="Shield an asset"
          eyebrow="STRK20 DEPOSIT"
          onClose={() => setModal(null)}
        >
          <div className="privacy-callout">
            <ShieldCheck />
            <p>
              <strong>The deposit edge is public</strong>
              <span>
                The source wallet, token and amount remain visible. The
                resulting STRK20 note is encrypted.
              </span>
            </p>
          </div>
          <label className="field">
            <span>Source chain</span>
            <div className="chain-grid">
              {chains.map((chain) => (
                <button
                  className={selectedChain.id === chain.id ? "selected" : ""}
                  onClick={() => setSelectedChain(chain)}
                  key={chain.id}
                >
                  <i style={{ background: chain.color }}>{chain.symbol}</i>
                  {chain.name}
                  {selectedChain.id === chain.id && <Check />}
                </button>
              ))}
            </div>
          </label>
          {selectedChain.id !== "starknet" && (
            <p className="form-error">
              This route is disabled until the Privacy Bridge contracts and
              services are configured. No funds will be requested.
            </p>
          )}
          <div className="form-row">
            <label className="field">
              <span>Asset</span>
              <select
                value={token}
                onChange={(event) =>
                  setToken(event.target.value as TokenSymbol)
                }
              >
                <option>USDC</option>
                <option>STRK</option>
              </select>
            </label>
            <label className="field grow">
              <span>Amount</span>
              <input
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          </div>
          <FeeLine />
          <button
            className="button primary modal-cta"
            disabled={busy || selectedChain.id !== "starknet"}
            onClick={() => runAssetAction("deposit")}
          >
            {busy
              ? "Waiting for wallet…"
              : wallet.account
                ? `Shield ${amount || "0"} ${token}`
                : "Connect wallet to deposit"}
          </button>
        </ModalShell>
      )}
      {modal === "withdraw" && (
        <ModalShell
          title="Withdraw to fresh wallet"
          eyebrow="STRK20 WITHDRAWAL"
          onClose={() => setModal(null)}
        >
          <div className="privacy-callout">
            <Fingerprint />
            <p>
              <strong>The withdrawal edge is public</strong>
              <span>
                Recipient, token, amount and timing are visible. Use a genuinely
                unused destination to reduce linkage.
              </span>
            </p>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Asset</span>
              <select
                value={token}
                onChange={(event) =>
                  setToken(event.target.value as TokenSymbol)
                }
              >
                <option>USDC</option>
                <option>STRK</option>
              </select>
            </label>
            <label className="field grow">
              <span>Amount</span>
              <input
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          </div>
          <AvailableLine
            address={TOKENS[token].address}
            decimals={TOKENS[token].decimals}
            symbol={token}
          />
          <label className="field">
            <span>Fresh Starknet address</span>
            <div className="address-input">
              <input
                placeholder="0x…"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
              <button
                aria-label="Paste address"
                onClick={async () =>
                  setRecipient(await navigator.clipboard.readText())
                }
              >
                <Copy size={17} />
              </button>
            </div>
          </label>
          <FeeLine />
          <button
            className="button primary modal-cta"
            disabled={busy}
            onClick={() => runAssetAction("withdraw")}
          >
            {busy
              ? "Generating proof…"
              : wallet.account
                ? "Submit private withdrawal"
                : "Connect wallet to withdraw"}
          </button>
        </ModalShell>
      )}
      {modal === "transfer" && (
        <ModalShell
          title="Send privately"
          eyebrow="STRK20 TRANSFER"
          onClose={() => setModal(null)}
        >
          <div className="privacy-callout">
            <ShieldCheck />
            <p>
              <strong>Private movement inside the pool</strong>
              <span>
                The sender, recipient, token, amount and spent notes are hidden
                inside STRK20. The recipient must be registered with a
                privacy-enabled wallet.
              </span>
            </p>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Asset</span>
              <select
                value={token}
                onChange={(event) =>
                  setToken(event.target.value as TokenSymbol)
                }
              >
                <option>USDC</option>
                <option>STRK</option>
              </select>
            </label>
            <label className="field grow">
              <span>Amount</span>
              <input
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          </div>
          <AvailableLine
            address={TOKENS[token].address}
            decimals={TOKENS[token].decimals}
            symbol={token}
          />
          <label className="field">
            <span>Recipient Starknet address</span>
            <div className="address-input">
              <input
                placeholder="0x…"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
              <button
                aria-label="Paste address"
                onClick={async () =>
                  setRecipient(await navigator.clipboard.readText())
                }
              >
                <Copy size={17} />
              </button>
            </div>
          </label>
          <FeeLine />
          <button
            className="button primary modal-cta"
            disabled={busy}
            onClick={runPrivateTransfer}
          >
            {busy
              ? "Generating proof…"
              : wallet.account
                ? "Send private transfer"
                : "Connect wallet to transfer"}
          </button>
        </ModalShell>
      )}
      {modal === "lend" && (
        <ModalShell
          title="Open private Vesu position"
          eyebrow="PRIVACY INVOKE"
          onClose={() => setModal(null)}
        >
          <p className="modal-copy">
            This transaction spends shielded underlying, invokes the configured
            Vesu helper, and returns vToken shares to an open private note.
            Sotto dry-runs the exact actions before submission.
          </p>
          <label className="field">
            <span>Verified vault</span>
            <select
              value={selectedVault?.id}
              onChange={(event) =>
                setSelectedVault(
                  vaults.find((vault) => vault.id === event.target.value),
                )
              }
            >
              {vaults.map((vault) => (
                <option value={vault.id} key={vault.id}>
                  {vault.label} · {vault.underlying}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Shielded amount</span>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <div className="exit-summary">
            <span>
              Network<strong>Starknet {strk20Network}</strong>
            </span>
            <span>
              Spend
              <strong>
                {amount || "0"} {selectedVault?.underlying ?? ""}
              </strong>
            </span>
            <span>
              Vault
              <strong>
                {selectedVault
                  ? `${selectedVault.vTokenAddress.slice(0, 10)}…${selectedVault.vTokenAddress.slice(-4)}`
                  : "None"}
              </strong>
            </span>
            <span>
              Anonymizer
              <strong>
                {vesuHelperAddress
                  ? `${vesuHelperAddress.slice(0, 12)}…`
                  : "Not configured"}
              </strong>
            </span>
            <span>
              Recipient
              <strong>
                {wallet.address
                  ? `${wallet.address.slice(0, 10)}…`
                  : "Connect wallet"}
              </strong>
            </span>
            <span>
              Output<strong>Private vToken note</strong>
            </span>
          </div>
          {selectedVault && (
            <AvailableLine
              address={TOKENS[selectedVault.underlying].address}
              decimals={TOKENS[selectedVault.underlying].decimals}
              symbol={selectedVault.underlying}
            />
          )}
          <FeeLine />
          <button
            className="button primary modal-cta"
            disabled={busy || !selectedVault}
            onClick={runLend}
          >
            {busy ? "Dry-running and proving…" : "Lend privately"}
          </button>
        </ModalShell>
      )}
      {modal === "unlend" && (
        <ModalShell
          title="Close private Vesu position"
          eyebrow="PRIVACY INVOKE"
          onClose={() => setModal(null)}
        >
          <p className="modal-copy">
            This redeems shielded vToken shares through the anonymizer and
            returns the underlying to a new private note. Enter a share count,
            not an underlying amount.
          </p>
          <label className="field">
            <span>Position</span>
            <select
              value={selectedVault?.id}
              onChange={(event) =>
                setSelectedVault(
                  vaults.find((vault) => vault.id === event.target.value),
                )
              }
            >
              {vaults.map((vault) => (
                <option value={vault.id} key={vault.id}>
                  {vault.label} · v{vault.underlying}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Shares to redeem</span>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <div className="exit-summary">
            <span>
              Network<strong>Starknet {strk20Network}</strong>
            </span>
            <span>
              Redeem
              <strong>
                {amount || "0"} v{selectedVault?.underlying ?? ""}
              </strong>
            </span>
            <span>
              Vault
              <strong>
                {selectedVault
                  ? `${selectedVault.vTokenAddress.slice(0, 10)}…${selectedVault.vTokenAddress.slice(-4)}`
                  : "None"}
              </strong>
            </span>
            <span>
              Anonymizer
              <strong>
                {vesuHelperAddress
                  ? `${vesuHelperAddress.slice(0, 12)}…`
                  : "Not configured"}
              </strong>
            </span>
            <span>
              Recipient
              <strong>
                {wallet.address
                  ? `${wallet.address.slice(0, 10)}…`
                  : "Connect wallet"}
              </strong>
            </span>
            <span>
              Output
              <strong>Private {selectedVault?.underlying ?? ""} note</strong>
            </span>
          </div>
          {selectedVault && (
            <AvailableLine
              address={selectedVault.vTokenAddress}
              decimals={selectedVault.vTokenDecimals}
              symbol={`v${selectedVault.underlying}`}
            />
          )}
          <FeeLine />
          <button
            className="button primary modal-cta"
            disabled={busy || !selectedVault}
            onClick={runUnlend}
          >
            {busy ? "Dry-running and proving…" : "Redeem privately"}
          </button>
        </ModalShell>
      )}
      {modal === "privacy" && (
        <ModalShell
          title="What Sotto protects"
          eyebrow="PROTOCOL FACTS"
          onClose={() => setModal(null)}
        >
          <div className="privacy-model">
            <div>
              <span className="privacy-number">01</span>
              <p>
                <strong>Inside STRK20</strong>
                <span>
                  Private transfers hide sender, receiver, token, amount and
                  spent notes.
                </span>
              </p>
            </div>
            <div>
              <span className="privacy-number">02</span>
              <p>
                <strong>Private lending</strong>
                <span>
                  The Vesu helper obscures the initiating wallet, but helper
                  activity and open-note amounts are public.
                </span>
              </p>
            </div>
            <div>
              <span className="privacy-number">03</span>
              <p>
                <strong>Public edges</strong>
                <span>
                  Deposits and withdrawals expose addresses, assets, amounts and
                  timing. Deposits are screened on-chain.
                </span>
              </p>
            </div>
            <div>
              <span className="privacy-number">04</span>
              <p>
                <strong>Wallet-owned privacy</strong>
                <span>
                  Viewing keys, note discovery, channel setup and proof
                  generation stay inside the wallet.
                </span>
              </p>
            </div>
            <div>
              <span className="privacy-number">05</span>
              <p>
                <strong>Private sub-accounts</strong>
                <span>
                  The SDK route exists for account-controlled integrations, but
                  the current Wallet API does not expose it to Sotto.
                </span>
              </p>
            </div>
          </div>
          <a
            className="button secondary modal-cta"
            href="https://strk20-by-example.org/compliance"
            target="_blank"
            rel="noreferrer"
          >
            Read protocol documentation <ArrowUpRight size={17} />
          </a>
        </ModalShell>
      )}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <span>{toast.type === "ok" ? <Check /> : <CircleHelp />}</span>
          <p>
            <strong>{toast.title}</strong>
            <small>{toast.detail}</small>
          </p>
          <button onClick={() => setToast(null)}>
            <X />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
