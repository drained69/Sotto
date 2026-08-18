/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STARKNET_RPC_URL?: string;
  readonly VITE_VESU_LENDING_HELPER_ADDRESS?: string;
  readonly VITE_YIELD_VAULTS?: string;
  readonly VITE_VESU_VAULTS?: string;
  readonly VITE_STRK20_NETWORK?: "mainnet" | "sepolia";
  readonly VITE_STARKNET_MAINNET_RPC_URL?: string;
  readonly VITE_STARKNET_SEPOLIA_RPC_URL?: string;
  readonly VITE_SEPOLIA_STRK_ADDRESS?: string;
  readonly VITE_SEPOLIA_USDC_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
