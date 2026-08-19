import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bridgeRouteFor } from "./bridges.ts";

const STARKNET_ADDRESS = "0x07dCCBC0b46B5CFa95F5F9164B2672dC9408d38785216c6D62319ECC682c5109";

describe("Cross-chain bridge routing", () => {
  it("prefills the destination address and locks it", () => {
    const route = bridgeRouteFor({
      sourceChainId: "base",
      sourceChainName: "Base",
      destinationAddress: STARKNET_ADDRESS,
      asset: "USDC",
      amount: "100",
    });
    assert.ok(route, "expected a route for Base → Starknet");
    const url = new URL(route.url);
    assert.equal(url.searchParams.get("from"), "BASE_MAINNET");
    assert.equal(url.searchParams.get("to"), "STARKNET_MAINNET");
    assert.equal(url.searchParams.get("asset"), "USDC");
    assert.equal(url.searchParams.get("destAddress"), STARKNET_ADDRESS);
    // The address MUST be locked — otherwise a distracted user could redirect funds to a wallet
    // that is not registered with STRK20, which would strand the deposit.
    assert.equal(url.searchParams.get("lockAddress"), "true");
    assert.equal(url.searchParams.get("amount"), "100");
    assert.equal(url.searchParams.get("lockAmount"), "true");
  });

  it("omits amount lock when amount is empty or zero", () => {
    for (const amount of ["", "0"]) {
      const route = bridgeRouteFor({
        sourceChainId: "ethereum",
        sourceChainName: "Ethereum",
        destinationAddress: STARKNET_ADDRESS,
        asset: "USDC",
        amount,
      });
      assert.ok(route);
      const url = new URL(route.url);
      assert.equal(url.searchParams.get("amount"), null, amount);
      assert.equal(url.searchParams.get("lockAmount"), null, amount);
    }
  });

  it("returns undefined for chains without a Starknet route", () => {
    assert.equal(
      bridgeRouteFor({
        sourceChainId: "solana",
        sourceChainName: "Solana",
        destinationAddress: STARKNET_ADDRESS,
        asset: "USDC",
      }),
      undefined,
    );
  });

  it("refuses to build a route without a valid destination", () => {
    assert.equal(
      bridgeRouteFor({
        sourceChainId: "base",
        sourceChainName: "Base",
        destinationAddress: "",
        asset: "USDC",
      }),
      undefined,
    );
    assert.equal(
      bridgeRouteFor({
        sourceChainId: "base",
        sourceChainName: "Base",
        destinationAddress: "not-an-address",
        asset: "USDC",
      }),
      undefined,
    );
  });
});
