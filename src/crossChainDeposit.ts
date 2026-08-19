/**
 * Cross-chain deposit orchestration and persistence.
 *
 * Sotto's bridge flow is a small state machine that lives across the Layerswap API, the source
 * EVM chain, and the destination Starknet chain. If the tab closes mid-flow the user must not
 * lose track of the swap they already initiated — that's the failure mode where funds are
 * "somewhere" and the user has no way to check. This module owns the persistence and lifecycle
 * around that risk.
 *
 * ## State model
 *
 * ```
 *   quoted      → user has a quote, no swap created yet
 *   awaiting_deposit → swap created (id stored), user must sign source-chain transfer
 *   deposit_sent    → user signed, waiting for Layerswap to detect
 *   bridging        → Layerswap is routing to Starknet
 *   arrived         → USDC landed on user's Starknet wallet, ready to shield
 *   completed       → user shielded the arrived funds (terminal, success)
 *   failed          → Layerswap reports failed / cancelled / expired (terminal)
 *   refunded        → Layerswap sent original funds back to the source (terminal)
 * ```
 *
 * The `awaiting_deposit → deposit_sent` transition is the only user action that moves money.
 * Everything after that is passive — poll and wait.
 *
 * ## Persistence
 *
 * Each active swap is stored in `localStorage` under a single key. Only ONE swap can be in
 * flight at a time — attempting to start a second one while one is not-terminal is blocked, to
 * avoid the user losing track of what they sent where. The stored data is enough for the UI to
 * fully reconstruct the state on reload; nothing sensitive (no keys, no viewing keys) is stored.
 */

import type { SourceNetworkId } from "./layerswap";

const STORAGE_KEY = "sotto.crossChain.active";

export type CrossChainState =
  | "quoted"
  | "awaiting_deposit"
  | "deposit_sent"
  | "bridging"
  | "arrived"
  | "completed"
  | "failed"
  | "refunded";

export type ActiveCrossChain = {
  /** Layerswap swap id. Never present in `quoted` state. */
  swapId: string;
  /** The connected Starknet wallet at swap-creation time. Refuse to resume against a different one. */
  destinationAddress: string;
  sourceNetwork: SourceNetworkId;
  /** Human-readable USDC amount requested. The exact base-unit value comes back from Layerswap. */
  requestedAmount: number;
  /** Layerswap's per-swap deposit address on the source chain. Displayed to user for verification. */
  depositAddress: string;
  /** Exact amount in base units the user must send. Rendered into the ERC-20 transfer. */
  depositAmountBaseUnits: string;
  /** Source chain's USDC ERC-20 contract address (from Layerswap, verified against known values). */
  tokenContract: string;
  /** Set once the user signs the source-chain transfer. Missing means they haven't paid yet. */
  sourceTxHash: string | null;
  createdAt: string;
  state: CrossChainState;
  lastPolledAt: string | null;
  /** Layerswap's failure reason, when present. */
  failReason: string | null;
};

/** Non-terminal states — the swap is still moving and must keep being polled. */
export const ACTIVE_STATES: CrossChainState[] = [
  "quoted",
  "awaiting_deposit",
  "deposit_sent",
  "bridging",
  "arrived",
];

export const isActive = (state: CrossChainState): boolean => ACTIVE_STATES.includes(state);

/** Read the currently-persisted swap, or null if none. */
export function loadActive(): ActiveCrossChain | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    // Minimal shape check. A corrupt entry is treated as absent rather than crashing the app.
    const candidate = parsed as ActiveCrossChain;
    if (typeof candidate.swapId !== "string" || typeof candidate.state !== "string") return null;
    return candidate;
  } catch {
    return null;
  }
}

export function saveActive(state: ActiveCrossChain): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private-browsing modes reject writes. Losing persistence is acceptable; crashing is not.
  }
}

export function clearActive(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveActive.
  }
}

/**
 * Maps a Layerswap SwapStatus onto our internal CrossChainState.
 *
 * The mapping is defensive: unknown or novel Layerswap statuses fall into a safe pending
 * bucket rather than being treated as terminal. Treating an unknown status as `completed`
 * would falsely tell the user their funds are safe when Layerswap hasn't yet said so.
 */
export function mapLayerswapStatus(
  status: string,
  sourceTxHash: string | null,
): CrossChainState {
  switch (status) {
    case "user_transfer_pending":
      // Before the user signs, we're waiting on them; after, waiting on Layerswap to detect.
      return sourceTxHash ? "deposit_sent" : "awaiting_deposit";
    case "user_transfer_delayed":
    case "ls_transfer_pending":
    case "user_payout_pending":
      return "bridging";
    case "completed":
      // Layerswap says it's on Starknet; the arrival banner will pick it up from public balances.
      return "arrived";
    case "failed":
    case "cancelled":
    case "expired":
      return "failed";
    case "refunded":
      return "refunded";
    default:
      return "bridging";
  }
}
