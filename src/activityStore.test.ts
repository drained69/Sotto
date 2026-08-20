import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activityKey, loadActivity, saveActivity, type StoredActivity } from "./activityStore.ts";

describe("activity persistence", () => {
  it("scopes history by account and network", () => {
    assert.notEqual(activityKey("0xabc", "SN_MAIN"), activityKey("0xdef", "SN_MAIN"));
    assert.notEqual(activityKey("0xabc", "SN_MAIN"), activityKey("0xabc", "SN_SEPOLIA"));
  });

  it("round-trips submitted transaction records", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const item: StoredActivity = {
      hash: "0x123",
      label: "Shield 10 STRK",
      category: "Deposit",
      status: "Confirmed",
      createdAt: "2026-08-19T12:00:00.000Z",
      amount: "10 STRK",
    };
    saveActivity(storage, "activity", [item]);
    assert.deepEqual(loadActivity(storage, "activity"), [item]);
  });

  it("drops malformed stored entries", () => {
    const storage = { getItem: () => JSON.stringify([{ hash: "0x123" }, null, "bad"]) };
    assert.deepEqual(loadActivity(storage, "activity"), []);
  });
});
