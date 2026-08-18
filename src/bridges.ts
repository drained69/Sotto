/**
 * Cross-chain bridge routing to Starknet.
 *
 * Sotto does not custody bridge liquidity or sign source-chain transactions itself — those are
 * problems solved by dedicated infrastructure. What Sotto adds is the atomic *shield-on-arrival*
 * step: after the user's USDC arrives on their Starknet address, one click puts it inside the
 * pool. This module returns the deep-link URL for each source chain, prefilled so the destination
 * address matches the connected Starknet wallet and no re-typing is required.
 *
 * ## Why Layerswap over rolling our own CCTP integration
 *
 * Circle's CCTP V2 supports Starknet natively, so a native flow is technically possible: source
 * chain `depositForBurn` → attestation service (~15 min normal, up to 25 min) → Starknet
 * `receiveMessage`. But it needs an EVM wallet library (wagmi/viem), attestation polling with
 * failure modes, and a Starknet CCTP mint — a serious build. Layerswap wraps that same primitive
 * (CCTP + StarkGate + others) behind one URL, supports every source chain we care about, and
 * places funds at whatever destination address we pass. Sotto's contribution is the shield step
 * on arrival, which is the actual privacy product — not the money-movement plumbing.
 *
 * ## Chain coverage
 *
 * Starknet appears as `STARKNET_MAINNET` in Layerswap's network catalog. Source chains use the
 * same `*_MAINNET` naming. USDC and STRK are both supported as `asset` values.
 */

const LAYERSWAP_ORIGIN = "https://layerswap.io/app";

/** Layerswap network identifiers, per their public network catalog. */
const LAYERSWAP_SOURCE_BY_CHAIN: Record<string, string | undefined> = {
  ethereum: "ETHEREUM_MAINNET",
  base: "BASE_MAINNET",
  arbitrum: "ARBITRUM_MAINNET",
};

const LAYERSWAP_DEST = "STARKNET_MAINNET";

export type BridgeRoute = {
  provider: "Layerswap";
  url: string;
  /** How long the user should reasonably wait before checking for arrival. */
  eta: string;
  /** Human name of the source chain. */
  sourceLabel: string;
};

/**
 * Builds a Layerswap deep-link that lands funds on the user's Starknet address.
 *
 * Returns undefined when the chain is not one Layerswap covers into Starknet, or when the
 * destination is missing — the deposit modal disables the bridge action in both cases.
 */
export function bridgeRouteFor(input: {
  sourceChainId: string;
  sourceChainName: string;
  destinationAddress: string;
  asset: "USDC" | "STRK";
  amount?: string;
}): BridgeRoute | undefined {
  const source = LAYERSWAP_SOURCE_BY_CHAIN[input.sourceChainId];
  if (!source) return undefined;
  if (!input.destinationAddress || !input.destinationAddress.startsWith("0x")) return undefined;
  const params = new URLSearchParams({
    from: source,
    to: LAYERSWAP_DEST,
    asset: input.asset,
    destAddress: input.destinationAddress,
    // Lock the destination so a distracted user cannot silently redirect funds to another address.
    lockAddress: "true",
    lockAsset: "true",
    lockFrom: "true",
    lockTo: "true",
  });
  if (input.amount && Number(input.amount) > 0) {
    params.set("amount", input.amount);
    params.set("lockAmount", "true");
  }
  return {
    provider: "Layerswap",
    url: `${LAYERSWAP_ORIGIN}?${params.toString()}`,
    // Layerswap's own docs quote 3–15 minutes typical for supported routes. Underpromise a little.
    eta: "typically 5–15 minutes",
    sourceLabel: input.sourceChainName,
  };
}
