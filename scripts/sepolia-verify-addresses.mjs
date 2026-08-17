#!/usr/bin/env node
/** Re-verify the independently reviewed Sepolia addresses. */

const RPC = process.env.VITE_STARKNET_SEPOLIA_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia";

const EXPECTED = {
  chainId: "0x534e5f5345504f4c4941",
  strk: {
    address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    class: "0x2e77ee61d4df3d988ee1f42ea5442e913862cc82c2584d212ecda76666498fc",
    symbol: "STRK",
    decimals: 18n,
  },
  usdc: {
    address: "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343",
    class: "0x78a357382d29a07ab7e32c5ce3ffae20021abee67c353b8885737b1d643eac9",
    symbol: "USDC",
    decimals: 6n,
  },
  pool: {
    address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    class: "0x56ab118a8a6e38efc93ad758cefe909fee421fa931ce3cf72df624d345623b2",
    version: "0x322e30",
  },
  helper: {
    address: "0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297",
    class: "0x1d4a3353a4d7d89f2a8e3e154e3597bdb356158f9e1c8a1c2c3c83fa4742970",
  },
  vusdc: {
    address: "0x074655d40dcdf5d0c2d1c508e0d79ca57416dbd51facda53a08f9ec2380cf96d",
    asset: "0x715649d4c493ca350743e43915b88d2e6838b1c78ddc23d6d9385446b9d6844",
  },
  vstrk: {
    address: "0x05c89191eb94efd85fd4d376eef08a491e19d53f4bf10c1ddbdcb6f1a364d908",
    asset: "0x1278f23115f7e8acf07150b17c1f4b2a58257dde88aad535dbafc142edbd289",
  },
};

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL  ${message}`);
}

function ok(message) {
  console.log(`ok    ${message}`);
}

function normalize(value) {
  return BigInt(value).toString(16);
}

function feltToAscii(value) {
  const hex = BigInt(value).toString(16);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  return Buffer.from(padded, "hex").toString("utf8").replaceAll("\0", "");
}

function decodeSymbol(result) {
  if (!Array.isArray(result) || result.length === 0) return "";
  if (result.length >= 3) return feltToAscii(result[1] === "0x0" && result.length > 2 ? result[1] : result[1]) || feltToAscii(result[1]);
  return feltToAscii(result[0]);
}

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

async function expectClass(label, address, expected) {
  const actual = await classHash(address);
  if (normalize(actual) !== normalize(expected)) {
    fail(`${label} class ${actual} != ${expected}`);
  } else {
    ok(`${label} class`);
  }
}

async function expectZero(label, token, owner) {
  const balance = await call(token, "balance_of", [owner]);
  const value = BigInt(balance[0]) + (BigInt(balance[1] ?? 0) << 128n);
  if (value !== 0n) fail(`${label} balance ${value}`);
  else ok(`${label} balance 0`);
}

const chainId = await rpc("starknet_chainId", []);
if (chainId !== EXPECTED.chainId) fail(`chain id ${chainId}`);
else ok("chain id SN_SEPOLIA");

await expectClass("STRK", EXPECTED.strk.address, EXPECTED.strk.class);
await expectClass("USDC", EXPECTED.usdc.address, EXPECTED.usdc.class);
await expectClass("STRK20 pool", EXPECTED.pool.address, EXPECTED.pool.class);
await expectClass("helper", EXPECTED.helper.address, EXPECTED.helper.class);

const strkSymbol = decodeSymbol(await call(EXPECTED.strk.address, "symbol"));
const usdcSymbol = decodeSymbol(await call(EXPECTED.usdc.address, "symbol"));
const strkDecimals = BigInt((await call(EXPECTED.strk.address, "decimals"))[0]);
const usdcDecimals = BigInt((await call(EXPECTED.usdc.address, "decimals"))[0]);
if (!strkSymbol.includes("STRK")) fail(`STRK symbol ${strkSymbol}`);
else ok("STRK symbol");
if (!usdcSymbol.includes("USDC")) fail(`USDC symbol ${usdcSymbol}`);
else ok("USDC symbol");
if (strkDecimals !== EXPECTED.strk.decimals) fail(`STRK decimals ${strkDecimals}`);
else ok("STRK decimals 18");
if (usdcDecimals !== EXPECTED.usdc.decimals) fail(`USDC decimals ${usdcDecimals}`);
else ok("USDC decimals 6");

const version = (await call(EXPECTED.pool.address, "get_version"))[0];
if (normalize(version) !== normalize(EXPECTED.pool.version)) fail(`pool version ${version}`);
else ok("STRK20 pool version 2.0");

const vusdcAsset = (await call(EXPECTED.vusdc.address, "asset"))[0];
const vstrkAsset = (await call(EXPECTED.vstrk.address, "asset"))[0];
if (normalize(vusdcAsset) !== normalize(EXPECTED.vusdc.asset)) fail(`vUSDC asset ${vusdcAsset}`);
else ok("vUSDC asset is Vesu mock USDC, not Circle USDC");
if (normalize(vstrkAsset) !== normalize(EXPECTED.vstrk.asset)) fail(`vSTRK asset ${vstrkAsset}`);
else ok("vSTRK asset is Vesu mock STRK, not official STRK");

for (const [label, token] of [
  ["official STRK", EXPECTED.strk.address],
  ["Circle USDC", EXPECTED.usdc.address],
  ["vUSDC", EXPECTED.vusdc.address],
  ["vSTRK", EXPECTED.vstrk.address],
]) {
  await expectZero(`helper ${label}`, token, EXPECTED.helper.address);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nSepolia address review still matches chain state.");
