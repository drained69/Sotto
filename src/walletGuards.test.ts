import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionErrorNotice,
  configuredNetworkLabel,
  gateLiveWallet,
  interruptedSessionState,
  isNotRegistered,
  isUserRefusal,
  revertedTransactionError,
  supportsStrk20,
  transactionStatus,
  walletMatchesConfiguredNetwork,
} from "./walletGuards.ts";

describe("Actionable wallet error messages", () => {
  it("tells an unregistered user how to join the pool", () => {
    const notice = actionErrorNotice({ code: 118, message: "An error occurred (NOT_REGISTERED)" }, "Private transfer failed");
    assert.match(notice.title, /Register/);
    assert.match(notice.detail, /deposit/i);
    // The raw protocol token must not reach the user.
    assert.doesNotMatch(notice.detail, /NOT_REGISTERED/);
  });

  it("distinguishes an empty shielded balance from a missing registration", () => {
    const notice = actionErrorNotice({ code: 119, message: "An error occurred (INSUFFICIENT_PRIVATE_BALANCE)" }, "Private transfer failed");
    assert.match(notice.title, /shielded balance/i);
  });

  it("reports a user rejection without calling it a failure", () => {
    assert.match(actionErrorNotice({ code: 113 }, "Transaction failed").title, /Rejected/);
  });

  it("explains a privacy-leak refusal", () => {
    assert.match(actionErrorNotice({ code: 120 }, "Transaction failed").title, /privacy/i);
  });

  it("falls back to the raw message for unrecognised errors", () => {
    const notice = actionErrorNotice(new Error("rpc timeout"), "Transaction failed");
    assert.equal(notice.title, "Transaction failed");
    assert.equal(notice.detail, "rpc timeout");
  });
});

describe("User refusal detection", () => {
  it("matches the wallet-api refusal code and message", () => {
    assert.equal(isUserRefusal({ code: 113 }), true);
    assert.equal(isUserRefusal({ message: "An error occurred (USER_REFUSED_OP)" }), true);
  });

  it("does not treat other errors as a refusal", () => {
    // Retrying on a false positive here re-opens the wallet prompt the user just dismissed.
    assert.equal(isUserRefusal({ code: 118 }), false);
    assert.equal(isUserRefusal(new Error("rpc timeout")), false);
    assert.equal(isUserRefusal(undefined), false);
  });
});

describe("NOT_REGISTERED detection", () => {
  it("matches the wallet-api error code and message", () => {
    assert.equal(isNotRegistered({ code: 118, message: "An error occurred (NOT_REGISTERED)" }), true);
    assert.equal(isNotRegistered({ code: 118 }), true);
    assert.equal(isNotRegistered({ message: "An error occurred (NOT_REGISTERED)" }), true);
    assert.equal(isNotRegistered(new Error("An error occurred (NOT_REGISTERED)")), true);
  });

  it("does not swallow neighbouring pool errors", () => {
    // 119 sits next to 118 and means something entirely different to the user.
    assert.equal(isNotRegistered({ code: 119, message: "An error occurred (INSUFFICIENT_PRIVATE_BALANCE)" }), false);
    assert.equal(isNotRegistered(new Error("network request failed")), false);
    assert.equal(isNotRegistered(undefined), false);
    assert.equal(isNotRegistered("NOT_REGISTERED"), false);
  });
});

describe("Sepolia deployment wallet gate", () => {
  it("rejects a Mainnet wallet against a Sepolia build", () => {
    const gate = gateLiveWallet({
      hasAccount: true,
      strk20Capable: true,
      networkName: "Mainnet",
      configuredNetwork: "sepolia",
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.title, "Wrong network");
      assert.match(gate.detail, /Sepolia/);
    }
    assert.equal(walletMatchesConfiguredNetwork("Mainnet", "sepolia"), false);
  });

  it("accepts a Sepolia privacy wallet on the Sepolia build", () => {
    const gate = gateLiveWallet({
      hasAccount: true,
      strk20Capable: true,
      networkName: "Sepolia",
      configuredNetwork: "sepolia",
    });
    assert.deepEqual(gate, { ok: true });
  });

  it("rejects an unsupported privacy API even on the right network", () => {
    const gate = gateLiveWallet({
      hasAccount: true,
      strk20Capable: false,
      networkName: "Sepolia",
      configuredNetwork: "sepolia",
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.title, "Unsupported wallet");
  });

  it("opens the wallet modal when nothing is connected", () => {
    const gate = gateLiveWallet({
      hasAccount: false,
      strk20Capable: false,
      networkName: "",
      configuredNetwork: "sepolia",
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.openWalletModal, true);
  });
});

describe("failure and session recovery", () => {
  it("marks a reverted receipt as Reverted and throws a user-facing error", () => {
    assert.equal(transactionStatus(false), "Reverted");
    assert.equal(revertedTransactionError().message, "The Starknet transaction reverted.");
  });

  it("does not invent history after an interrupted session", () => {
    const recovery = interruptedSessionState();
    assert.equal(recovery.activityPersisted, false);
    assert.match(recovery.recovery, /does not reconstruct history/);
  });

  it("labels the configured deployment for operator copy", () => {
    assert.equal(configuredNetworkLabel("sepolia"), "Sepolia");
    assert.equal(configuredNetworkLabel("mainnet"), "Mainnet");
  });
});

describe("STRK20 wallet API detection", () => {
  it("accepts the minimum supported version and anything newer", () => {
    assert.equal(supportsStrk20(["0.10.3"]), true);
    assert.equal(supportsStrk20(["0.10.4"]), true);
    assert.equal(supportsStrk20(["0.11"]), true);
    assert.equal(supportsStrk20(["1.0.0"]), true);
    assert.equal(supportsStrk20(["0.9.0", "0.10.3"]), true);
  });

  it("rejects versions below 0.10.3", () => {
    assert.equal(supportsStrk20(["0.10.2"]), false);
    assert.equal(supportsStrk20(["0.9.9"]), false);
    assert.equal(supportsStrk20([]), false);
  });

  it("does not report a capable wallet as unsupported over formatting", () => {
    // A strict Number() split yields NaN for each of these and silently fails closed,
    // which is what made a working wallet look like it lacked STRK20 support.
    assert.equal(supportsStrk20(["v0.10.3"]), true);
    assert.equal(supportsStrk20(["0.10.3-rc.1"]), true);
    assert.equal(supportsStrk20(["starknet_v0.11.0"]), true);
  });

  it("ignores malformed entries without throwing", () => {
    assert.equal(supportsStrk20(["", "not-a-version"]), false);
    assert.equal(supportsStrk20([undefined as unknown as string]), false);
  });
});
