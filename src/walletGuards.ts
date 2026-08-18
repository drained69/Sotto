export type WalletGate =
  | { ok: true }
  | { ok: false; title: string; detail: string; openWalletModal?: boolean };

/** First Wallet API revision that carries STRK20. */
export const MIN_STRK20_WALLET_API = "0.10.3";

/** Wallet API error code 118. */
const NOT_REGISTERED_CODE = 118;

/**
 * True when a wallet error means "this account has never registered with the STRK20 pool".
 *
 * Registration is a one-time on-chain step that enables private note delivery, and it is owned by
 * the wallet — the Wallet API exposes only `strk20Balances`, `strk20PrepareInvoke` and
 * `strk20InvokeTransaction`, with no registration method a dapp can call. So this is the expected
 * first-run state for every new user, not a failure, and it must not be reported as one.
 */
/** True when the user declined the wallet prompt (code 113). Never retry these — it re-prompts. */
export function isUserRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 113 || String(code) === "113") return true;
  return typeof message === "string" && message.includes("USER_REFUSED_OP");
}

export function isNotRegistered(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === NOT_REGISTERED_CODE || String(code) === String(NOT_REGISTERED_CODE)) return true;
  return typeof message === "string" && message.includes("NOT_REGISTERED");
}

/**
 * True when any reported Wallet API version is >= 0.10.3.
 *
 * Parsing is deliberately tolerant. Wallets ship prerelease tags (`0.10.3-rc.1`), occasional `v`
 * prefixes, and two-part versions (`0.11`). A strict `Number()` split turns each of those into
 * `NaN`, every comparison against `NaN` is false, and a genuinely capable wallet is then reported
 * as unsupported with no explanation — so the version is extracted by pattern instead.
 */
export function supportsStrk20(versions: readonly string[]): boolean {
  return versions.some((raw) => {
    const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(raw ?? ""));
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3] ?? 0);
    if (major > 0) return true;
    if (minor > 10) return true;
    return minor === 10 && patch >= 3;
  });
}

/**
 * Turns a wallet-api error into an instruction the user can act on.
 *
 * The wallet returns codes like `An error occurred (NOT_REGISTERED)`. Relaying that verbatim tells
 * the user what the protocol called the problem, not what to do about it, so the cases a user can
 * actually resolve are translated here and anything unrecognised falls back to the raw message.
 */
export function actionErrorNotice(error: unknown, fallbackTitle: string): { title: string; detail: string } {
  const code = errorCode(error);
  const message = errorMessage(error);
  const is = (n: number, token: string) => code === n || message.includes(token);

  if (is(118, "NOT_REGISTERED")) {
    return {
      title: "Register with STRK20 first",
      detail: "This account has not joined the privacy pool yet. Shielding a deposit registers your viewing key — activate shielding in your wallet, or run a deposit first, then retry.",
    };
  }
  if (is(119, "INSUFFICIENT_PRIVATE_BALANCE")) {
    return {
      title: "Not enough shielded balance",
      detail: "You are spending more than this account holds inside the pool. Deposit first, or lower the amount.",
    };
  }
  if (is(113, "USER_REFUSED_OP")) {
    return { title: "Rejected in wallet", detail: "You declined the request. Nothing was submitted." };
  }
  if (is(120, "PRIVACY_LEAK")) {
    return {
      title: "Blocked to protect your privacy",
      detail: "The wallet refused this because it would link your identity to the transaction. Change the amount, recipient, or timing and try again.",
    };
  }
  if (is(117, "CHAIN_ID_NOT_SUPPORTED") || is(112, "UNLISTED_NETWORK")) {
    return { title: "Switch network", detail: "Your wallet is on a network this deployment does not serve." };
  }
  if (is(162, "API_VERSION_NOT_SUPPORTED")) {
    return {
      title: "Wallet too old",
      detail: `This wallet does not implement Starknet Wallet API ${MIN_STRK20_WALLET_API} or newer. Update it and reconnect.`,
    };
  }
  if (is(163, "UNKNOWN_ERROR")) {
    // 163 is the wallet's catch-all: it carries no cause, so the only honest thing to do is list
    // the resolvable causes seen in practice. Wallet dry-run failures for insufficient token
    // balance surface here on Mainnet — the wallet cannot compute a proof it cannot fund — and
    // that is the single most common cause for a user who has not yet shielded anything.
    return {
      title: "Wallet could not complete the request",
      detail: "Common causes: (1) not enough of the spent token in this wallet on this network, including the pool fee on top of the amount; (2) shielding not activated for this account; (3) the wallet's privacy service does not cover the connected network. Check your public balance first, then confirm shielding is active in your wallet.",
    };
  }
  return { title: fallbackTitle, detail: message || "Unknown error." };
}

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const raw = (error as { code?: unknown }).code;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const raw = (error as { message?: unknown }).message;
    if (typeof raw === "string") return raw;
  }
  return typeof error === "string" ? error : "";
}

export function configuredNetworkLabel(configuredNetwork: string): "Mainnet" | "Sepolia" {
  return configuredNetwork.toLowerCase() === "sepolia" ? "Sepolia" : "Mainnet";
}

export function walletMatchesConfiguredNetwork(walletNetworkName: string, configuredNetwork: string): boolean {
  return walletNetworkName.toLowerCase() === configuredNetwork.toLowerCase();
}

/** Fail-closed gate used before every STRK20 action. */
export function gateLiveWallet(input: {
  hasAccount: boolean;
  strk20Capable: boolean;
  networkName: string;
  configuredNetwork: string;
}): WalletGate {
  if (!input.hasAccount) {
    return { ok: false, title: "Connect wallet", detail: "", openWalletModal: true };
  }
  if (!input.strk20Capable) {
    return {
      ok: false,
      title: "Unsupported wallet",
      detail: "Use a privacy-enabled wallet implementing Starknet Wallet API 0.10.3 or newer.",
    };
  }
  if (!walletMatchesConfiguredNetwork(input.networkName, input.configuredNetwork)) {
    return {
      ok: false,
      title: "Wrong network",
      detail: `This deployment is configured for Starknet ${configuredNetworkLabel(input.configuredNetwork)}. Switch networks before continuing.`,
    };
  }
  if (input.networkName !== "Mainnet" && input.networkName !== "Sepolia") {
    return {
      ok: false,
      title: "Unsupported network",
      detail: "Switch your Starknet wallet to Mainnet or Sepolia.",
    };
  }
  return { ok: true };
}

export function transactionStatus(succeeded: boolean): "Confirmed" | "Reverted" {
  return succeeded ? "Confirmed" : "Reverted";
}

export function revertedTransactionError(): Error {
  return new Error("The Starknet transaction reverted.");
}

export function interruptedSessionState(): { activityPersisted: false; recovery: string } {
  return {
    activityPersisted: false,
    recovery: "User checks explorer; Sotto does not reconstruct history after a reload.",
  };
}
