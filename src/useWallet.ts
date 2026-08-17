import { useEffect, useState } from "react";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { constants, RpcProvider, WalletAccountV6, walletV6 } from "starknet";

const MAINNET_RPC_URL = import.meta.env.VITE_STARKNET_MAINNET_RPC_URL ?? import.meta.env.VITE_STARKNET_RPC_URL ?? "https://starknet-mainnet.public.blastapi.io/rpc/v0_8";
const SEPOLIA_RPC_URL = import.meta.env.VITE_STARKNET_SEPOLIA_RPC_URL ?? "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";

export type WalletState = {
  account?: WalletAccountV6;
  address: string;
  chainId: string;
  walletApiVersions: string[];
  strk20Capable: boolean;
  wallets: WalletWithStarknetFeatures[];
  connecting: boolean;
  error: string;
};

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: "",
    chainId: "",
    walletApiVersions: [],
    strk20Capable: false,
    wallets: [],
    connecting: false,
    error: "",
  });

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    const update = (wallets: readonly WalletWithStarknetFeatures[]) =>
      setState((current) => ({ ...current, wallets: wallets.filter((wallet) => !wallet.name.toLowerCase().includes("metamask")) }));
    update(store.getWallets());
    return store.subscribe(update);
  }, []);

  async function connect(wallet: WalletWithStarknetFeatures) {
    setState((current) => ({ ...current, connecting: true, error: "" }));
    try {
      const accounts = await walletV6.requestAccounts(wallet);
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error("The wallet did not return an account.");
      const chainId = (await walletV6.requestChainId(wallet)) as string;
      const nodeUrl = chainId === constants.StarknetChainId.SN_MAIN
        ? MAINNET_RPC_URL
        : chainId === constants.StarknetChainId.SN_SEPOLIA
          ? SEPOLIA_RPC_URL
          : undefined;
      if (!nodeUrl) throw new Error("Switch the wallet to Starknet Mainnet or Sepolia.");
      const provider = new RpcProvider({ nodeUrl });
      const account = await WalletAccountV6.connect(provider, wallet);
      const walletApiVersions = await walletV6.supportedWalletApi(wallet).catch(() => []);
      const strk20Capable = walletApiVersions.some((version) => {
        const [major, minor, patch = 0] = version.split(".").map(Number);
        return major > 0 || minor > 10 || (minor === 10 && patch >= 3);
      });
      setState((current) => ({
        ...current,
        account,
        address: accounts[0],
        chainId,
        walletApiVersions,
        strk20Capable,
        connecting: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        connecting: false,
        error: error instanceof Error ? error.message : "Wallet connection failed.",
      }));
    }
  }

  function disconnect() {
    setState((current) => ({ ...current, account: undefined, address: "", chainId: "", walletApiVersions: [], strk20Capable: false, error: "" }));
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
