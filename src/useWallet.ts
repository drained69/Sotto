import { useEffect, useState } from "react";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { RpcProvider, WalletAccountV6, walletV6 } from "starknet";

const RPC_URL = import.meta.env.VITE_STARKNET_RPC_URL ?? "https://starknet-mainnet.public.blastapi.io/rpc/v0_8";

export type WalletState = {
  account?: WalletAccountV6;
  address: string;
  chainId: string;
  wallets: WalletWithStarknetFeatures[];
  connecting: boolean;
  error: string;
};

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: "",
    chainId: "",
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
      const provider = new RpcProvider({ nodeUrl: RPC_URL });
      const account = await WalletAccountV6.connect(provider, wallet);
      const accounts = await walletV6.requestAccounts(wallet);
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error("The wallet did not return an account.");
      const chainId = (await walletV6.requestChainId(wallet)) as string;
      setState((current) => ({
        ...current,
        account,
        address: accounts[0],
        chainId,
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
    setState((current) => ({ ...current, account: undefined, address: "", chainId: "", error: "" }));
  }

  return { ...state, connect, disconnect };
}
