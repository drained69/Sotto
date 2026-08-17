import { useEffect, useRef, useState } from "react";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { constants, RpcProvider, WalletAccountV6, walletV6 } from "starknet";
import { supportsStrk20 } from "./walletGuards";

// Verified 2026-08-17: `https://starknet.drpc.org` answers `starknet_chainId` but returns
// "method does not exist" for `starknet_call`, `starknet_blockNumber`, `starknet_specVersion`
// and `starknet_getTransactionReceipt`. A wallet would connect and then every
// `waitForTransaction` would fail. Lava serves the full method set and is the endpoint
// StarkWare's own STRK20 Day-0 guide points at.
const MAINNET_RPC_URL = import.meta.env.VITE_STARKNET_MAINNET_RPC_URL ?? import.meta.env.VITE_STARKNET_RPC_URL ?? "https://rpc.starknet.lava.build";
const SEPOLIA_RPC_URL = import.meta.env.VITE_STARKNET_SEPOLIA_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia";

/**
 * Which wallet the user last connected, so a page reload can reattach to it.
 *
 * Only the wallet's name is stored. No address, key, or balance is persisted — the address comes
 * back from the wallet itself on reattach, so a stale entry can never make the UI show an account
 * the wallet has since revoked.
 */
const REMEMBERED_WALLET_KEY = "sotto.wallet.name";

function rememberWallet(name: string) {
  try {
    window.localStorage.setItem(REMEMBERED_WALLET_KEY, name);
  } catch {
    // Private-browsing modes reject writes. Losing reattach is acceptable; crashing is not.
  }
}

function forgetWallet() {
  try {
    window.localStorage.removeItem(REMEMBERED_WALLET_KEY);
  } catch {
    // Ignore: see rememberWallet.
  }
}

function rememberedWallet(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED_WALLET_KEY);
  } catch {
    return null;
  }
}

function rpcUrlFor(chainId: string): string | undefined {
  if (chainId === constants.StarknetChainId.SN_MAIN) return MAINNET_RPC_URL;
  if (chainId === constants.StarknetChainId.SN_SEPOLIA) return SEPOLIA_RPC_URL;
  return undefined;
}

export type WalletState = {
  account?: WalletAccountV6;
  address: string;
  chainId: string;
  walletApiVersions: string[];
  /** Why the Wallet API probe failed, when it threw instead of reporting versions. */
  apiProbeError: string;
  strk20Capable: boolean;
  wallets: WalletWithStarknetFeatures[];
  connecting: boolean;
  /** True while a remembered wallet is being reattached after a reload. */
  restoring: boolean;
  error: string;
};

const INITIAL: WalletState = {
  address: "",
  chainId: "",
  walletApiVersions: [],
  apiProbeError: "",
  strk20Capable: false,
  wallets: [],
  connecting: false,
  restoring: false,
  error: "",
};

