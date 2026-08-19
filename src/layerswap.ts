/**
 * Layerswap v2 API client.
 *
 * Sotto uses Layerswap's public liquidity network to route USDC from Base and Arbitrum to a
 * user's Starknet wallet. The user experience is fully inside Sotto; Layerswap is the routing
 * infrastructure under the hood.
 *
 * ## Trust boundary
 *
 * Every deposit address returned by this API is a Layerswap-controlled address on the source
 * chain. If Layerswap's API is compromised or returns a malicious address, funds sent by the
 * user go to the attacker. This is the same trust boundary as the layerswap.io web UI — Sotto
 * does not add or remove risk here, it just presents the same information inline.
 *
 * Mitigations Sotto DOES apply on top:
 *   - The destination address (Starknet) is always the *connected* Starknet wallet's address,
 *     read from the wallet, never user-typed. Layerswap echoes it back in `swap.destination_address`
 *     and Sotto refuses to display or continue with a swap whose destination doesn't match.
 *   - The user must send the EXACT `amount_in_base_units` returned by the API. Sotto passes that
 *     value verbatim into the ERC-20 transfer call — no client-side amount math.
 *   - The user must be on the EXACT source chain (`chain_id` from the swap's source network).
 *     A wrong-chain send would burn funds on the wrong network.
 *   - No ERC-20 approvals. Direct transfer only. Zero infinite-allowance risk.
 *   - The `swap.id` and `destination_address` are persisted to localStorage the moment a swap is
 *     created — before the user signs. A tab close mid-flow can always resume tracking, never
 *     forgets what was in flight.
 *
 * The Layerswap API is public and anonymous — no API key required for the endpoints Sotto uses.
 * All requests go over HTTPS to `https://api.layerswap.io`.
 */

const LAYERSWAP_API = "https://api.layerswap.io";

/** Networks Sotto exposes as source chains. Deliberately narrow — expand only after live testing. */
export const SOURCE_NETWORKS = {
  BASE_MAINNET: { label: "Base", chainId: 8453 },
  ARBITRUM_MAINNET: { label: "Arbitrum", chainId: 42161 },
} as const;
export type SourceNetworkId = keyof typeof SOURCE_NETWORKS;

/** Destination is always Starknet Mainnet in this build. */
const DESTINATION_NETWORK = "STARKNET_MAINNET";
const TOKEN = "USDC";

/** Standard Layerswap API error envelope. */
export type ApiError = { code: string; message: string; metadata?: Record<string, unknown> };

/**
 * Layerswap swap lifecycle. These are the values observed across their production API; unknown
 * strings from a future API version should be treated as an intermediate state and polled again
 * rather than assumed terminal.
 */
export type SwapStatus =
  | "user_transfer_pending" // Waiting for the user to send funds on the source chain
  | "user_transfer_delayed"
  | "ls_transfer_pending" // Layerswap is preparing the destination transfer
  | "user_payout_pending"
  | "completed"            // Terminal: funds delivered to destination
  | "failed"               // Terminal: swap failed, refund flow may apply
  | "expired"              // Terminal: user did not send funds in time
  | "refunded"             // Terminal: original funds returned to source
  | "cancelled"            // Terminal: user cancelled before sending
  | (string & {});

const TERMINAL_STATUSES: SwapStatus[] = ["completed", "failed", "expired", "refunded", "cancelled"];
export const isTerminalStatus = (s: SwapStatus): boolean => TERMINAL_STATUSES.includes(s);
export const isSuccessStatus = (s: SwapStatus): boolean => s === "completed";
export const isFailureStatus = (s: SwapStatus): boolean =>
  s === "failed" || s === "expired" || s === "cancelled";

export type QuoteResponse = {
  quote: {
    total_fee: number;
    total_fee_in_usd: number;
    receive_amount: number;
    min_receive_amount: number;
    source_network: { name: string; chain_id: string | null };
    destination_network: { name: string; chain_id: string | null };
  };
};

export type SwapModel = {
  id: string;
  created_date: string;
  destination_address: string;
  status: SwapStatus;
  fail_reason: string | null;
  use_deposit_address: boolean;
  source_network: { name: string; chain_id: string | null; type: string };
  destination_network: { name: string; chain_id: string | null; type: string };
  source_token: { symbol: string; decimals: number; contract: string | null };
  destination_token: { symbol: string; decimals: number; contract: string | null };
  requested_amount: number;
  transactions: Array<{
    from: string | null;
    to: string | null;
    transaction_hash: string | null;
    confirmations: number;
    max_confirmations: number;
    amount: number;
    type: string;
    status: string;
    network: { name: string };
  }>;
};

/** The single-line "here's exactly what to sign" instruction. */
export type DepositAction = {
  type: "manual_transfer" | "transfer" | string;
  to_address: string;
  amount: number;
  amount_in_base_units: string;
  order: number;
  network: { name: string; chain_id: string | null; type: string };
  token: { symbol: string; decimals: number; contract: string | null };
};

