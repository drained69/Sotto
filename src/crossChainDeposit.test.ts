import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isActive, mapLayerswapStatus } from "./crossChainDeposit.ts";

const isTerminal = (s: string) => !isActive(s as never);

describe("Layerswap status mapping (safety-critical)", () => {
  it("keeps user in awaiting_deposit until they actually sign", () => {
    // Before signing, sourceTxHash is null. Bumping this to bridging/arrived prematurely
    // would tell the user their swap is in progress when they haven't paid yet.
    assert.equal(mapLayerswapStatus("user_transfer_pending", null), "awaiting_deposit");
  });

  it("advances to deposit_sent once the user has signed", () => {
    assert.equal(mapLayerswapStatus("user_transfer_pending", "0xabc"), "deposit_sent");
  });

  it("treats ls_transfer_pending and user_payout_pending as bridging", () => {
    assert.equal(mapLayerswapStatus("ls_transfer_pending", "0xabc"), "bridging");
    assert.equal(mapLayerswapStatus("user_payout_pending", "0xabc"), "bridging");
  });

  it("marks completed as arrived (not completed) — completed is reserved for after-shield", () => {
    // The distinction: Layerswap says "completed" when funds hit the destination address.
    // Sotto's product state "completed" means the user has ALSO shielded them. So
    // Layerswap-completed → arrived, then shield → completed.
    assert.equal(mapLayerswapStatus("completed", "0xabc"), "arrived");
  });

  it("maps failure statuses correctly and never as completed", () => {
    for (const s of ["failed", "cancelled", "expired"]) {
      assert.equal(mapLayerswapStatus(s, "0xabc"), "failed", s);
    }
  });

  it("maps refunded distinctly from failed so the UI can say funds are back", () => {
    assert.equal(mapLayerswapStatus("refunded", "0xabc"), "refunded");
  });

  it("treats unknown statuses as bridging, never as terminal success", () => {
    // A future API version might introduce new intermediate states. The safe default is 'still
    // in progress, keep polling' — never 'safe to declare victory'.
    assert.equal(mapLayerswapStatus("some_new_layerswap_state", "0xabc"), "bridging");
    assert.notEqual(mapLayerswapStatus("some_new_layerswap_state", "0xabc"), "arrived");
  });
});

describe("Active-state boundary", () => {
  it("classifies in-flight states as active", () => {
    for (const s of ["quoted", "awaiting_deposit", "deposit_sent", "bridging", "arrived"]) {
      assert.equal(isActive(s), true, s);
    }
  });
  it("classifies terminal states as inactive", () => {
    for (const s of ["completed", "failed", "refunded"]) {
      assert.equal(isTerminal(s), true, s);
    }
  });
});
