import type { WALLET_API } from "@starknet-io/types-js";
import type { WalletAccountV6 } from "starknet";
import { num, validateAndParseAddress } from "starknet";
import { isNotRegistered, isUserRefusal } from "./walletGuards";

export const strk20Network = import.meta.env.VITE_STRK20_NETWORK ?? "mainnet";

export const TOKENS = {
  STRK: {
    address: strk20Network === "sepolia"
      ? import.meta.env.VITE_SEPOLIA_STRK_ADDRESS ?? ""
      : "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    decimals: 18,
  },
  USDC: {
    address: strk20Network === "sepolia"
      ? import.meta.env.VITE_SEPOLIA_USDC_ADDRESS ?? ""
      : "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    decimals: 6,
  },
} as const;

export type TokenSymbol = keyof typeof TOKENS;

export type VesuVault = {
  id: string;
  label: string;
  underlying: TokenSymbol;
  vTokenAddress: string;
  /**
   * vToken share decimals. These do NOT track the underlying: verified on Mainnet 2026-08-17,
   * every Vesu v2 vToken reports 18 even when its asset has 6 (vUSDC shares are 18-decimal over
   * 6-decimal USDC). There is no safe default here — a wrong value misreports balances by 10^12 —
   * so this is required per vault and a vault that omits it is dropped.
   */
  vTokenDecimals: number;
};

type VesuEnv = {
  vaults: Array<Omit<VesuVault, "id" | "vTokenDecimals"> & { id?: string; vTokenDecimals?: number }>;
};

function envAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return validateAndParseAddress(value);
  } catch {
    return undefined;
  }
}

export const vesuHelperAddress = envAddress(import.meta.env.VITE_VESU_LENDING_HELPER_ADDRESS);

export function getVesuVaults(): VesuVault[] {
  if (!vesuHelperAddress || !import.meta.env.VITE_VESU_VAULTS) return [];
  try {
    const config = JSON.parse(import.meta.env.VITE_VESU_VAULTS) as VesuEnv;
    if (!Array.isArray(config.vaults)) return [];
    return config.vaults.flatMap((vault, index) => {
      const vTokenAddress = envAddress(vault.vTokenAddress);
      if (!vTokenAddress || !(vault.underlying in TOKENS) || !vault.label) return [];
      // Fail closed on share decimals: they must be read from the vToken's own `decimals()`
      // and written into config per vault. Inheriting the underlying's decimals is wrong for
      // every Vesu v2 vUSDC (18-decimal shares over a 6-decimal asset).
      if (!Number.isInteger(vault.vTokenDecimals) || vault.vTokenDecimals! < 0 || vault.vTokenDecimals! > 32) return [];
      return [{
        id: vault.id ?? `vesu-${index}`,
        label: vault.label,
        underlying: vault.underlying,
        vTokenAddress,
        vTokenDecimals: vault.vTokenDecimals!,
      }];
    });
  } catch {
    return [];
  }
}

export function toBaseUnits(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Enter a valid amount.");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimals.`);
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (amount === 0n) throw new Error("Enter an amount greater than zero.");
  return amount;
}

function recipientAddress(value: string): string {
  try {
    return validateAndParseAddress(value.trim());
  } catch {
    throw new Error("Enter a valid Starknet recipient address.");
  }
}

export async function shield(
  wallet: WalletAccountV6,
  token: keyof typeof TOKENS,
  amount: string,
) {
  const config = TOKENS[token];
  if (!config.address) throw new Error(`${token} is not configured for ${strk20Network}.`);
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
  if (!config.address) throw new Error(`${token} is not configured for ${strk20Network}.`);
  const actions: WALLET_API.STRK20_ACTION[] = [
    {
      type: "withdraw",
      token: config.address,
      amount: num.toHex(toBaseUnits(amount, config.decimals)),
      recipient: recipientAddress(recipient),
    },
  ];
  return wallet.strk20InvokeTransaction(actions);
}

export async function privateTransfer(
  wallet: WalletAccountV6,
  token: keyof typeof TOKENS,
  amount: string,
  recipient: string,
) {
  const config = TOKENS[token];
  if (!config.address) throw new Error(`${token} is not configured for ${strk20Network}.`);
  const actions: WALLET_API.STRK20_ACTION[] = [
    {
      type: "transfer",
      token: config.address,
      amount: num.toHex(toBaseUnits(amount, config.decimals)),
      recipient: recipientAddress(recipient),
    },
  ];
  return wallet.strk20InvokeTransaction(actions);
}

/**
 * Reads the account's shielded balances.
 *
 * The empty-array form is the wallet-api's "all shielded tokens this wallet holds", and it is the
 * right default: naming specific addresses asks the wallet about tokens it may not shield on this
 * network, and a wallet is free to fail that whole request rather than return zeros. Querying
 * everything also surfaces vToken positions without the vault config having to list them.
 *
 * The explicit list is kept only as a fallback for a wallet that rejects the empty form.
 */
