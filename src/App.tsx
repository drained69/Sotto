import { useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  Menu,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Vault,
  Wallet,
  X,
} from "lucide-react";
import { activity, chains, chartData, strategies, type Strategy } from "./data";
import { getErrorMessage, getShieldedBalances, shield, withdraw } from "./strk20";
import { useWallet } from "./useWallet";

type Modal = "deposit" | "withdraw" | "allocate" | "wallet" | "privacy" | null;
type Toast = { title: string; detail: string; type: "ok" | "error" } | null;

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

function Logo() {
  return (
    <div className="logo" aria-label="Sotto">
      <span className="logo-mark"><span /></span>
      <span>Sotto</span>
    </div>
  );
}

function BalanceChart({ hidden }: { hidden: boolean }) {
  const width = 760;
  const height = 185;
  const min = Math.min(...chartData) - 350;
  const max = Math.max(...chartData) + 150;
  const points = chartData.map((value, index) => {
    const x = (index / (chartData.length - 1)) * width;
    const y = height - ((value - min) / (max - min)) * height;
    return `${x},${y}`;
  });
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;

  return (
    <div className={`chart-wrap ${hidden ? "blurred-chart" : ""}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Thirty day account balance chart">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#26332b" stopOpacity="0.2" />
            <stop offset="1" stopColor="#26332b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#chartFill)" />
        <path d={line} fill="none" stroke="#26332b" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-labels"><span>JUL 19</span><span>JUL 27</span><span>AUG 04</span><span>AUG 17</span></div>
    </div>
  );
}

function ProtocolMark({ strategy }: { strategy: Strategy }) {
  return <span className="protocol-mark" style={{ background: strategy.color }}>{strategy.protocol.slice(0, 1)}</span>;
}

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
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
  const [token, setToken] = useState<"USDC" | "STRK">("USDC");
  const [amount, setAmount] = useState("1000");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [allocations, setAllocations] = useState(strategies.map((item) => item.allocation));

  const balance = 25200.45;
  const annualYield = 2036.21;
  const netApy = 8.08;

  function notify(next: Toast) {
    setToast(next);
    window.setTimeout(() => setToast(null), 4200);
  }

  function display(value: string) {
    return hideBalance ? "••••••" : value;
  }

  async function runLiveAction(kind: "deposit" | "withdraw") {
    if (!wallet.account) {
      setModal("wallet");
      return;
    }
    if (selectedChain.id !== "starknet" && kind === "deposit") {
      notify({ title: "Bridge route not configured", detail: "Deploy the STRK20 CCTP bridge client before enabling live EVM deposits.", type: "error" });
      return;
    }
    if (kind === "withdraw" && !recipient.trim()) {
      notify({ title: "Recipient required", detail: "Enter a fresh Starknet address for this withdrawal.", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const response = kind === "deposit"
        ? await shield(wallet.account, token, amount)
        : await withdraw(wallet.account, token, amount, recipient.trim());
      notify({ title: kind === "deposit" ? "Shielding submitted" : "Withdrawal submitted", detail: `Transaction ${response.transaction_hash.slice(0, 10)}… is proving on Starknet.`, type: "ok" });
      setModal(null);
    } catch (error) {
      notify({ title: "Transaction failed", detail: getErrorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function refreshBalance() {
    if (!wallet.account) {
      notify({ title: "Demo balance", detail: "Connect a privacy-enabled wallet to query encrypted notes live.", type: "ok" });
      return;
    }
    setBusy(true);
    try {
      const result = await getShieldedBalances(wallet.account);
      const count = Array.isArray(result) ? result.length : 0;
      notify({ title: "Shielded notes synced", detail: `${count} private token balance${count === 1 ? "" : "s"} returned by your wallet.`, type: "ok" });
    } catch (error) {
      notify({ title: "Balance query failed", detail: getErrorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  }

  const allocationTotal = allocations.reduce((sum, item) => sum + item, 0);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <nav className={menuOpen ? "nav-open" : ""} aria-label="Primary navigation">
          <a className="active" href="#overview" onClick={() => setMenuOpen(false)}><LayoutDashboard size={17} />Overview</a>
          <a href="#positions" onClick={() => setMenuOpen(false)}><Vault size={17} />Positions</a>
          <a href="#activity" onClick={() => setMenuOpen(false)}><Activity size={17} />Activity</a>
        </nav>
        <div className="top-actions">
          <button className="privacy-chip" onClick={() => setModal("privacy")}><ShieldCheck size={15} />Privacy active</button>
          <button className="wallet-button" onClick={() => setModal("wallet")}>
            <Wallet size={16} />{wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect"}
          </button>
          <button className="menu-button" aria-label="Toggle menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <main>
        <section className="intro" id="overview">
          <div>
            <p className="eyebrow">PRIVATE YIELD ACCOUNT</p>
            <h1>Your capital,<br /><span>off the record.</span></h1>
          </div>
          <p className="intro-copy">Shield assets, put them to work across Starknet, and exit to a fresh address. Your wallet never appears beside your positions.</p>
        </section>

        <section className="balance-panel">
          <div className="balance-head">
            <div>
              <div className="label-row"><span>SHIELDED BALANCE</span><button className="icon-button small" onClick={() => setHideBalance(!hideBalance)} aria-label={hideBalance ? "Show balance" : "Hide balance"}>{hideBalance ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
              <div className="hero-balance">{display(formatMoney(balance))}</div>
              <div className="balance-gain"><span>+$1,842.60</span><span>+7.89%</span><span className="muted">past 30 days</span></div>
            </div>
            <div className="balance-actions">
              <button className="button primary" onClick={() => setModal("deposit")}><ArrowDownLeft size={18} />Deposit</button>
              <button className="button secondary" onClick={() => setModal("withdraw")}><ArrowUpRight size={18} />Withdraw</button>
              <button className="icon-button bordered" onClick={refreshBalance} aria-label="Refresh shielded balance" disabled={busy}><RefreshCw size={18} className={busy ? "spin" : ""} /></button>
            </div>
          </div>
          <BalanceChart hidden={hideBalance} />
          <div className="metrics-row">
            <div><span>NET APY</span><strong>{netApy}%</strong><small>Across all positions</small></div>
            <div><span>PROJECTED / YEAR</span><strong>{display(formatMoney(annualYield))}</strong><small>At current rates</small></div>
            <div><span>PRIVACY SET</span><strong>4,821</strong><small>Active shielded notes</small></div>
            <div><span>ACCOUNT STATUS</span><strong className="status-strong"><i />Protected</strong><small>STRK20 pool</small></div>
          </div>
        </section>

        <section className="section" id="positions">
          <div className="section-head">
            <div><p className="eyebrow">YIELD ALLOCATION</p><h2>Capital at work</h2></div>
            <button className="button text-button" onClick={() => setModal("allocate")}><Settings size={17} />Manage allocation</button>
          </div>
          <div className="allocation-layout">
            <div className="allocation-list">
              {strategies.map((strategy) => (
                <article className="position-row" key={strategy.id}>
                  <div className="position-name"><ProtocolMark strategy={strategy} /><div><strong>{strategy.protocol}</strong><span>{strategy.name}</span></div></div>
                  <div className="position-stat"><span>ASSET</span><strong>{strategy.asset}</strong></div>
                  <div className="position-stat"><span>APY</span><strong className="apy">{strategy.apy ? `${strategy.apy}%` : "—"}</strong></div>
                  <div className="position-stat"><span>ALLOCATED</span><strong>{strategy.allocation}%</strong></div>
                  <div className="position-value"><strong>{display(formatMoney(strategy.balance))}</strong><span>{strategy.risk} risk</span></div>
                </article>
              ))}
            </div>
            <aside className="allocation-summary">
              <div className="donut" style={{ background: `conic-gradient(#d7ff43 0 42%, #73dfc4 42% 70%, #f5a65b 70% 88%, #d5d9d1 88%)` }}><div><strong>4</strong><span>routes</span></div></div>
              <div className="legend">{strategies.map((strategy) => <div key={strategy.id}><i style={{ background: strategy.color }} /><span>{strategy.protocol}</span><strong>{strategy.allocation}%</strong></div>)}</div>
              <div className="routing-note"><Fingerprint size={19} /><p><strong>Identity-blind routing</strong><span>Protocols see the STRK20 helper, never your wallet.</span></p></div>
            </aside>
          </div>
        </section>

        <section className="lower-grid">
          <div className="section activity-section" id="activity">
            <div className="section-head compact"><div><p className="eyebrow">PRIVATE LEDGER</p><h2>Recent activity</h2></div><button className="icon-button bordered" aria-label="Activity options"><ChevronDown size={18} /></button></div>
            <div className="activity-list">
              {activity.map((item) => (
                <div className="activity-row" key={item.id}>
                  <span className={`activity-icon ${item.type.toLowerCase()}`}>{item.type === "Deposit" ? <ArrowDownLeft /> : item.type === "Withdraw" ? <ArrowUpRight /> : item.type === "Yield" ? <Leaf /> : <RefreshCw />}</span>
                  <div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span></div>
                  <span className="activity-time">{item.time}</span>
                  <div className="activity-amount"><strong>{display(item.amount)}</strong><span>{item.status}</span></div>
                </div>
              ))}
            </div>
          </div>
          <aside className="privacy-card">
            <div className="privacy-card-top"><span className="shield-orbit"><LockKeyhole /></span><span className="privacy-live"><i />LIVE</span></div>
            <p className="eyebrow">PRIVACY POSTURE</p>
            <h2>No public portfolio.</h2>
            <p>Your shielded notes hide balances and ownership. DeFi routes expose helper activity, not your connected wallet.</p>
            <div className="privacy-checks"><span><Check />Holdings encrypted</span><span><Check />Positions unlinkable</span><span><Check />Fresh exits supported</span></div>
            <button onClick={() => setModal("privacy")}>View privacy model <ArrowUpRight size={16} /></button>
          </aside>
        </section>
      </main>

      <footer><Logo /><p>Private by default. Disclosable when required.</p><div><a href="https://strk20-by-example.org/what-is-strk20" target="_blank" rel="noreferrer">STRK20 docs</a><a href="https://github.com/starkware-libs/starknet-privacy" target="_blank" rel="noreferrer">Protocol</a><span>Hackathon build</span></div></footer>

      {modal === "wallet" && <ModalShell title="Connect Starknet" eyebrow="LIVE WALLET" onClose={() => setModal(null)}>
        <p className="modal-copy">Sotto asks your wallet to manage viewing keys, discover notes and generate proofs. This app never receives your viewing key.</p>
        {wallet.address ? <div className="connected-wallet"><span><Check /></span><div><strong>{wallet.address.slice(0, 12)}…{wallet.address.slice(-8)}</strong><small>Connected to Starknet</small></div><button onClick={() => { wallet.disconnect(); setModal(null); }}>Disconnect</button></div> :
          <div className="wallet-list">{wallet.wallets.length ? wallet.wallets.map((item) => <button key={item.name} disabled={wallet.connecting} onClick={() => wallet.connect(item)}><img src={item.icon} alt="" /><span><strong>{item.name}</strong><small>Starknet Wallet API</small></span><ArrowUpRight /></button>) : <div className="empty-state"><Wallet /><strong>No Starknet wallet detected</strong><span>Install Ready or Xverse to use live STRK20 actions. The interface remains available in demo mode.</span></div>}</div>}
        {wallet.error && <p className="form-error">{wallet.error}</p>}
      </ModalShell>}

      {modal === "deposit" && <ModalShell title="Deposit privately" eyebrow="SHIELD ASSETS" onClose={() => setModal(null)}>
        <div className="privacy-callout"><ShieldCheck /><p><strong>The entry edge is public</strong><span>Your source deposit and amount are visible. The resulting note is encrypted inside STRK20.</span></p></div>
        <label className="field"><span>Source chain</span><div className="chain-grid">{chains.map((chain) => <button className={selectedChain.id === chain.id ? "selected" : ""} onClick={() => setSelectedChain(chain)} key={chain.id}><i style={{ background: chain.color }}>{chain.symbol}</i>{chain.name}{selectedChain.id === chain.id && <Check />}</button>)}</div></label>
        <div className="form-row"><label className="field"><span>Asset</span><select value={token} onChange={(event) => setToken(event.target.value as "USDC" | "STRK")}><option>USDC</option><option>STRK</option></select></label><label className="field grow"><span>Amount</span><div className="amount-input"><input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} /><button onClick={() => setAmount("5000")}>MAX</button></div></label></div>
        {selectedChain.id !== "starknet" && <p className="route-line"><Sparkles size={16} />USDC routes through Circle CCTP and the STRK20 privacy bridge.</p>}
        <button className="button primary modal-cta" disabled={busy} onClick={() => runLiveAction("deposit")}>{busy ? "Waiting for wallet…" : wallet.account ? `Shield ${amount || "0"} ${token}` : "Connect wallet to deposit"}</button>
      </ModalShell>}

      {modal === "withdraw" && <ModalShell title="Withdraw to fresh wallet" eyebrow="PRIVATE EXIT" onClose={() => setModal(null)}>
        <div className="privacy-callout"><Fingerprint /><p><strong>Use an unused address</strong><span>Withdrawal recipients and amounts are public. A fresh destination avoids re-linking your Sotto activity to a known wallet.</span></p></div>
        <div className="form-row"><label className="field"><span>Asset</span><select value={token} onChange={(event) => setToken(event.target.value as "USDC" | "STRK")}><option>USDC</option><option>STRK</option></select></label><label className="field grow"><span>Amount</span><div className="amount-input"><input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} /><button onClick={() => setAmount("1000")}>MAX</button></div></label></div>
        <label className="field"><span>Fresh Starknet address</span><div className="address-input"><input placeholder="0x…" value={recipient} onChange={(event) => setRecipient(event.target.value)} /><button aria-label="Paste address" onClick={async () => setRecipient(await navigator.clipboard.readText())}><Copy size={17} /></button></div></label>
        <div className="exit-summary"><span>Estimated network fee<strong>~0.08 STRK</strong></span><span>Privacy proof<strong>Generated in wallet</strong></span></div>
        <button className="button primary modal-cta" disabled={busy} onClick={() => runLiveAction("withdraw")}>{busy ? "Generating proof…" : wallet.account ? "Review withdrawal" : "Connect wallet to withdraw"}</button>
      </ModalShell>}

      {modal === "allocate" && <ModalShell title="Manage allocation" eyebrow="YIELD ROUTING" onClose={() => setModal(null)}>
        <p className="modal-copy">Set target weights. Each route is executed as its own STRK20 private invoke because the protocol permits one external invoke per pool transaction.</p>
        <div className="allocation-form">{strategies.map((strategy, index) => <label key={strategy.id}><span><ProtocolMark strategy={strategy} /><span><strong>{strategy.protocol}</strong><small>{strategy.name} · {strategy.apy}% APY</small></span></span><div><input type="range" min="0" max="100" value={allocations[index]} onChange={(event) => setAllocations(allocations.map((item, itemIndex) => itemIndex === index ? Number(event.target.value) : item))} /><output>{allocations[index]}%</output></div></label>)}</div>
        <div className={`allocation-total ${allocationTotal === 100 ? "valid" : "invalid"}`}><span>Target total</span><strong>{allocationTotal}%</strong></div>
        <button className="button primary modal-cta" disabled={allocationTotal !== 100} onClick={() => { setModal(null); notify({ title: "Targets saved in demo", detail: "Deploy each protocol anonymizer before enabling live rebalance transactions.", type: "ok" }); }}>Save targets</button>
      </ModalShell>}

      {modal === "privacy" && <ModalShell title="What Sotto protects" eyebrow="PRIVACY MODEL" onClose={() => setModal(null)}>
        <div className="privacy-model"><div><span className="privacy-number">01</span><p><strong>Inside the pool</strong><span>Sender, receiver, token, amount and spent notes are encrypted. Your wallet owns the viewing key.</span></p></div><div><span className="privacy-number">02</span><p><strong>Across DeFi</strong><span>Anonymizer helpers break the wallet link. The protocol action and open-note amount can remain visible.</span></p></div><div><span className="privacy-number">03</span><p><strong>At the edges</strong><span>Deposits, withdrawals, amounts and timing are public. Fresh withdrawal addresses reduce linkage.</span></p></div><div><span className="privacy-number">04</span><p><strong>Selective disclosure</strong><span>Registration escrows an encrypted viewing key to the protocol auditor. It cannot authorize spending.</span></p></div></div>
        <a className="button secondary modal-cta" href="https://strk20-by-example.org/compliance" target="_blank" rel="noreferrer">Read protocol details <ArrowUpRight size={17} /></a>
      </ModalShell>}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === "ok" ? <Check /> : <CircleHelp />}</span><p><strong>{toast.title}</strong><small>{toast.detail}</small></p><button onClick={() => setToast(null)}><X /></button></div>}
    </div>
  );
}

export default App;
