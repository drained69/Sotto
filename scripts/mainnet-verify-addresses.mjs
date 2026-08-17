#!/usr/bin/env node
/**
 * Re-verify the Mainnet addresses Sotto uses at runtime.
 *
 * This is the machine complement to `docs/mainnet-addresses.md` — before wiring an address into a
 * production build, run this and read the results before pushing. The absence of a `helper` block
 * is deliberate: no Mainnet helper has been declared yet, and this script must not encourage
 * putting a placeholder into production. Add a `helper` entry only after `sncast declare` succeeds
 * on Mainnet and the class hash matches `docs/release.md`.
 */

const RPC = process.env.VITE_STARKNET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build";

const EXPECTED = {
  chainId: "0x534e5f4d41494e",
  strk: {
    address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    symbol: "STRK",
    decimals: 18n,
  },
  usdc: {
    address: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    symbol: "USDC",
    decimals: 6n,
  },
  pool: {
    address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    class: "0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d",
  },
  vaults: [
    {
      label: "vSTRK Prime",
      address: "0x06d6d2bf905dd199c78f2e421521d8473042737be9f47904e7578536c10f279d",
      assetLabel: "STRK",
      assetAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      shareDecimals: 18n,
    },
    {
      label: "vUSDC Prime",
      address: "0x00387e8ddbb1ab36ca08874d9abc702ef4872ad600dcf76b7f240b71d7bc4e65",
      assetLabel: "native USDC",
      assetAddress: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
      // Every Vesu v2 vToken reports 18 regardless of its asset. See docs/mainnet-addresses.md.
      shareDecimals: 18n,
    },
  ],
};

let failures = 0;
const fail = (m) => { failures += 1; console.error(`FAIL  ${m}`); };
const ok = (m) => console.log(`ok    ${m}`);
const normalize = (v) => BigInt(v).toString(16);
const feltToAscii = (v) => {
  const hex = BigInt(v).toString(16);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  return Buffer.from(padded, "hex").toString("utf8").replaceAll("\0", "");
};

/**
 * Decodes an ERC-20 `symbol()` result across the two shapes on Mainnet:
 *   - legacy `felt252`: `[felt]`
 *   - Cairo `ByteArray`: `[data_len, ...data, pending_word, pending_word_len]`
 * Trying a plain felt read on Circle USDC returns empty and silently reports a symbol mismatch.
 */
const decodeSymbol = (result) => {
  if (!result || result.length === 0) return "";
  if (result.length === 1) return feltToAscii(result[0]);
  const dataLen = Number(BigInt(result[0]));
  const words = result.slice(1, 1 + dataLen);
  const pendingWord = result[1 + dataLen];
  return words.map(feltToAscii).join("") + (pendingWord ? feltToAscii(pendingWord) : "");
};

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function classHash(address) {
  return rpc("starknet_getClassHashAt", ["latest", address]);
}

async function call(address, entrypoint, calldata = []) {
  const { hash } = await import("starknet");
  return rpc("starknet_call", [
    {
      contract_address: address,
      entry_point_selector: hash.getSelectorFromName(entrypoint),
      calldata,
    },
    "latest",
  ]);
}

/**
 * Resolves the ABI of a class and returns the set of entry-point names it declares. Used to
 * enforce that every allowlisted vToken is synchronous ERC-4626 — a check by *entry-point
 * presence*, not by name overlap: an ERC-7540 vault would additionally expose `request_deposit`,
 * `request_redeem`, `pending_deposit_request`, and `pending_redeem_request`, and finding any of
 * those means an atomic helper cannot drive the vault in one transaction.
 */
async function classEntryPoints(address) {
  const hash = await classHash(address);
  const cls = await rpc("starknet_getClass", ["latest", hash]);
  const abi = typeof cls.abi === "string" ? JSON.parse(cls.abi) : cls.abi;
  const names = new Set();
  (function walk(items) {
    for (const it of items) {
      if (it?.type === "function") names.add(it.name);
      if (it?.items) walk(it.items);
    }
  })(abi);
  return names;
}

const chainId = await rpc("starknet_chainId", []);
if (chainId !== EXPECTED.chainId) fail(`chain id ${chainId}`);
else ok("chain id SN_MAIN");

const strkSymbol = decodeSymbol(await call(EXPECTED.strk.address, "symbol"));
const usdcSymbol = decodeSymbol(await call(EXPECTED.usdc.address, "symbol"));
const strkDecimals = BigInt((await call(EXPECTED.strk.address, "decimals"))[0]);
const usdcDecimals = BigInt((await call(EXPECTED.usdc.address, "decimals"))[0]);
if (!strkSymbol.includes("STRK")) fail(`STRK symbol ${strkSymbol}`); else ok("STRK symbol");
if (!usdcSymbol.includes("USDC")) fail(`USDC symbol ${usdcSymbol}`); else ok("USDC symbol");
if (strkDecimals !== EXPECTED.strk.decimals) fail(`STRK decimals ${strkDecimals}`); else ok("STRK decimals 18");
if (usdcDecimals !== EXPECTED.usdc.decimals) fail(`USDC decimals ${usdcDecimals}`); else ok("USDC decimals 6");

const poolHash = await classHash(EXPECTED.pool.address);
if (normalize(poolHash) !== normalize(EXPECTED.pool.class)) fail(`pool class ${poolHash}`);
else ok("STRK20 pool class");

const paused = BigInt((await call(EXPECTED.pool.address, "is_paused"))[0]);
if (paused !== 0n) fail(`STRK20 pool paused`); else ok("STRK20 pool not paused");

const fee = BigInt((await call(EXPECTED.pool.address, "get_fee_amount"))[0]);
console.log(`info  STRK20 pool fee ${fee} wei (${(Number(fee) / 1e18).toFixed(4)} STRK)`);

const REQUIRED_ENTRY_POINTS = ["deposit", "redeem", "asset", "decimals", "balance_of"];
const ASYNC_MARKERS = ["request_deposit", "request_redeem", "pending_deposit_request", "pending_redeem_request", "claim_deposit", "claim_redeem"];

for (const v of EXPECTED.vaults) {
  const asset = (await call(v.address, "asset"))[0];
  if (normalize(asset) !== normalize(v.assetAddress)) {
    fail(`${v.label} asset ${asset} != ${v.assetAddress} (${v.assetLabel})`);
  } else {
    ok(`${v.label} asset is ${v.assetLabel}`);
  }

  const decimals = BigInt((await call(v.address, "decimals"))[0]);
  if (decimals !== v.shareDecimals) {
    fail(`${v.label} share decimals ${decimals} != ${v.shareDecimals}`);
  } else {
    ok(`${v.label} share decimals ${decimals}`);
  }

  const entryPoints = await classEntryPoints(v.address);
  for (const ep of REQUIRED_ENTRY_POINTS) {
    if (!entryPoints.has(ep)) fail(`${v.label} missing entrypoint ${ep}`);
    else ok(`${v.label} implements ${ep}`);
  }
  const asyncFound = ASYNC_MARKERS.filter((m) => entryPoints.has(m));
  if (asyncFound.length) {
    fail(`${v.label} exposes ERC-7540 async surface: ${asyncFound.join(", ")}`);
  } else {
    ok(`${v.label} has no ERC-7540 async entrypoints`);
  }
}

if (failures) {
  console.error(`\n${failures} check(s) failed — do not enable Mainnet Vesu route`);
  process.exit(1);
}
console.log("\nMainnet dependency review still matches chain state.");
