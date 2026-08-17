import type { WALLET_API } from "@starknet-io/types-js";
import type { WalletAccountV6 } from "starknet";
import { num } from "starknet";

export const TOKENS = {
  STRK: {
    address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    decimals: 18,
  },
  USDC: {
    address: "0x053c91253bc9682c04929ca02adb0bb3e4230cc62b3d7d5e0d083a16e7d1103a",
    decimals: 6,
  },
} as const;

export function toBaseUnits(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Enter a valid amount.");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimals.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

export async function shield(
  wallet: WalletAccountV6,
  token: keyof typeof TOKENS,
  amount: string,
) {
  const config = TOKENS[token];
  const actions: WALLET_API.STRK20_ACTION[] = [
    { type: "deposit", token: config.address, amount: num.toHex(toBaseUnits(amount, config.decimals)) },
  ];
  return wallet.strk20InvokeTransaction(actions);
}

export async function withdraw(
  wallet: WalletAccountV6,
  token: keyof typeof TOKENS,
  amount: string,
  recipient: string,
) {
  const config = TOKENS[token];
  const actions: WALLET_API.STRK20_ACTION[] = [
    {
      type: "withdraw",
      token: config.address,
      amount: num.toHex(toBaseUnits(amount, config.decimals)),
      recipient,
    },
  ];
  return wallet.strk20InvokeTransaction(actions);
}

export async function getShieldedBalances(wallet: WalletAccountV6) {
  return wallet.strk20Balances([]);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