export async function getShieldedBalances(wallet: WalletAccountV6) {
  try {
    return await wallet.strk20Balances([]);
  } catch (error) {
    // Every strk20Balances call raises a wallet approval prompt, so only retry when a different
    // token list could plausibly change the answer. Refusal and missing registration are decisions
    // about the account, not the query — retrying those just stacks a second prompt on the user.
    if (isUserRefusal(error) || isNotRegistered(error)) throw error;
    const tokens = [
      ...Object.values(TOKENS).map((token) => token.address),
      ...getVesuVaults().map((vault) => vault.vTokenAddress),
    ].filter(Boolean);
    if (!tokens.length) throw error;
    return await wallet.strk20Balances(tokens);
  }
}

export function parseShieldedBalances(raw: unknown): Map<string, bigint> {
  const balances = raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : raw;
  if (!Array.isArray(balances)) return new Map();
  return new Map(
    balances.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { token, balance } = entry as { token?: string; balance?: string };
      try {
        return token && balance !== undefined ? [[num.toHex(token).toLowerCase(), num.toBigInt(balance)] as [string, bigint]] : [];
      } catch {
        return [];
      }
    }),
  );
}

export function formatTokenAmount(amount: bigint, decimals: number, digits = 4): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function getTokenSymbol(address: string): string {
  const normalized = num.toHex(address).toLowerCase();
  const known = Object.entries(TOKENS).find(([, token]) => num.toHex(token.address).toLowerCase() === normalized);
  return known?.[0] ?? `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function normalizeAddress(address: string): string {
  return num.toHex(address).toLowerCase();
}

/** `LendingOperation` discriminants, matching the Cairo enum's declaration order. */
const LENDING_DEPOSIT = "0x0";
const LENDING_WITHDRAW = "0x1";

/**
 * Builds the three-action atomic lending sequence the STRK20 pool expects.
 *
 * The order matters and all three legs are required:
 *   1. `withdraw` moves the spent token out of the pool to the anonymizer, funding it. Without
 *      this the anonymizer holds nothing and the vault's `transferFrom` reverts.
 *   2. `transfer` with amount `OPEN` creates the open note that receives the proceeds. Exactly one
 *      open note is created, so the invoke references `${openNoteIds[0]}`.
 *   3. `invoke` calls `privacy_invoke` on the anonymizer, which returns an `OpenNoteDeposit` the
 *      pool applies to that open note.
 *
 * `amount` is serialized as a Cairo `u256`, hence the `low, high` pair.
 */
function buildLendingActions(
  operation: typeof LENDING_DEPOSIT | typeof LENDING_WITHDRAW,
  spendToken: string,
  receiveToken: string,
  rawAmount: string,
  recipient: string,
): WALLET_API.STRK20_ACTION[] {
  return [
    { type: "withdraw", token: spendToken, amount: rawAmount, recipient: vesuHelperAddress! },
    { type: "transfer", token: receiveToken, amount: "OPEN", recipient },
    {
      type: "invoke",
      contract: vesuHelperAddress!,
      calldata: [operation, spendToken, receiveToken, rawAmount, "0x0", "${openNoteIds[0]}"],
    },
  ];
}

/** Spends shielded underlying and returns Vesu vToken shares to a new private note. */
export async function lendToVesu(
  wallet: WalletAccountV6,
  vault: VesuVault,
  amount: string,
  recipient: string,
) {
  if (!vesuHelperAddress) throw new Error("Vesu lending is not configured for this deployment.");
  const underlying = TOKENS[vault.underlying];
  if (!underlying.address) throw new Error(`${vault.underlying} is not configured for ${strk20Network}.`);
  const actions = buildLendingActions(
    LENDING_DEPOSIT,
    underlying.address,
    vault.vTokenAddress,
    num.toHex(toBaseUnits(amount, underlying.decimals)),
    recipient,
  );
  await wallet.strk20PrepareInvoke(actions, true);
  return wallet.strk20InvokeTransaction(actions);
}

/**
 * Redeems shielded Vesu vToken shares back into private underlying.
 *
 * `shares` is a vToken share count, not an underlying amount — the anonymizer calls `redeem`, so
 * the position is exited in full when this is the whole shielded share balance.
 */
export async function unlendFromVesu(
  wallet: WalletAccountV6,
  vault: VesuVault,
  shares: string,
  recipient: string,
) {
  if (!vesuHelperAddress) throw new Error("Vesu lending is not configured for this deployment.");
  const underlying = TOKENS[vault.underlying];
  if (!underlying.address) throw new Error(`${vault.underlying} is not configured for ${strk20Network}.`);
  const actions = buildLendingActions(
    LENDING_WITHDRAW,
    vault.vTokenAddress,
    underlying.address,
    num.toHex(toBaseUnits(shares, vault.vTokenDecimals)),
    recipient,
  );
  await wallet.strk20PrepareInvoke(actions, true);
  return wallet.strk20InvokeTransaction(actions);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
