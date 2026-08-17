#!/usr/bin/env node
// Reports whether a Starknet account has registered a viewing key with the STRK20 privacy pool.
//
// Registration is the one-time on-chain step that enables private note delivery. It is owned by the
// wallet — the Wallet API exposes only strk20Balances / strk20PrepareInvoke / strk20InvokeTransaction,
// with no method a dapp can call — so when every action returns NOT_REGISTERED this script tells you
// whether the account is actually unregistered, and on which networks.
//
// Usage: node scripts/check-registration.mjs 0x<account address>
//
// Method validated on Mainnet 2026-08-17. The pool emits `ViewingKeySet` on registration with the
// user address and viewing public key as indexed keys; for every sampled event,
// `get_public_key(user)` returns exactly that public key, and unregistered accounts return 0.
//
// Do NOT validate this by sampling `sender_address` from pool transactions. The pool is itself an
// account contract (`__execute__` / `__validate__`) driven by outside execution, so the transaction
// sender is usually a relayer rather than the pool user, and relayers are correctly unregistered.

import { RpcProvider, num } from "starknet";

const NETWORKS = [
  {
    name: "Sepolia",
    url: process.env.VITE_STARKNET_SEPOLIA_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia",
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  },
  {
    name: "Mainnet",
    url: process.env.VITE_STARKNET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  },
];

const address = process.argv[2];
if (!address || !/^0x[0-9a-fA-F]+$/.test(address)) {
  console.error("Usage: node scripts/check-registration.mjs 0x<account address>");
  process.exit(2);
}

let anyRegistered = false;

for (const network of NETWORKS) {
  const provider = new RpcProvider({ nodeUrl: network.url });
  process.stdout.write(`${network.name.padEnd(8)} `);
  try {
    const [publicKey] = await provider.callContract({
      contractAddress: network.pool,
      entrypoint: "get_public_key",
      calldata: [address],
    });
    const key = num.toBigInt(publicKey);
    if (key === 0n) {
      console.log("NOT REGISTERED  (no viewing key stored for this account)");
    } else {
      anyRegistered = true;
      console.log(`REGISTERED      viewing public key ${num.toHex(key).slice(0, 18)}…`);
    }
  } catch (error) {
    console.log(`QUERY FAILED    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(
  anyRegistered
    ? "\nAt least one network is registered. If an action still fails there, the cause is not registration."
    : "\nNo registration on either network. Activate shielding in your wallet — a dapp cannot do this for you.",
);