export function useWallet() {
  const [state, setState] = useState<WalletState>(INITIAL);
  /** The live wallet handle. Kept in a ref because event subscriptions need it, not renders. */
  const connectedWallet = useRef<WalletWithStarknetFeatures | null>(null);
  /** Name of the wallet already reattached this session, so StrictMode cannot run it twice. */
  const restoreAttempted = useRef("");
  /** `address:chainId` currently attached, so silent re-attaches can no-op instead of churning. */
  const attachedIdentity = useRef("");

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    const update = (wallets: readonly WalletWithStarknetFeatures[]) =>
      setState((current) => ({
        ...current,
        wallets: wallets.filter((wallet) => !wallet.name.toLowerCase().includes("metamask")),
      }));
    update(store.getWallets());
    return store.subscribe(update);
  }, []);

  /**
   * Reads the wallet's current account, chain and STRK20 capability into state.
   *
   * Shared by the explicit connect, the reload reattach, and the wallet's own change events, so all
   * three produce identical state and a chain switch rebuilds the provider instead of leaving a
   * connection pointed at the previous network's RPC.
   */
  async function attach(wallet: WalletWithStarknetFeatures, silent: boolean) {
    const accounts = await walletV6.requestAccounts(wallet, silent);
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error("The wallet did not return an account.");
    const chainId = (await walletV6.requestChainId(wallet)) as string;

    // Wallets fire change events for things that do not affect us (focus, lock state, an unrelated
    // setting). Re-attaching on those would mint a fresh account object each time, and anything
    // downstream keyed on it — notably the shielded-balance read, which raises its own approval
    // prompt — would run again. Bail unless the account or chain actually moved.
    const identity = `${accounts[0]}:${chainId}`;
    if (silent && attachedIdentity.current === identity) return;

    const nodeUrl = rpcUrlFor(chainId);
    if (!nodeUrl) throw new Error("Switch the wallet to Starknet Mainnet or Sepolia.");
    const account = await WalletAccountV6.connect(new RpcProvider({ nodeUrl }), wallet);

    // Do not swallow this probe. A `.catch(() => [])` here would make a failed call
    // indistinguishable from "wallet reports no STRK20 support", leaving the user with an
    // unexplained "API unsupported".
    let walletApiVersions: string[] = [];
    let apiProbeError = "";
    try {
      walletApiVersions = (await walletV6.supportedWalletApi(wallet)) ?? [];
    } catch (error) {
      apiProbeError = error instanceof Error ? error.message : String(error);
    }

    connectedWallet.current = wallet;
    attachedIdentity.current = identity;
    setState((current) => ({
      ...current,
      account,
      address: accounts[0],
      chainId,
      walletApiVersions,
      apiProbeError,
      strk20Capable: supportsStrk20(walletApiVersions),
      connecting: false,
      restoring: false,
      error: "",
    }));
  }

  async function connect(wallet: WalletWithStarknetFeatures) {
    setState((current) => ({ ...current, connecting: true, error: "" }));
    try {
      await attach(wallet, false);
      rememberWallet(wallet.name);
    } catch (error) {
      setState((current) => ({
        ...current,
        connecting: false,
        error: error instanceof Error ? error.message : "Wallet connection failed.",
      }));
    }
  }

  // Reattach after a reload.
  //
  // Browser extensions inject asynchronously, so the remembered wallet is usually absent from the
  // first render's discovery list. This deliberately does nothing in that case and runs again when
  // discovery updates, rather than giving up on the first miss.
  //
  // `requestAccounts` in silent mode is the purpose-built reconnect: an already-authorised wallet
  // returns its accounts with no popup, and one that is not authorised rejects. A prior version
  // gated this behind `getPermissions` and erased the saved wallet whenever that call was
  // unavailable or threw, which is exactly how a working session got lost on refresh. The saved
  // name is now only cleared by an explicit disconnect.
  useEffect(() => {
    if (state.account || state.connecting || state.restoring) return;
    const remembered = rememberedWallet();
    if (!remembered || restoreAttempted.current === remembered) return;
    const wallet = state.wallets.find((candidate) => candidate.name === remembered);
    if (!wallet) return;

    restoreAttempted.current = remembered;
    setState((current) => ({ ...current, restoring: true }));
    void attach(wallet, true).catch(() => {
      // A silent reattach must never surface an error banner: the user did not ask for anything.
      // Keep the remembered name so an explicit connect, or the next reload, can still succeed.
      setState((current) => ({ ...current, restoring: false }));
    });
  }, [state.wallets, state.account, state.connecting, state.restoring]);

  // Follow account and network changes made inside the wallet, so switching either updates the app
  // instead of leaving it bound to the account and RPC captured at connect time.
  useEffect(() => {
    const wallet = connectedWallet.current;
    if (!wallet || !state.address) return;
    let cancelled = false;
    const unsubscribe = walletV6.subscribeWalletEvent(wallet, () => {
      if (cancelled) return;
      void attach(wallet, true).catch(() => {
        // The wallet locked or revoked access. Drop to disconnected rather than showing stale state.
        if (!cancelled) reset();
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [state.address, state.chainId]);

  function reset() {
    connectedWallet.current = null;
    attachedIdentity.current = "";
    setState((current) => ({ ...INITIAL, wallets: current.wallets }));
  }

  function disconnect() {
    // Forget the choice too, otherwise the next reload silently reconnects the wallet the user just
    // dismissed.
    forgetWallet();
    restoreAttempted.current = "";
    reset();
  }

  return {
    ...state,
    networkName:
      state.chainId === constants.StarknetChainId.SN_MAIN
        ? "Mainnet"
        : state.chainId === constants.StarknetChainId.SN_SEPOLIA
          ? "Sepolia"
          : state.chainId
            ? "Unsupported"
            : "Not connected",
    connect,
    disconnect,
  };
}
