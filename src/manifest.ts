/**
 * Deployment manifest loader.
 *
 * A single source of truth for the pool, tokens, vaults, and helper class per network — versioned
 * as `config/mainnet.json` and `config/sepolia.json`, imported statically here so Vite bundles the
 * exact JSON into the build and there is nothing to drift between environments.
 *
 * ## Design notes
 *
 * - **Static import, not runtime fetch.** A network's manifest is fully known at build time. Any
 *   inconsistency (missing field, unknown network) is a compile error, not a runtime pop-up.
 * - **Env vars still take precedence for the helper address.** The helper is deployed per network
 *   and its Mainnet address is set at deploy time — carrying that in JSON would either invite a
 *   stale value or force a rebuild for every redeploy. The manifest records the *expected* helper
 *   address for verification; the env var supplies the *actual* one for this build.
 * - **The verify script reads the same JSON.** `scripts/mainnet-verify-addresses.mjs` consumes
 *   `config/mainnet.json` directly, so the frontend and the pre-deploy check cannot disagree.
 */

import mainnetManifest from "../config/mainnet.json";
import sepoliaManifest from "../config/sepolia.json";

export type ManifestVaultKind = "lend" | "stake" | "reactor";

export type ManifestVault = {
  protocol: string;
  label: string;
  kind: ManifestVaultKind;
  underlying: string;
  vTokenAddress: string;
  vTokenDecimals: number;
  verifiedOn: string;
};

export type ManifestToken = {
  address: string;
  decimals: number;
  verifiedOn: string;
  note?: string;
};

export type Manifest = {
  network: { name: string; chainId: string; explorer: string };
  pool: { address: string; class: string; verifiedOn: string };
  tokens: Record<string, ManifestToken>;
  vaults: ManifestVault[];
  helper: { class: string; contract: string; deployedOn: string; note?: string };
};

const MANIFESTS: Record<string, Manifest> = {
  mainnet: mainnetManifest as Manifest,
  sepolia: sepoliaManifest as Manifest,
};

/** Returns the manifest for the configured network, or the mainnet default. */
export function loadManifest(network: string): Manifest {
  return MANIFESTS[network] ?? MANIFESTS.mainnet;
}