export type CreateSwapResult = {
  swap: SwapModel;
  quote: QuoteResponse["quote"];
  deposit_actions: DepositAction[];
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LAYERSWAP_API}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as { data?: T; error?: ApiError };
  if (!response.ok || body.error) {
    const err = body.error;
    throw new Error(err ? `Layerswap ${err.code}: ${err.message}` : `Layerswap HTTP ${response.status}`);
  }
  if (body.data === undefined) throw new Error("Layerswap returned no data");
  return body.data;
}

/**
 * Fee/receive-amount quote. Cheap — safe to call as the user types. Returns null when the amount
 * is outside Layerswap's min/max for this route so the UI can degrade gracefully rather than
 * flashing an API error on every keystroke.
 */
export async function quote(input: {
  sourceNetwork: SourceNetworkId;
  amount: number;
}): Promise<QuoteResponse | null> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return null;
  const params = new URLSearchParams({
    source_network: input.sourceNetwork,
    source_token: TOKEN,
    destination_network: DESTINATION_NETWORK,
    destination_token: TOKEN,
    amount: String(input.amount),
  });
  try {
    return await apiFetch<QuoteResponse>(`/api/v2/quote?${params.toString()}`);
  } catch {
    return null;
  }
}

/**
 * Reads the min/max USDC amounts Layerswap will accept for this route right now. Both values
 * change over time with liquidity, so re-read before every swap creation.
 */
export async function limits(input: {
  sourceNetwork: SourceNetworkId;
}): Promise<{ min_amount: number; max_amount: number } | null> {
  const params = new URLSearchParams({
    source_network: input.sourceNetwork,
    source_token: TOKEN,
    destination_network: DESTINATION_NETWORK,
    destination_token: TOKEN,
  });
  try {
    return await apiFetch(`/api/v2/limits?${params.toString()}`);
  } catch {
    return null;
  }
}

/**
 * Creates a swap and returns the deposit instruction.
 *
 * Every parameter enforces the safety contract:
 *   - `destinationAddress` MUST be the connected Starknet wallet's address. Layerswap echoes it
 *     back in `swap.destination_address` and this function throws if they don't match.
 *   - `use_deposit_address: true` requests a per-swap ephemeral deposit address rather than an
 *     intent-based flow — that's the pattern we actually want, where the user sends USDC to a
 *     concrete address they can verify.
 *   - `refuel: false` disables Layerswap's optional gas-refuel feature; users on Starknet already
 *     have STRK for fees and gas-refueling would add a token they don't need.
 */
export async function createSwap(input: {
  sourceNetwork: SourceNetworkId;
  destinationAddress: string;
  amount: number;
}): Promise<CreateSwapResult> {
  if (!input.destinationAddress || !input.destinationAddress.startsWith("0x")) {
    throw new Error("createSwap needs the connected Starknet address");
  }
  const body = {
    destination_address: input.destinationAddress,
    source_network: input.sourceNetwork,
    source_token: TOKEN,
    destination_network: DESTINATION_NETWORK,
    destination_token: TOKEN,
    amount: input.amount,
    refuel: false,
    use_deposit_address: true,
  };
  const raw = await apiFetch<{ swap: SwapModel; quote: QuoteResponse["quote"]; deposit_actions: DepositAction[] }>(
    "/api/v2/swaps",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  // Layerswap echoes the destination we sent — verify it wasn't silently changed. A mismatch here
  // means either a Layerswap bug or a MITM; either way we must not present it to the user as
  // legitimate.
  if (raw.swap.destination_address.toLowerCase() !== input.destinationAddress.toLowerCase()) {
    throw new Error("Layerswap returned a swap with a mismatched destination address");
  }

  // The deposit action must be for the source chain we requested. Anything else means we'd be
  // guiding the user to send funds on the wrong network.
  const action = raw.deposit_actions.find((a) => a.network.name === input.sourceNetwork);
  if (!action) {
    throw new Error(`Layerswap did not return a deposit action for ${input.sourceNetwork}`);
  }
  const expectedChainId = String(SOURCE_NETWORKS[input.sourceNetwork].chainId);
  if (action.network.chain_id !== expectedChainId) {
    throw new Error(
      `Layerswap deposit-action chain_id ${action.network.chain_id} does not match expected ${expectedChainId}`,
    );
  }
  if (!action.token.contract) {
    throw new Error("Layerswap deposit action has no ERC-20 contract address");
  }
  if (!action.to_address || !action.to_address.startsWith("0x")) {
    throw new Error("Layerswap deposit action has no valid to_address");
  }

  return raw;
}

/** Polls the current status of a swap. Safe to call repeatedly. */
export async function getSwap(id: string): Promise<CreateSwapResult> {
  return apiFetch(`/api/v2/swaps/${encodeURIComponent(id)}`);
}
