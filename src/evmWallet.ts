/**
 * Minimal EVM wallet integration for Sotto's cross-chain deposit flow.
 *
 * Scope is deliberately tight: connect an EIP-1193 wallet, force it onto Base or Arbitrum,
 * sign one ERC-20 transfer. That's the whole surface. No signing of arbitrary calldata, no
 * approve flows (approve is not used; direct transfer only, so no infinite-allowance risk),
 * no session persistence beyond the connection itself.
 *
 * ## Why not wagmi/RainbowKit
 *
 * Both are excellent for a general-purpose dapp with many EVM contracts, dozens of chains, and
 * connector variety. Sotto's cross-chain deposit needs *two* chains, *one* contract (USDC), and
 * *one* operation (transfer). Pulling in ~250KB of dependencies to encode a single ERC-20
 * transfer is out of proportion to the task. viem alone gives us the safe primitives.
 */

import { encodeFunctionData, erc20Abi, getAddress, hexToBigInt, numberToHex, parseAbi } from "viem";

export const EVM_CHAINS = {
  BASE_MAINNET: {
    id: 8453,
    name: "Base",
    hexChainId: "0x2105",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  ARBITRUM_MAINNET: {
    id: 42161,
    name: "Arbitrum One",
    hexChainId: "0xa4b1",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
} as const;
export type EvmChainId = keyof typeof EVM_CHAINS;

export const EIP1193_ERROR = {
  USER_REJECTED: 4001,
  UNRECOGNISED_CHAIN: 4902,
} as const;

/**
 * The subset of the EIP-1193 provider surface Sotto touches. Keeping the type narrow means the
 * compiler catches accidental use of methods (like arbitrary signing) that this feature does not
 * need.
 */
type Eip1193Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
};

function provider(): Eip1193Provider {
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!injected) {
    throw new Error(
      "No EVM wallet detected. Install MetaMask, Rabby, or Rainbow to bridge from Base or Arbitrum.",
    );
  }
  return injected;
}

/**
 * Requests the wallet's accounts. Triggers the connect prompt on first use, returns cached
 * accounts silently thereafter.
 */
export async function requestAccounts(): Promise<`0x${string}`> {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
  if (!Array.isArray(accounts) || !accounts[0]) throw new Error("Wallet did not return an account");
  return getAddress(accounts[0]);
}

/** Reads the connected chain id — the number the app cares about, not the raw hex. */
export async function currentChainId(): Promise<number> {
  const hex = (await provider().request({ method: "eth_chainId" })) as string;
  return Number(hexToBigInt(hex as `0x${string}`));
}

/**
 * Ensures the wallet is on the requested chain, prompting a switch if not — and adding the chain
 * to the wallet first if it's unknown. This is where a wrong-chain send would be catastrophic
 * (funds sent on Ethereum to a Base deposit address vanish), so callers must await this before
 * signing any transfer.
 */
export async function ensureChain(chain: EvmChainId): Promise<void> {
  const spec = EVM_CHAINS[chain];
  const active = await currentChainId();
  if (active === spec.id) return;
  try {
    await provider().request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: spec.hexChainId }],
    });
  } catch (error) {
    const err = error as { code?: number };
    if (err.code === EIP1193_ERROR.UNRECOGNISED_CHAIN) {
      // Wallet doesn't know this chain yet — add it, then it should switch automatically.
      await provider().request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: spec.hexChainId,
            chainName: spec.name,
            nativeCurrency: spec.nativeCurrency,
            rpcUrls: [spec.rpc],
            blockExplorerUrls: [spec.explorer],
          },
        ],
      });
    } else {
      throw error;
    }
  }
  // Verify the switch actually took — some wallets reject silently. Guard against that.
  const after = await currentChainId();
  if (after !== spec.id) {
    throw new Error(`Wallet is on chain ${after}, expected ${spec.id} (${spec.name})`);
  }
}

/** ERC-20 read helpers via a public JSON-RPC (no wallet prompt). */
async function ethCall(chain: EvmChainId, to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> {
  const response = await fetch(EVM_CHAINS[chain].rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const body = (await response.json()) as { result?: `0x${string}`; error?: { message: string } };
  if (body.error) throw new Error(`RPC error: ${body.error.message}`);
  if (!body.result) throw new Error("RPC returned no result");
  return body.result;
}

/**
 * Reads a raw ERC-20 balance. Used to show the user how much they can bridge before they sign.
 * No wallet prompt — the read goes to the public RPC directly.
 */
export async function tokenBalance(
  chain: EvmChainId,
  token: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [account],
  });
  const result = await ethCall(chain, token, data);
  return hexToBigInt(result);
}

/**
 * Signs and broadcasts a single ERC-20 transfer. This is the money-moving call.
 *
 * Every parameter is validated first — a bad `to` address, a bad `amount`, or a wallet on the
 * wrong chain must all fail before the wallet prompt opens. Getting this wrong sends funds to a
 * dead address or a different chain than intended.
 */
export async function sendErc20Transfer(input: {
  chain: EvmChainId;
  token: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
}): Promise<`0x${string}`> {
  if (input.amount <= 0n) throw new Error("Transfer amount must be positive");
  await ensureChain(input.chain);
  // Re-read after ensureChain — a wallet lock or a chain flip mid-flight would put us on the
  // wrong network. This guards against a TOCTOU where the user switches away between the check
  // and the send.
  const chainId = await currentChainId();
  if (chainId !== EVM_CHAINS[input.chain].id) {
    throw new Error(`Wallet chain changed mid-flow (${chainId}); refusing to send`);
  }
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(input.to), input.amount],
  });
  const txHash = (await provider().request({
    method: "eth_sendTransaction",
    params: [
      {
        from: getAddress(input.from),
        to: getAddress(input.token),
        data,
        value: numberToHex(0n),
      },
    ],
  })) as `0x${string}`;
  return txHash;
}
