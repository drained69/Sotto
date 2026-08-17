/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STARKNET_RPC_URL?: string;
  readonly VITE_VESU_HELPER_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
