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
  getPublicBalance,
  getShieldedBalances,
  getTokenSymbol,
  getYieldVaults,
  lendToVesu,
  normalizeAddress,
  parseShieldedBalances,
  privateTransfer,
  shield,
  toBaseUnits,
  strk20Network,
  TOKENS,
  type TokenSymbol,
  unlendFromVesu,
  type YieldVault,
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
import { bridgeRouteFor } from "./bridges";

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

const vaults = getYieldVaults();
const vesuRouteReady = Boolean(vesuHelperAddress && vaults.length);

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
  const [selectedVault, setSelectedVault] = useState<YieldVault | undefined>(
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
  const [view, setView] = useState<"overview" | "positions" | "activity">(
    () => (window.location.hash.slice(1) as "overview" | "positions" | "activity") || "overview",
  );
  const [activityFilter, setActivityFilter] = useState<"All" | "Deposits" | "Transfers" | "Withdrawals" | "Yield">("All");
  const [selectedActivity, setSelectedActivity] = useState<SessionTx | null>(null);
  const [poolFee, setPoolFee] = useState<bigint | null>(null);
  /** Public wallet balances, keyed by token symbol, for the deposit modal only. */
  const [publicBalances, setPublicBalances] = useState<Map<TokenSymbol, bigint>>(new Map());
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

  /**
   * Reads public STRK/USDC for the connected account. Runs in parallel, ignoring failures
   * per-token so one bad RPC does not blank the whole row.
   */
  const loadPublicBalances = useEffectEvent(async () => {
    if (!wallet.account || !wallet.address) return;
    const entries: [TokenSymbol, bigint][] = [];
    await Promise.all(
      (Object.entries(TOKENS) as [TokenSymbol, typeof TOKENS[TokenSymbol]][]).map(async ([symbol, config]) => {
        if (!config.address) return;
        try {
          const balance = await getPublicBalance(wallet.account!.provider, config.address, wallet.address);
          entries.push([symbol, balance]);
        } catch {
          // Silent: RPC hiccups on one token should not blank the row.
        }
      }),
    );
    setPublicBalances(new Map(entries));
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

  /**
   * Preview line for withdraw/transfer: shows how much of `symbol` remains shielded after the
   * requested amount is spent. Purely informational — the wallet is authoritative on final
   * accounting — but exposes the delta before the user signs, so a "max" click that would strand
   * dust is visible.
   */
  function RemainingLine({
    address,
    decimals,
    symbol,
    spend,
  }: {
    address: string;
    decimals: number;
    symbol: string;
    spend: string;
  }) {
    let requested = 0n;
    try {
      requested = toBaseUnits(spend, decimals);
    } catch {
      return null;
    }
    const available = shieldedBalanceOf(address);
    const remaining = available > requested ? available - requested : 0n;
    const overspend = requested > available;
    return (
      <p className={`field-note${overspend ? " field-note-warn" : ""}`}>
        <span>{overspend ? "Overspent by" : "Shielded after"}</span>
        <b>
          {hideBalance
            ? "••••••"
            : overspend
              ? `${formatTokenAmount(requested - available, decimals)} ${symbol}`
              : `${formatTokenAmount(remaining, decimals)} ${symbol}`}
        </b>
      </p>
    );
  }

  /** Discloses the pool's flat per-transaction fee, which is charged on top of the amount moved. */
  /**
   * "Available: 12.5 STRK" line for the deposit modal, showing the PUBLIC wallet balance.
   *
   * Distinct from AvailableLine (which reads shielded balances) because deposit spends from the
   * connected wallet's public state, not from the pool. Includes the pool fee in the max-click so
   * clicking never produces a "you cannot afford the fee" dry-run failure.
   */
  function PublicBalanceLine({ symbol, decimals }: { symbol: TokenSymbol; decimals: number }) {
    const available = publicBalances.get(symbol) ?? 0n;
    // Reserve the pool fee only when the deposit token is STRK; other tokens do not fund fees.
    const feeReserve = symbol === FEE_TOKEN_SYMBOL && poolFee !== null ? poolFee : 0n;
    const spendable = available > feeReserve ? available - feeReserve : 0n;
    return (
      <p className="field-note">
        <span>Wallet balance</span>
        <button type="button" className="link-button" disabled={spendable <= 0n} onClick={() => setAmount(formatTokenAmount(spendable, decimals, decimals))}>
          {hideBalance ? "••••••" : `${formatTokenAmount(available, decimals)} ${symbol}`}
        </button>
      </p>
    );
  }

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

  /**
   * The bridge step for non-Starknet deposits.
   *
   * Sotto delegates the actual bridging to Layerswap (which covers CCTP, StarkGate, and other
   * routes into Starknet) with the destination address pre-filled and locked to the connected
   * Starknet wallet. The user opens the bridge in a new tab, completes it there, and the arrival
   * shows up in this modal's PublicBalanceLine automatically — refreshing when it lands means
   * they can immediately shield without leaving Sotto again.
   */
  function BridgeAndShieldPanel({
    chainId,
    chainName,
    amount,
    token,
  }: {
    chainId: string;
    chainName: string;
    amount: string;
    token: TokenSymbol;
  }) {
    const route = wallet.address
      ? bridgeRouteFor({
          sourceChainId: chainId,
          sourceChainName: chainName,
          destinationAddress: wallet.address,
          asset: token,
          amount,
        })
      : undefined;

    if (!wallet.address) {
      return (
        <div className="privacy-callout">
          <ArrowRightLeft />
          <p>
            <strong>Connect a Starknet wallet first</strong>
            <span>
              The bridge needs a destination. Connect the Starknet wallet that will hold and shield the funds, then reopen this modal.
            </span>
          </p>
        </div>
      );
    }

    if (!route) {
      return (
        <div className="privacy-callout">
          <CircleHelp />
          <p>
            <strong>No bridge route from {chainName}</strong>
            <span>
              Sotto currently covers Ethereum, Base, and Arbitrum → Starknet via Layerswap. Pick one of those, or bridge manually and then use the Starknet-native flow.
            </span>
          </p>
        </div>
      );
    }

    return (
      <div className="bridge-panel">
        <div className="bridge-step">
          <span className="bridge-step-num">1</span>
          <div>
            <strong>Bridge {token} from {route.sourceLabel} → Starknet</strong>
            <span>
              Opens {route.provider} with your Starknet address prefilled and locked. Expect {route.eta}. Funds land on your public Starknet wallet.
            </span>
          </div>
          <a
            className="button primary"
            href={route.url}
            target="_blank"
            rel="noreferrer"
          >
            Open {route.provider} <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="bridge-step">
          <span className="bridge-step-num">2</span>
          <div>
            <strong>Return and shield</strong>
            <span>
              When the {token} arrives, the "Wallet balance" below updates. Hit Shield to move it into the STRK20 pool in one transaction — that's the private step.
            </span>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => void loadPublicBalances()}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>
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
    // Plain RPC reads: no wallet prompts, run alongside the balance sync.
    void loadPoolFee();
    void loadPublicBalances();
  }, [wallet.address, wallet.chainId, syncBalancesOnConnect, loadPoolFee, loadPublicBalances]);

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
    // Non-Starknet source is now handled by BridgeAndShieldPanel: the user bridges externally,
    // funds land in their Starknet wallet, and the shield below spends that public balance. So
    // the deposit action itself is always Starknet-native — the source chain field is only a
    // routing hint for the bridge step. No path is disabled.
    if (kind === "deposit" && false) {
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

  function changeView(nextView: "overview" | "positions" | "activity") {
    setView(nextView);
    window.history.replaceState(null, "", `#${nextView}`);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const onHashChange = () => {
      const next = window.location.hash.slice(1);
      if (next === "overview" || next === "positions" || next === "activity") setView(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const filteredTransactions = transactions.filter((item) => {
    if (activityFilter === "All") return true;
    if (activityFilter === "Yield") return item.label.toLowerCase().includes("lend") || item.label.toLowerCase().includes("yield");
    if (activityFilter === "Deposits") return item.label.toLowerCase().includes("shield") || item.label.toLowerCase().includes("deposit");
    if (activityFilter === "Withdrawals") return item.label.toLowerCase().includes("withdraw");
    return item.label.toLowerCase().includes("transfer");
  });

  function ActivityRows({ compact = false }: { compact?: boolean }) {
    const items = compact ? transactions.slice(0, 3) : filteredTransactions;
    if (!items.length) {
      return (
        <div className="route-empty activity-empty">
          <Activity />
          <div>
            <strong>{compact ? "No recent activity" : "No activity in this view"}</strong>
            <span>{compact ? "Live STRK20 actions will appear here after confirmation." : "Confirmed history is never fabricated. Submit a live STRK20 action to populate this list."}</span>
          </div>
        </div>
      );
    }
    return items.map((item) => (
      <button className="activity-row activity-button" key={item.hash} onClick={() => setSelectedActivity(item)}>
        <span className="activity-icon"><Activity /></span>
        <div className="activity-copy"><strong>{item.label}</strong><span>{item.hash.slice(0, 12)}…{item.hash.slice(-6)}</span></div>
        <span className="activity-time">{item.time}</span>
        <div className="activity-amount"><strong>{item.status}</strong><span>View details <ArrowUpRight size={12} /></span></div>
      </button>
    ));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <nav
          className={menuOpen ? "nav-open" : ""}
          aria-label="Primary navigation"
        >
          <a className={view === "overview" ? "active" : ""} href="#overview" onClick={(event) => { event.preventDefault(); changeView("overview"); }}>
            <LayoutDashboard size={17} />
            Overview
          </a>
          <a className={view === "positions" ? "active" : ""} href="#positions" onClick={(event) => { event.preventDefault(); changeView("positions"); }}>
            <Vault size={17} />
            Positions
          </a>
          <a className={view === "activity" ? "active" : ""} href="#activity" onClick={(event) => { event.preventDefault(); changeView("activity"); }}>
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
        {view === "overview" && <>
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
                <span>TOTAL PRIVATE ASSETS</span>
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
              liquidBalances.map((entry) => (
                <div className="token-balance" key={entry.address}>
                  <span className="token-symbol">
                    {entry.symbol.slice(0, 1)}
                  </span>
                  <p>
                    <strong>{entry.symbol}</strong>
                    <small>
                      {entry.vault
                        ? `${entry.vault.protocol} ${entry.vault.label} — ${entry.vault.kind === "stake" ? "staking" : entry.vault.kind === "reactor" ? "actively managed" : "lending"}`
                        : "Shielded in STRK20 pool"}
                    </small>
                  </p>
                  <b>{displayAmount(entry)}</b>
                </div>
              ))
            ) : !liquidBalances.length ? (
              <div className="account-empty">
                <ShieldCheck />
                <strong>No liquid private assets</strong>
                <span>
                  Deposit an asset to create your first encrypted note.
                </span>
              </div>
            ) : null}
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
              <span>DEFI VENUES</span>
              <strong>
                 {vesuRouteReady ? `${new Set(vaults.map((v) => v.protocol)).size} live` : "Not deployed"}
              </strong>
              <small>{vaults.length} verified vaults across {Array.from(new Set(vaults.map((v) => v.kind === "stake" ? "stake" : v.kind === "reactor" ? "managed" : "lend"))).sort().join(" + ") || "lend"}</small>
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
        <section className="overview-lower">
          <div className="section-head compact">
            <div><p className="eyebrow">LATEST MOVEMENT</p><h2>Recent activity</h2></div>
            <button className="button text-button" onClick={() => changeView("activity")}>View all <ArrowUpRight size={16} /></button>
          </div>
          <div className="activity-list"><ActivityRows compact /></div>
        </section>
        </>}
        {view === "positions" && <>
        <section className="page-intro">
          <p className="eyebrow">DEPLOYED CAPITAL</p>
          <h1>Where your capital<br /><span>is working.</span></h1>
          <p className="page-intro-copy">Active lending and staking positions routed through Sotto's private execution layer.</p>
        </section>
        <section className="section" id="positions">
          <div className="section-head">
            <div>
              <p className="eyebrow">ON-CHAIN POSITIONS</p>
              <h2>Private yield</h2>
              <p className="section-subtitle">
                Shielded capital routed into verified DeFi venues — lending and liquid staking, each under an anonymized identity.
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
                        <span className="protocol-mark">{vault.protocol.slice(0, 1)}</span>
                        <div>
                          <strong>{vault.protocol}</strong>
                          <span>{vault.label}</span>
                        </div>
                      </div>
                      <div className="position-stat">
                        <span>UNDERLYING</span>
                        <strong>{vault.underlying}</strong>
                      </div>
                      <div className="position-stat">
                        <span>TYPE</span>
                        <strong className="apy">{vault.kind === "stake" ? "Stake" : vault.kind === "reactor" ? "Managed" : "Lend"}</strong>
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
                    <strong>No yield route deployed</strong>
                    <span>
                      Set VITE_VESU_LENDING_HELPER_ADDRESS to Sotto's deployed helper on this network to enable the configured Vesu and Endur vaults.
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
              <h3>Wallet → STRK20 → helper → DeFi venue</h3>
              <p>
                The helper call and amount are public. The initiating wallet and the private share owner are hidden. One helper, many venues — each vault sees only the helper as its counterparty, not you.
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
                     {vesuRouteReady && vesuHelperAddress
                       ? `${vesuHelperAddress.slice(0, 8)}…`
                      : "Missing"}
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        </section>
        </>}
        {view === "activity" && <>
        <section className="page-intro activity-page-intro" id="activity">
          <p className="eyebrow">PRIVATE LEDGER</p>
          <h1>What happened<br /><span>to your capital.</span></h1>
          <p className="page-intro-copy">A confirmed record of deposits, transfers, withdrawals, and yield activity from this session.</p>
        </section>
        <section className="section activity-section dedicated-activity">
          <div className="section-head compact"><div><p className="eyebrow">TRANSACTION HISTORY</p><h2>Activity</h2></div></div>
          <div className="activity-filters" role="tablist">
            {(["All", "Deposits", "Transfers", "Withdrawals", "Yield"] as const).map((filter) => <button key={filter} className={activityFilter === filter ? "selected" : ""} onClick={() => setActivityFilter(filter)}>{filter}</button>)}
          </div>
          <div className="activity-list"><ActivityRows /></div>
        </section>
        </>}
        {view === "overview" && <section className="overview-privacy">
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
        </section>}
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
                  <strong>
                    {wallet.xverseDetected
                      ? "Xverse cannot sign STRK20 requests"
                      : "No compatible Starknet wallet detected"}
                  </strong>
                  <span>
                    {wallet.xverseDetected
                      ? "Xverse is installed, but its dapp provider does not expose the Starknet Wallet API required for private transactions. Use a privacy-enabled wallet such as Ready."
                      : "Install a privacy-enabled Starknet wallet such as Ready, then reload this page."}
                  </span>
                </div>
              )}
            </div>
          )}
          {wallet.error && <p className="form-error">{wallet.error}</p>}
        </ModalShell>
      )}
      {selectedActivity && (
        <ModalShell
          title={selectedActivity.label}
          eyebrow="ACTIVITY DETAIL"
          onClose={() => setSelectedActivity(null)}
        >
          <dl className="activity-detail">
            <div><dt>Amount</dt><dd>{selectedActivity.label}</dd></div>
            <div><dt>Status</dt><dd>{selectedActivity.status}</dd></div>
            <div><dt>Submitted</dt><dd>{selectedActivity.time}</dd></div>
            <div><dt>Transaction hash</dt><dd className="hash-value">{selectedActivity.hash}</dd></div>
          </dl>
          <a className="button primary modal-cta" href={`${wallet.networkName === "Sepolia" ? "https://sepolia.voyager.online" : "https://voyager.online"}/tx/${selectedActivity.hash}`} target="_blank" rel="noreferrer" onClick={() => setSelectedActivity(null)}>
            Open explorer <ArrowUpRight size={16} />
          </a>
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
            <BridgeAndShieldPanel
              chainId={selectedChain.id}
              chainName={selectedChain.name}
              amount={amount}
              token={token}
            />
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
          <PublicBalanceLine symbol={token} decimals={TOKENS[token].decimals} />
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
          <RemainingLine
            address={TOKENS[token].address}
            decimals={TOKENS[token].decimals}
            symbol={token}
            spend={amount}
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
          <RemainingLine
            address={TOKENS[token].address}
            decimals={TOKENS[token].decimals}
            symbol={token}
            spend={amount}
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
