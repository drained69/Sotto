import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Check,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  Github,
  Coins,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  RefreshCw,
  ShieldCheck,
  Vault,
  Wallet,
  X,
} from "lucide-react";
import {
  FEE_TOKEN_SYMBOL,
  formatTokenAmount,
  getPoolFee,
  getPublicBalance,
  getShieldedBalances,
  getTokenSymbol,
  getVaultMetadata,
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
  type VaultMetadata,
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
import * as Layerswap from "./layerswap";
import * as EvmWallet from "./evmWallet";
import * as CrossChain from "./crossChainDeposit";

type Modal =
  | "deposit"
  | "withdraw"
  | "transfer"
  | "lend"
  | "unlend"
  | "bridge"
  | "wallet"
  | "privacy"
  | null;
type Toast = { title: string; detail: string; type: "ok" | "error" } | null;
type ViewName = "overview" | "portfolio" | "positions" | "activity";
const VIEW_NAMES: ViewName[] = ["overview", "portfolio", "positions", "activity"];

type SessionTx = { hash: string; label: string; status: string; time: string; amount?: string; destination?: string };
type ActivityItem = {
  id: string;
  type: "Deposit" | "Yield" | "Transfer" | "Withdraw";
  title: string;
  detail: string;
  amount: string;
  time: string;
  status: "Complete" | "Private";
};
type ActivityRecord = ActivityItem & { hash?: string };

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

/**
 * Cross-chain bridge modal — Base or Arbitrum → Starknet USDC via Layerswap.
 *
 * State-machine UI. The user only ever signs ONE thing (the source-chain ERC-20 transfer);
 * everything else is polling. Every step surfaces the current state clearly so a closed tab or
 * a refresh mid-flow doesn't leave the user wondering where their money is.
 *
 * Safety notes:
 *   - Destination is passed in as a prop and locked. It's read from the connected Starknet wallet
 *     upstream, never user-typed. Refuse to render if the destination changes mid-swap.
 *   - We display the deposit address BEFORE the user signs so they can verify it against
 *     layerswap.io if they want to.
 *   - The exact base-unit amount comes straight from the Layerswap API response and is passed
 *     unmodified to viem's ERC-20 transfer encoding.
 */
function BridgeModal({
  destinationAddress,
  onClose,
  onArrived,
}: {
  destinationAddress: string;
  onClose: () => void;
  onArrived: () => void;
}) {
  const [source, setSource] = useState<Layerswap.SourceNetworkId>("BASE_MAINNET");
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<Layerswap.QuoteResponse | null>(null);
  const [limits, setLimits] = useState<Awaited<ReturnType<typeof Layerswap.limits>>>(null);
  const [active, setActive] = useState<CrossChain.ActiveCrossChain | null>(() => CrossChain.loadActive());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evmAddress, setEvmAddress] = useState<`0x${string}` | null>(null);
  const [evmBalance, setEvmBalance] = useState<bigint | null>(null);

  // Refuse to keep a stored swap if the connected Starknet destination changed since it was
  // started. This is the "you connected a different wallet mid-flow" case.
  useEffect(() => {
    if (active && active.destinationAddress.toLowerCase() !== destinationAddress.toLowerCase()) {
      CrossChain.clearActive();
      setActive(null);
    }
  }, [active, destinationAddress]);

  // Live quote while typing, debounced. Doesn't fetch when a swap is already in flight — the
  // quote there was locked in at creation time.
  useEffect(() => {
    if (active) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setQuote(null);
      return;
    }
    const handle = window.setTimeout(async () => {
      const [q, l] = await Promise.all([
        Layerswap.quote({ sourceNetwork: source, amount: n }),
        Layerswap.limits({ sourceNetwork: source }),
      ]);
      setQuote(q);
      setLimits(l);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [source, amount, active]);

  // Poll active swap status. Backoff kept simple: 8s cadence is well within Layerswap's rate
  // limits for anonymous callers and matches their typical arrival latency.
  useEffect(() => {
    if (!active || active.state === "arrived" || active.state === "completed" || active.state === "failed" || active.state === "refunded") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await Layerswap.getSwap(active.swapId);
        if (cancelled) return;
        const newState = CrossChain.mapLayerswapStatus(result.swap.status, active.sourceTxHash);
        const next: CrossChain.ActiveCrossChain = {
          ...active,
          state: newState,
          failReason: result.swap.fail_reason,
          lastPolledAt: new Date().toISOString(),
        };
        CrossChain.saveActive(next);
        setActive(next);
        if (newState === "arrived") onArrived();
      } catch {
        // Transient network errors are logged silently; the next tick retries.
      }
    };
    void poll();
    const interval = window.setInterval(poll, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active, onArrived]);

  async function connectEvm() {
    setError("");
    try {
      const addr = await EvmWallet.requestAccounts();
      setEvmAddress(addr);
      // We don't refuse to proceed if the wallet is on the wrong chain here — ensureChain runs at
      // signing time, which is when it actually matters. That way the user sees the balance for
      // whatever chain they connected on first.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Read USDC balance for display / max-click. The Layerswap USDC contract is discoverable via
  // their networks endpoint, but for these two chains it's stable and public — Base USDC and
  // Arbitrum USDC are canonical Circle addresses.
  useEffect(() => {
    if (!evmAddress) {
      setEvmBalance(null);
      return;
    }
    const usdcByChain: Record<Layerswap.SourceNetworkId, `0x${string}`> = {
      BASE_MAINNET: "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913",
      ARBITRUM_MAINNET: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    };
    void EvmWallet.tokenBalance(source, usdcByChain[source], evmAddress).then(setEvmBalance).catch(() => setEvmBalance(null));
  }, [evmAddress, source]);

  async function createAndSign() {
    setError("");
    setBusy(true);
    try {
      if (!evmAddress) throw new Error("Connect an EVM wallet first");
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a valid amount");
      // Ensure the wallet is on the exact source chain BEFORE we create the swap. Creating and
      // then failing to sign is a wasted API call but not a funds risk; signing on the wrong
      // chain IS a funds risk.
      await EvmWallet.ensureChain(source);

      // Create the swap. Layerswap issues a per-swap deposit address here.
      const created = await Layerswap.createSwap({
        sourceNetwork: source,
        destinationAddress,
        amount: n,
      });
      const action = created.deposit_actions[0]!;

      // Persist BEFORE signing. If the user's tab dies between signing and localStorage write,
      // they still have the swap ID recorded and can resume tracking.
      const record: CrossChain.ActiveCrossChain = {
        swapId: created.swap.id,
        destinationAddress,
        sourceNetwork: source,
        requestedAmount: n,
        depositAddress: action.to_address,
        depositAmountBaseUnits: action.amount_in_base_units,
        tokenContract: action.token.contract!,
        sourceTxHash: null,
        createdAt: new Date().toISOString(),
        state: "awaiting_deposit",
        lastPolledAt: null,
        failReason: null,
      };
      CrossChain.saveActive(record);
      setActive(record);

      // Sign the source-chain ERC-20 transfer. The amount is the EXACT base-unit value from
      // Layerswap; we don't recompute it.
      const txHash = await EvmWallet.sendErc20Transfer({
        chain: source,
        token: action.token.contract as `0x${string}`,
        from: evmAddress,
        to: action.to_address as `0x${string}`,
        amount: BigInt(action.amount_in_base_units),
      });

      const signed: CrossChain.ActiveCrossChain = { ...record, sourceTxHash: txHash, state: "deposit_sent" };
      CrossChain.saveActive(signed);
      setActive(signed);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The user rejected the wallet prompt — not an error, revert to awaiting_deposit if we
      // already created the swap so they can retry the signature.
      if (message.toLowerCase().includes("user rejected") || (e as { code?: number }).code === 4001) {
        setError("Wallet rejected the transaction. The swap is still open; click Send again to sign.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  function abandonSwap() {
    if (!confirm("Discard this swap? If you have already sent funds on the source chain, Layerswap will still process and deliver them; only Sotto's tracking is cleared.")) return;
    CrossChain.clearActive();
    setActive(null);
    setError("");
  }

  return (
    <ModalShell title="Bridge to Starknet" eyebrow="CROSS-CHAIN DEPOSIT" onClose={onClose}>
      {!active && (
        <>
          <div className="privacy-callout">
            <ShieldCheck />
            <p>
              <strong>How this works</strong>
              <span>
                Bridge USDC from Base or Arbitrum to your Starknet wallet via Layerswap. You sign one ERC-20 transfer on the source chain — Sotto tracks arrival and prompts you to shield in the Deposit modal. The bridge routing is Layerswap's; the private-shield step is Sotto's.
              </span>
            </p>
          </div>
          <label className="field">
            <span>Source chain</span>
            <div className="chain-grid">
              {(Object.entries(Layerswap.SOURCE_NETWORKS) as Array<[Layerswap.SourceNetworkId, { label: string }]>).map(
                ([id, spec]) => (
                  <button
                    key={id}
                    className={source === id ? "selected" : ""}
                    onClick={() => setSource(id)}
                  >
                    {spec.label}
                    {source === id && <Check />}
                  </button>
                ),
              )}
            </div>
          </label>
          <div className="form-row">
            <label className="field grow">
              <span>Amount (USDC)</span>
              <input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} />
            </label>
            <label className="field">
              <span>Wallet balance</span>
              <input
                readOnly
                value={
                  evmBalance === null
                    ? evmAddress
                      ? "Reading…"
                      : "Connect EVM wallet"
                    : `${(Number(evmBalance) / 1_000_000).toFixed(2)} USDC`
                }
              />
            </label>
          </div>
          {limits && (
            <p className="field-note">
              <span>Layerswap route limits</span>
              <b>
                {limits.min_amount.toFixed(2)} – {limits.max_amount.toLocaleString()} USDC
              </b>
            </p>
          )}
          {quote && (
            <div className="bridge-quote">
              <div>
                <span>You send</span>
                <strong>{Number(amount).toFixed(2)} USDC</strong>
              </div>
              <div>
                <span>Layerswap fee</span>
                <strong>{quote.quote.total_fee.toFixed(4)} USDC</strong>
              </div>
              <div>
                <span>Arrives on Starknet</span>
                <strong>{quote.quote.receive_amount.toFixed(4)} USDC</strong>
              </div>
              <div>
                <span>Minimum received</span>
                <strong>{quote.quote.min_receive_amount.toFixed(4)} USDC</strong>
              </div>
            </div>
          )}
          <div className="bridge-destination">
            <span>Destination (your Starknet wallet, locked)</span>
            <code>{destinationAddress}</code>
          </div>
          {!evmAddress ? (
            <button className="button primary modal-cta" onClick={connectEvm} disabled={busy}>
              Connect EVM wallet
            </button>
          ) : (
            <button className="button primary modal-cta" onClick={createAndSign} disabled={busy || !quote}>
              {busy ? "Waiting for wallet…" : `Send ${Number(amount || 0).toFixed(2)} USDC from ${Layerswap.SOURCE_NETWORKS[source].label}`}
            </button>
          )}
          {error && <p className="form-error">{error}</p>}
        </>
      )}
      {active && (
        <div className="bridge-status">
          <div className="bridge-progress">
            {(["awaiting_deposit", "deposit_sent", "bridging", "arrived"] as const).map((step, i) => {
              const stepIndex = ["awaiting_deposit", "deposit_sent", "bridging", "arrived"].indexOf(active.state);
              const cls = stepIndex >= i ? (stepIndex === i && !["arrived", "completed"].includes(active.state) ? "current" : "done") : "";
              return (
                <div key={step} className={`bridge-progress-step ${cls}`}>
                  <span>{i + 1}</span>
                  <b>{{ awaiting_deposit: "Send", deposit_sent: "Detect", bridging: "Route", arrived: "Arrive" }[step]}</b>
                </div>
              );
            })}
          </div>
          <dl className="bridge-facts">
            <div>
              <dt>Swap id</dt>
              <dd><code>{active.swapId.slice(0, 8)}…</code></dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>{Layerswap.SOURCE_NETWORKS[active.sourceNetwork].label}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{active.requestedAmount} USDC</dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd><code>{active.destinationAddress.slice(0, 10)}…{active.destinationAddress.slice(-6)}</code></dd>
            </div>
            {active.sourceTxHash && (
              <div>
                <dt>Source tx</dt>
                <dd>
                  <a
                    href={`${EvmWallet.EVM_CHAINS[active.sourceNetwork].explorer}/tx/${active.sourceTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {active.sourceTxHash.slice(0, 10)}…
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {active.state === "awaiting_deposit" && (
            <>
              <p className="bridge-explainer">
                Sotto is waiting for you to sign the source-chain transfer. The deposit address is
                shown below — this is Layerswap's per-swap address, unique to your swap id.
              </p>
              <div className="bridge-destination">
                <span>Send exactly this amount to</span>
                <code>{active.depositAddress}</code>
              </div>
              <button className="button primary modal-cta" onClick={createAndSign} disabled={busy}>
                {busy ? "Waiting for wallet…" : "Sign source-chain transfer"}
              </button>
            </>
          )}
          {active.state === "deposit_sent" && (
            <p className="bridge-explainer">
              Waiting for Layerswap to detect your source-chain transfer. This usually takes under a minute after confirmation.
            </p>
          )}
          {active.state === "bridging" && (
            <p className="bridge-explainer">
              Layerswap is routing your funds to Starknet. Typical arrival is 3–10 minutes; leaving this tab is fine — Sotto keeps the swap id and will resume tracking on reload.
            </p>
          )}
          {active.state === "arrived" && (
            <>
              <p className="bridge-explainer bridge-success">
                Funds arrived on your Starknet wallet. Close this modal and hit Shield in the Deposit modal to put them into the STRK20 pool.
              </p>
              <button className="button primary modal-cta" onClick={() => { CrossChain.clearActive(); setActive(null); onClose(); }}>
                Done
              </button>
            </>
          )}
          {active.state === "failed" && (
            <p className="form-error">
              Swap failed{active.failReason ? `: ${active.failReason}` : ""}. If you already sent funds, check the Layerswap swap page for refund status.
            </p>
          )}
          {active.state === "refunded" && (
            <p className="bridge-explainer">
              Layerswap has refunded your funds to the source-chain address. Nothing was lost.
            </p>
          )}
          <div className="bridge-actions">
            <a
              className="link-button"
              href={`https://layerswap.io/app/swap/${active.swapId}`}
              target="_blank"
              rel="noreferrer"
            >
              Verify on Layerswap ↗
            </a>
            <button className="link-button" onClick={abandonSwap}>Discard tracker</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function App() {
  const wallet = useWallet();
  const [modal, setModal] = useState<Modal>(null);
  const [hideBalance, setHideBalance] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [token, setToken] = useState<TokenSymbol>("USDC");
  const [amount, setAmount] = useState("100");
  const [recipient, setRecipient] = useState("");
  const [selectedVault, setSelectedVault] = useState<YieldVault | undefined>(
    vaults[0],
  );
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
  const [balancesAsOf, setBalancesAsOf] = useState<string | null>(null);
  const [vaultMetadata, setVaultMetadata] = useState<Map<string, VaultMetadata>>(new Map());
  const [vaultDataState, setVaultDataState] = useState<"idle" | "loading" | "live" | "error">("idle");
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
  const [view, setView] = useState<ViewName>(
    () => {
      const hash = window.location.hash.slice(1);
      return (["overview", "portfolio", "positions", "activity"].includes(hash) ? hash : "overview") as ViewName;
    },
  );
  const [activityFilter, setActivityFilter] = useState<"All" | "Deposits" | "Transfers" | "Withdrawals" | "Yield">("All");
  const [selectedActivity, setSelectedActivity] = useState<ActivityRecord | null>(null);
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
  const configuredLiquidBalances = (Object.entries(TOKENS) as [TokenSymbol, typeof TOKENS[TokenSymbol]][])
    .filter(([, config]) => Boolean(config.address))
    .map(([symbol, config]) => ({
      address: normalizeAddress(config.address),
      balance: balances.get(normalizeAddress(config.address)) ?? 0n,
      symbol,
      decimals: config.decimals,
      vault: undefined,
    }));
  const additionalLiquidBalances = liquidBalances.filter(
    (entry) => !configuredLiquidBalances.some((configured) => configured.address === entry.address),
  );
  const portfolioLiquidBalances = [...configuredLiquidBalances, ...additionalLiquidBalances];

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
      setBalancesAsOf(null);
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
      setBalancesAsOf(new Date().toISOString());
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

  const loadVaultMetadata = useEffectEvent(async () => {
    if (!wallet.account || !vaults.length) {
      setVaultMetadata(new Map());
      setVaultDataState("idle");
      return;
    }
    setVaultDataState("loading");
    try {
      const metadata = await Promise.all(
        vaults.map((vault) => getVaultMetadata(wallet.account!.provider, vault)),
      );
      setVaultMetadata(new Map(metadata.map((item) => [item.vaultId, item])));
      setVaultDataState("live");
    } catch {
      setVaultMetadata(new Map());
      setVaultDataState("error");
    }
  });

  function dataAsOf(value: string | null): string {
    if (!value) return "Not synchronized";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

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
    void loadVaultMetadata();
  }, [wallet.address, wallet.chainId, syncBalancesOnConnect, loadPoolFee, loadPublicBalances, loadVaultMetadata]);

  async function confirmTransaction(hash: string, label: string, amount?: string, destination?: string) {
    setTransactions((items) => [
      { hash, label, status: "Confirming", time: "Now", amount, destination },
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
    // Non-Starknet source chains are now handled by BridgeAndShieldPanel: the user bridges
    // externally, funds land in their Starknet wallet, and this shield spends that public
    // balance. The source chain field is only a routing hint for the bridge step — the shield
    // itself is always Starknet-native, so nothing needs to be gated on chain choice here.
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
      await confirmTransaction(
        response.transaction_hash,
        label,
        `${amount} ${token}`,
        kind === "withdraw" ? recipient.trim() : undefined,
      );
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
      await confirmTransaction(response.transaction_hash, label, `${amount} ${selectedVault.underlying}`);
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
      await confirmTransaction(response.transaction_hash, label, `${amount} v${selectedVault.underlying}`);
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
      await confirmTransaction(response.transaction_hash, label, `${amount} ${token}`, recipient.trim());
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

  function changeView(nextView: ViewName) {
    setView(nextView);
    window.history.replaceState(null, "", `#${nextView}`);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const onHashChange = () => {
      const next = window.location.hash.slice(1);
      if (VIEW_NAMES.includes(next as ViewName)) setView(next as ViewName);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const activityRecords: ActivityRecord[] = [
    ...transactions.map((item) => ({
      id: item.hash,
      type: item.label.toLowerCase().includes("withdraw")
        ? "Withdraw" as const
        : item.label.toLowerCase().includes("lend") || item.label.toLowerCase().includes("yield")
          ? "Yield" as const
          : item.label.toLowerCase().includes("transfer")
            ? "Transfer" as const
            : "Deposit" as const,
      title: item.label,
      detail: item.destination
        ? `To ${item.destination.slice(0, 8)}…${item.destination.slice(-4)}`
        : item.label.toLowerCase().includes("lend")
          ? "Private position allocation · Starknet"
          : "Private account movement · Starknet",
      amount: item.amount ?? "",
      time: item.time,
      status: item.status === "Confirming" ? "Private" as const : "Complete" as const,
      hash: item.hash,
    })),
  ];

  const filteredActivity = activityRecords.filter((item) => {
    if (activityFilter === "All") return true;
    if (activityFilter === "Yield") return item.type === "Yield";
    if (activityFilter === "Deposits") return item.type === "Deposit";
    if (activityFilter === "Withdrawals") return item.type === "Withdraw";
    return item.type === "Transfer";
  });

  /**
   * Renders wallet/pool state as an account-empty block, or null when balances are readable and
   * should render normally. Used by both Overview (as a compact banner) and Portfolio (as the
   * main placeholder). Keeps the many status strings in one place.
   */
  function BalanceStateNotice() {
    if (wallet.restoring)
      return (
        <div className="account-empty">
          <RefreshCw className="spin" />
          <strong>Reconnecting your wallet</strong>
          <span>Restoring the session you approved earlier. No new approval is needed.</span>
        </div>
      );
    if (!wallet.account)
      return (
        <div className="account-empty">
          <LockKeyhole />
          <strong>Connect a privacy-enabled Starknet wallet</strong>
          <span>Sotto cannot read private balances without wallet approval.</span>
        </div>
      );
    if (balanceState === "loading")
      return (
        <div className="account-empty">
          <RefreshCw className="spin" />
          <strong>Discovering encrypted notes</strong>
          <span>Your wallet is scanning STRK20 channels.</span>
        </div>
      );
    if (balanceState === "wrongNetwork")
      return (
        <div className="account-empty error">
          <ArrowRightLeft />
          <strong>Switch to Starknet {configuredNetworkLabel(strk20Network)}</strong>
          <span>
            This deployment runs on {configuredNetworkLabel(strk20Network)}, and your wallet is on {wallet.networkName}. Change the network in your wallet — Sotto reconnects on its own.
          </span>
        </div>
      );
    if (balanceState === "unregistered")
      return (
        <div className="account-empty">
          <Fingerprint />
          <strong>Register with STRK20 once</strong>
          <span>
            This account has never used the privacy pool. Registration is a one-time on-chain step your wallet owns — complete it in your wallet, then sync again.
          </span>
        </div>
      );
    if (balanceState === "error")
      return (
        <div className="account-empty error">
          <CircleHelp />
          <strong>Private balances unavailable</strong>
          <span>Confirm Wallet API 0.10.3 support and the connected network.</span>
        </div>
      );
    return null;
  }

  /**
   * Compact single-token row used by Portfolio for both shielded assets (STRK20 notes) and
   * deployed positions (vault shares). The kind sub-label distinguishes them.
   */
  function AssetRow({ entry }: { entry: (typeof knownBalances)[number] }) {
    return (
      <div className="token-balance" key={entry.address}>
        <span className="token-symbol">{entry.symbol.slice(0, 1)}</span>
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
    );
  }

  function ActivityRows({ compact = false }: { compact?: boolean }) {
    const items = compact ? activityRecords.slice(0, 3) : filteredActivity;
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
      <button className="activity-row activity-button" key={item.id} onClick={() => setSelectedActivity(item)}>
        <span className="activity-icon"><Activity /></span>
        <div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span></div>
        <span className="activity-time">{item.time}</span>
        <div className="activity-amount"><strong>{item.amount || item.status}</strong><span>{item.status} <ArrowUpRight size={12} /></span></div>
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
          <a className={view === "portfolio" ? "active" : ""} href="#portfolio" onClick={(event) => { event.preventDefault(); changeView("portfolio"); }}>
            <Coins size={17} />
            Portfolio
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
      <main className={view === "overview" ? "home-view" : undefined}>
        {view === "overview" && <>
         <section className="intro" id="overview">
          <div>
            <p className="eyebrow">PRIVATE CAPITAL</p>
             <h1>Capital,<br /><span>privately managed.</span></h1>
          </div>
          <p className="intro-copy">
             Hold, move, and deploy your assets across verified Starknet strategies.
             <br />Your wallet remains the source of truth.
          </p>
          <button className="hero-entry" onClick={() => changeView("portfolio")} aria-label="Open portfolio">
            <span>Manage your portfolio</span>
            <ArrowDown size={17} />
          </button>
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
                <span className="muted">Verified wallet data · as of {dataAsOf(balancesAsOf)}</span>
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
                onClick={() => {
                  void syncBalances();
                  void loadVaultMetadata();
                }}
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
          {/* Overview keeps the panel light: state messages when relevant, otherwise a one-line
              summary linking to the Portfolio page for the full asset breakdown. The detailed
              per-token grid moved to Portfolio so this page can answer "what do I have?" quickly. */}
          {(() => {
            const notice = <BalanceStateNotice />;
            if (notice) return <div className="live-balances live-balances-compact">{notice}</div>;
            if (!knownBalances.length)
              return (
                <div className="live-balances live-balances-compact">
                  <div className="account-empty">
                    <ShieldCheck />
                    <strong>No private assets yet</strong>
                    <span>Deposit an asset to create your first encrypted note.</span>
                  </div>
                </div>
              );
            return (
              <div className="overview-portfolio-summary">
                <div>
                  <span className="eyebrow">HOLDINGS</span>
                  <p>
                    {liquidBalances.length} shielded {liquidBalances.length === 1 ? "asset" : "assets"}
                    {positionBalances.length > 0 && ` · ${positionBalances.length} deployed`}
                  </p>
                </div>
                <button className="button text-button" onClick={() => changeView("portfolio")}>
                  Open portfolio <ArrowUpRight size={16} />
                </button>
              </div>
            );
          })()}
          <div className="metrics-row">
            <div>
              <span>LIQUID ASSETS</span>
              <strong>{liquidBalances.length}</strong>
              <small>Verified · STRK20 notes</small>
            </div>
            <div>
              <span>YIELD POSITIONS</span>
              <strong>{positionBalances.length}</strong>
              <small>Verified · STRK20 notes</small>
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
         <section className="overview-lower activity-bar">
          <div className="activity-bar-head">
            <div><p className="eyebrow">LATEST MOVEMENT</p><h2>Recent activity</h2></div>
            <button className="button text-button" onClick={() => changeView("activity")}>View all <ArrowUpRight size={16} /></button>
          </div>
          <div className="activity-list activity-bar-list"><ActivityRows compact /></div>
        </section>
        </>}
        {view === "portfolio" && <>
          <section className="page-intro">
            <p className="eyebrow">PRIVATE PORTFOLIO</p>
            <h1>What you<br /><span>own.</span></h1>
            <p className="page-intro-copy">
              Every shielded asset and every deployed position, read directly from your wallet's STRK20 notes. The distinction: assets are what you hold, positions are where that capital is currently working.
            </p>
          </section>
          <section className="section">
            <div className="section-head">
              <div>
                <p className="eyebrow">SHIELDED ASSETS</p>
                <h2>Liquid holdings</h2>
                <p className="section-subtitle">
                  Encrypted notes held inside the STRK20 pool. Spendable via Transfer, Withdraw, or by opening a yield position.
                </p>
                <div className="data-provenance">
                  <span><i className="verified-dot" /> Wallet-verified</span>
                  <span>As of {dataAsOf(balancesAsOf)}</span>
                </div>
              </div>
              <div className="balance-actions">
                <button className="button primary" onClick={() => setModal("deposit")}><ArrowDownLeft size={18} />Deposit</button>
                <button className="button secondary" onClick={() => setModal("transfer")}><ArrowRightLeft size={18} />Transfer</button>
                <button className="button secondary" onClick={() => setModal("withdraw")}><ArrowUpRight size={18} />Withdraw</button>
              </div>
            </div>
            <div className="live-balances portfolio-grid">
              {(() => {
                const notice = <BalanceStateNotice />;
                if (notice) return notice;
                 if (balanceState !== "live" && balanceState !== "loading" && !liquidBalances.length)
                   return (
                    <div className="account-empty">
                      <ShieldCheck />
                      <strong>No shielded assets</strong>
                      <span>Deposit STRK or USDC to create your first encrypted note.</span>
                    </div>
                  );
                 return portfolioLiquidBalances.map((entry) => <AssetRow entry={entry} key={entry.address} />);
              })()}
            </div>
          </section>
          <section className="section">
            <div className="section-head">
              <div>
                <p className="eyebrow">DEPLOYED CAPITAL</p>
                <h2>Yield positions</h2>
                <p className="section-subtitle">
                  Vault shares held as encrypted notes. Each position is capital already at work — details, exchange rates and close actions live on the Positions page.
                </p>
              </div>
              <button className="button text-button" onClick={() => changeView("positions")}>
                Manage positions <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="live-balances portfolio-grid">
              {positionBalances.length
                ? positionBalances.map((entry) => <AssetRow entry={entry} key={entry.address} />)
                : (
                  <div className="account-empty">
                    <Vault />
                    <strong>No deployed capital</strong>
                    <span>Open a Vesu or Endur position from the Positions page to put shielded assets to work.</span>
                  </div>
                )
              }
            </div>
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
                Shares are wallet-reported STRK20 notes. Exchange rates and vault state are read separately from Starknet RPC; unavailable protocol metrics are never estimated.
              </p>
              <div className="data-provenance">
                <span><i className="verified-dot" /> Verified on-chain</span>
                <span>Notes as of {dataAsOf(balancesAsOf)}</span>
                <span>Vault reads {vaultDataState === "loading" ? "refreshing" : vaultDataState === "error" ? "unavailable" : `as of ${dataAsOf(vaultMetadata.values().next().value?.fetchedAt ?? null)}`}</span>
              </div>
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
                <span>APY</span>
                <span>SHARES</span>
                <span className="align-right">POSITION VALUE</span>
                <span />
              </div>
              {positionBalances.length ? (
               vaults.filter((vault) => positionBalances.some((item) => item.address === normalizeAddress(vault.vTokenAddress))).map((vault) => {
                  const entry = positionBalances.find(
                    (item) =>
                      item.address === normalizeAddress(vault.vTokenAddress),
                  );
                  const metadata = vaultMetadata.get(vault.id);
                  const underlyingValue = entry && metadata?.assetsPerShare !== null && metadata?.assetsPerShare !== undefined
                    ? metadata.assetsPerShare * entry.balance / 10n ** BigInt(vault.vTokenDecimals)
                    : null;
                  return (
                    <article className="position-entry" key={vault.id}>
                    <div className="position-row">
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
                        <span>CURRENT APY</span>
                        <strong>APY unavailable</strong>
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
                            ? underlyingValue === null
                              ? "Value unavailable"
                              : `${formatTokenAmount(underlyingValue, TOKENS[vault.underlying].decimals)} ${vault.underlying}`
                            : `0 ${vault.underlying}`}
                        </strong>
                        <span>{underlyingValue === null ? "No verified exchange rate" : "On-chain exchange rate"}</span>
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
                    </div>
                    <dl className="vault-facts">
                      <div><dt>Exchange rate</dt><dd>{metadata?.assetsPerShare === null || metadata?.assetsPerShare === undefined ? "Unavailable" : `1 share = ${formatTokenAmount(metadata.assetsPerShare, TOKENS[vault.underlying].decimals)} ${vault.underlying}`}</dd></div>
                      <div><dt>Utilization</dt><dd>{metadata?.utilization === null || metadata?.utilization === undefined ? "Unavailable" : `${metadata.utilization.toFixed(2)}%`}</dd></div>
                      <div><dt>Pause state</dt><dd>{metadata?.paused === null || metadata?.paused === undefined ? "Unavailable" : metadata.paused ? "Paused" : "Active"}</dd></div>
                      <div><dt>Vault state</dt><dd>{metadata ? `Starknet RPC${metadata.blockNumber === null ? "" : ` · block ${metadata.blockNumber}`}` : vaultDataState === "loading" ? "Reading…" : "Unavailable"}</dd></div>
                      <div><dt>Vault totals</dt><dd>{metadata?.totalAssets === null || metadata?.totalAssets === undefined || metadata?.totalSupply === null || metadata?.totalSupply === undefined ? "Unavailable" : "Available on-chain"}</dd></div>
                    </dl>
                    </article>
                  );
                })
               ) : (
                <div className="route-empty">
                  <CircleHelp />
                  <div>
                    <strong>{vaults.length ? "No active positions" : "No yield route deployed"}</strong>
                    <span>
                       No private positions are active. Open a verified strategy to see deployed capital here.
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
          <p className="page-intro-copy">Transactions submitted in this browser session only. Historical activity is unavailable until a verified indexer is integrated.</p>
        </section>
        <section className="section activity-section dedicated-activity">
          <div className="section-head compact"><div><p className="eyebrow">TRANSACTION HISTORY</p><h2>Activity</h2></div></div>
          <div className="activity-filters" role="tablist">
            {(["All", "Deposits", "Transfers", "Withdrawals", "Yield"] as const).map((filter) => <button key={filter} className={activityFilter === filter ? "selected" : ""} onClick={() => setActivityFilter(filter)}>{filter}</button>)}
          </div>
          <div className="activity-list"><ActivityRows /></div>
        </section>
        </>}
        {view === "overview" && <section className="docs-bar" aria-labelledby="docs-title">
          <div className="docs-bar-head">
            <div>
              <p className="eyebrow">SOTTO DOCUMENTATION</p>
              <h2 id="docs-title">Private capital, clearly explained.</h2>
            </div>
            <button className="button secondary" onClick={() => setModal("privacy")}>
              Read privacy model <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="docs-grid">
            <article>
              <span className="docs-index">01</span>
              <h3>How it works</h3>
              <p>Your wallet discovers encrypted STRK20 notes, keeps the viewing key, and authorizes every proof. Sotto only constructs the requested action and verifies the Starknet receipt.</p>
            </article>
            <article>
              <span className="docs-index">02</span>
              <h3>What it protects</h3>
              <p>Balances, note ownership, private transfers, amounts, and spent notes remain protected inside the privacy pool rather than being reconstructed by the app.</p>
            </article>
            <article>
              <span className="docs-index">03</span>
              <h3>What remains public</h3>
              <p>Deposits, withdrawals, timing, helper activity, and anonymizer output amounts remain visible on-chain. Sotto improves privacy without claiming invisibility.</p>
            </article>
          </div>
        </section>}
      </main>
      <footer>
        <a
          className="github-link"
          href="https://github.com/drained69/Sotto"
          target="_blank"
          rel="noreferrer"
          aria-label="Sotto on GitHub"
          title="Sotto on GitHub"
        >
          <Github size={18} />
        </a>
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
          title={selectedActivity.title}
          eyebrow="ACTIVITY DETAIL"
          onClose={() => setSelectedActivity(null)}
        >
          <dl className="activity-detail">
            <div><dt>Activity</dt><dd>{selectedActivity.title}</dd></div>
            <div><dt>Amount</dt><dd>{selectedActivity.amount || "Not available"}</dd></div>
            <div><dt>Details</dt><dd>{selectedActivity.detail}</dd></div>
            <div><dt>Status</dt><dd>{selectedActivity.status}</dd></div>
            <div><dt>Submitted</dt><dd>{selectedActivity.time}</dd></div>
            {selectedActivity.hash && <div><dt>Transaction hash</dt><dd className="hash-value">{selectedActivity.hash}</dd></div>}
          </dl>
          {selectedActivity.hash && <a className="button primary modal-cta" href={`${wallet.networkName === "Sepolia" ? "https://sepolia.voyager.online" : "https://voyager.online"}/tx/${selectedActivity.hash}`} target="_blank" rel="noreferrer" onClick={() => setSelectedActivity(null)}>
            Open explorer <ArrowUpRight size={16} />
          </a>}
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
            disabled={busy}
            onClick={() => runAssetAction("deposit")}
          >
            {busy
              ? "Waiting for wallet…"
              : !wallet.account
                ? "Connect wallet to deposit"
                : `Shield ${amount || "0"} ${token}`}
          </button>
          {/* Bringing funds from Base / Arbitrum stays entirely inside Sotto: connect the EVM
              wallet, sign one ERC-20 transfer on the source chain, Sotto tracks the swap via
              Layerswap's API and picks up the arrival on the connected Starknet wallet. */}
          <button
            type="button"
            className="button secondary bridge-open"
            onClick={() => setModal("bridge")}
            disabled={!wallet.address}
          >
            <ArrowRightLeft size={16} />
            Bring USDC from Base or Arbitrum
          </button>
        </ModalShell>
      )}
      {modal === "bridge" && wallet.address && (
        <BridgeModal
          destinationAddress={wallet.address}
          onClose={() => setModal(null)}
          onArrived={() => {
            void loadPublicBalances();
            notify({
              title: "Bridged funds arrived",
              detail: "Public USDC is now on your Starknet wallet — Shield it from the Deposit modal.",
              type: "ok",
            });
          }}
        />
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
