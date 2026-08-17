# Mainnet Deployment TODO

Only unfinished work is listed here. Completed work and evidence from
2026-08-17 are recorded in `docs/`.

**Current decision: NO-GO for Mainnet.** Do not declare or deploy the helper
on Mainnet, enable the Vesu route, or promote Railway until every item below
is complete.

### Hard blockers — these are missing inputs, not process gates

Three items below cannot be closed by more engineering on this repo:

1. ~~**No compatible Vesu vault is known to exist on Mainnet.**~~ **RESOLVED
   2026-08-17 — this blocker was wrong.** Compatible synchronous vTokens do exist;
   see section 6. They still need the two-person address review before use.
2. **No Mainnet deployer account exists** (section 7). Declaration and deployment
   require a funded account and its signing key.
3. **Sepolia end-to-end has never been executed against a real wallet**
   (section 3). No Wallet API 0.10.3 wallet is available in this environment, so
   shield / transfer / withdraw / lend / redeem remain unproven by a human.

Everything else in this file is work that can proceed in parallel. Items 2 and 3
are the critical path, and only a human can close either.

## 1. Freeze the Release

- [ ] Resolve the remaining contract, dependency, wallet, and deployment
  blockers below.
- [ ] Commit the final source and generated artifacts.
- [ ] Record the exact release commit SHA to be tested and audited.
- [ ] Repeat contract tests, frontend checks, artifact hashes, and security
  review from a clean checkout of that SHA.

Current baseline: `0c3821fa3a6d81cd53ff37f75e32970b6c186378`
plus an uncommitted working tree. See `docs/release.md`.

## 2. Produce Mainnet-Compatible Artifacts

- [ ] Confirm the exact maximum Sierra version Mainnet accepts for DECLARE.
- [x] Install and pin a compiler version accepted by Starknet Mainnet.
      `.tool-versions` pins Scarb/Cairo `2.16.1` (Sierra `1.7.0`) and Starknet
      Foundry `0.63.0`.
- [x] Rebuild and repeat all 20 contract tests with that compiler.
      All 20 passed on 2026-08-17.
- [x] Recompute and archive compatible candidate Sierra/CASM SHA-256 hashes.
      Sierra `b198ab5a6b93e16be05f33ce7383ed0eb07c7e20f1a5178cd34e98799437a857`;
      CASM `ed087cdc82a72d0a3eae7871871abba46daccd875dae8c37ad0c9ee19396fe3b`.
      Repeat after the final release SHA is frozen.
      **Profile note (verified 2026-08-17):** the Sierra hash above is the
      `target/release` artifact. `target/dev` hashes differently
      (`e65e5cc3…`) because it embeds `sierra_program_debug_info`. CASM is
      byte-identical across both profiles, and **both profiles produce the same
      class hash**, so this is a record-keeping ambiguity, not a divergence.
      Declare from `target/release` and state the profile when freezing.
- [x] Recompute the compatible candidate class hash.
      `0x0424a607bd691a277eba542917d6378a5e059db49829d881b19af3eabb3b8ff4`.
      Repeat after the final release SHA is frozen.

The previous Scarb `2.20.0` emitted Sierra `1.9.3`. The repository now pins
Scarb `2.16.1`, which emits Sierra `1.7.0` and is explicitly supported by the
published Mainnet chain-information table.

**Correction (2026-08-17, verified on chain):** the previously recorded
"Mainnet supports through Sierra `1.7.0`" is wrong. The live STRK20 pool class
`0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` reports
`sierra_program` version **`1.8.0`**, so Mainnet demonstrably accepts at least
`1.8.0`. Mainnet is on protocol `0.14.3` (block 13446902).

The ceiling between `1.8.0` and `1.9.3` is still **unconfirmed** - a 400-block
sweep for recent DECLARE transactions found none to sample, so this could not be
settled empirically. Resolve before assuming a rebuild is needed: if Mainnet
accepts `1.9.3`, the newer toolchain may also be usable. The conservative
compatible candidate remains pinned to Sierra `1.7.0`.

## 3. Complete Sepolia End-to-End Testing

- [x] Obtain and independently review Sepolia token, STRK20 pool, and
  synchronous Vesu-compatible vault addresses.
- [x] Configure the Sepolia frontend with those addresses.
- [ ] Test shielding, private transfer, withdrawal, Vesu deposit, and Vesu
  redemption with a supported privacy wallet.
- [x] Confirm a Mainnet wallet is rejected by the Sepolia build.
      Automated `gateLiveWallet` proof only. Live wallet click still required.
- [x] Exercise wallet rejection, dry-run failure, proof failure, transaction
      revert, RPC timeout, and interrupted-session behavior.
      Code-path and unit evidence only. Live wallet prompts still required.
- [ ] Reconcile resulting STRK20 notes and Vesu balances with trusted
  chain/indexer data.

First-reviewer address review and idle helper reconciliation:
`docs/sepolia-addresses.md`, `docs/sepolia-e2e.md`.

Remaining live blocker: no Wallet API 0.10.3 wallet in this environment.
(The "no Vesu vToken whose `asset()` is official STRK or Circle USDC" blocker was
retired on 2026-08-17 — see section 6. That finding was about Mainnet; a Sepolia
equivalent still has to be confirmed separately.)

Existing Sepolia helper evidence:

- Class: `0x01d4a3353a4d7d89f2a8e3e154e3597bdb356158f9e1c8a1c2c3c83fa4742970`
- Contract: `0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297`
- Details: `docs/deployment.md`

## 4. Resolve the Helper Trust Model

- [ ] Decide whether Mainnet accepts the documented permissionless behavior
  or requires caller allowlisting/access control.
- [ ] If access control is required, identify every legitimate STRK20 pool,
  update the constructor/storage/interface, and repeat tests and deployment.
- [ ] Obtain written security acceptance for the fact that tokens sent to the
  helper outside an atomic STRK20 transaction can be consumed by a later
  caller.

See `docs/unsupported-tokens.md` and `docs/audit-scope.md`.

## 5. Independent Security Audit

- [ ] Engage an independent Starknet/Cairo security reviewer.
- [ ] Audit the exact frozen release SHA and pinned `starknet-privacy`
  revision.
- [ ] Include the helper, Vesu ABI assumptions, STRK20 action ordering,
  caller/trust model, reentrancy lock, approvals, frontend configuration, and
  Sepolia evidence in scope.
- [ ] Resolve all Critical/High findings.
- [ ] Document acceptance of remaining lower-severity findings.
- [ ] Have the auditor verify remediations.
- [ ] Retain or publish a signed final report tied to the release SHA.

Audit scope: `docs/audit-scope.md`.

## 6. Verify Mainnet Dependencies

- [x] Obtain the official STRK20 pool address and class hash.
      Pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`,
      class `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`
      (Sierra `1.8.0`). Read from chain 2026-08-17 via `rpc.starknet.lava.build`.
      Still needs a second reviewer per the two-person rule below.
- [ ] Confirm whether STRK20 supports native USDC or requires USDC.e.
      Both canonical addresses verified on chain 2026-08-17 (`decimals` = 6):
      native USDC `0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb`,
      bridged USDC.e `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8`.
      STRK `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
      verified at 18 decimals. **Which of the two USDC tokens the pool accepts is
      still unverified** — `TOKENS.USDC` currently points at native USDC.
- [x] Identify a Vesu vault implementing synchronous
      `deposit(assets, receiver)` and share-denominated
      `redeem(shares, receiver, owner)`.
      **Found 2026-08-17.** The earlier "V2 publishes pools, not vTokens / vaults are
      async ERC-7540" conclusion came from the docs address page. `api.vesu.xyz/markets`
      exposes a `vToken` per market, and the live v2 vToken classes were read from
      chain: each implements `deposit(assets: u256, receiver) -> u256`,
      `redeem(shares: u256, receiver, owner) -> u256`, `withdraw`, `mint`, `asset`,
      `decimals`, with **no `request*` / `claim*` / `pending*` ERC-7540 entrypoints
      at all**. Non-deprecated v2 candidates whose `asset()` is official STRK or
      Circle native USDC:

      | Label | vToken | asset() | share dec | totalAssets |
      | --- | --- | --- | --- | --- |
      | vSTRK Prime | `0x06d6d2bf905dd199c78f2e421521d8473042737be9f47904e7578536c10f279d` | STRK | 18 | ~10,149,227 STRK |
      | vUSDC Prime | `0x00387e8ddbb1ab36ca08874d9abc702ef4872ad600dcf76b7f240b71d7bc4e65` | native USDC | 18 | ~1,473,708 USDC |
      | vUSDC Re7 Core | `0x017891114c00b07317b9102adefbad9fd5de40c5616f094ee09fe2fad67191b1` | native USDC | 18 | ~2,568,217 USDC |

- [x] Verify token and share decimals and accounting behavior.
      Share decimals verified on chain. **Every Vesu v2 vToken reports 18 decimals
      regardless of its asset** — vUSDC shares are 18-decimal over a 6-decimal asset.
      `getVesuVaults()` now rejects any vault config that omits `vTokenDecimals`
      rather than inheriting the underlying's, which would misreport by 10^12.
      Accounting behavior (share price drift, fees, caps) still needs review below.
- [ ] Review ownership, upgradeability, pauses, fees, caps, oracles, curator
  controls, and emergency behavior.
- [ ] Decide the exact token/vault allowlist.
- [ ] Have two reviewers independently verify every production address and
  ABI before adding them to Railway.

The current registry is incomplete, but the vault question is settled: compatible
synchronous vTokens exist and are listed above. What remains for section 6 is
governance review (ownership, upgradeability, pause, fees, caps, oracles, curator
controls) and two-person sign-off on the exact addresses. See
`docs/mainnet-addresses.md`.

## 7. Prepare the Mainnet Deployer

- [ ] Create or import a dedicated hardware-backed or multisig Starknet
  Mainnet deployment account.
- [ ] Store signing and recovery material outside git and all `VITE_`
  variables.
- [ ] Replace the placeholder `sotto-mainnet-deployer` alias with the real
  account in the external accounts file.
- [ ] Fund only reviewed declaration/deployment fees plus a small margin.
- [ ] Independently verify the account address, chain, and balance.
- [ ] Assign recovery and incident-response owners.

## 8. Finalize Mainnet Deployment Inputs

- [ ] Estimate Mainnet declaration and deployment fees using the final
  compatible audited artifacts and funded deployer.
- [ ] Replace all placeholders in the Mainnet commands in
  `docs/deployment.md`.
- [ ] Have a second reviewer verify network, deployer, final class hash,
  empty constructor calldata, and fee limits.
- [ ] Obtain explicit written approval before either Mainnet transaction.

## 9. Deploy and Verify the Contract

Complete only after sections 1-8:

- [ ] Declare the audited class on Starknet Mainnet and wait for finality.
- [ ] Verify the declared class hash and publish the transaction link.
- [ ] Deploy the class with empty constructor calldata and wait for finality.
- [ ] Verify source, class hash, and contract address on an explorer.
- [ ] Run a controlled minimal-value smoke test.
- [ ] Confirm helper balances and unexpected allowances are zero afterward.
- [ ] Reconcile Vesu deposit/redemption outputs exactly.
- [ ] Stop before frontend enablement if any value disagrees.

## 10. Complete Railway Production Setup

- [ ] Create or select the production Railway project.
- [ ] Link this repository with `railway link`.
- [ ] Configure production domain, TLS, deployment permissions, and rollback
  policy.
- [ ] Set reviewed public Mainnet RPC, helper, and vault variables.
- [x] Build a local production preview and inspect its generated bundle.
      Docker build and HTTP/header checks passed 2026-08-17; no source maps,
      secret markers, deployer alias, or retired Blast hosts were found. Hosted
      Railway inspection remains required below.
- [ ] Confirm the hosted Mainnet build rejects a Sepolia wallet.
- [ ] Confirm the Vesu route uses only two-person-verified addresses.
- [ ] Review CSP, dependency loading, source maps, error reporting, and
  security headers on the hosted domain.
- [ ] Obtain explicit approval before production promotion.

Runbook: `docs/railway.md`.

## 11. Complete Frontend and Wallet Validation

- [ ] Visually approve desktop and mobile production layouts.
- [ ] Test connection and Wallet API capability detection with every supported
  privacy-wallet version.
- [ ] Verify each wallet confirmation clearly shows the intended chain,
  token, amount, recipient, helper, vault, and calldata.
- [ ] Decide whether to accept CSP `'unsafe-eval'` required by the current
  wallet dependency or replace/remediate that dependency.
- [ ] Configure production error reporting without exposing private user data.

## 12. Activate Operations

- [x] Replace the non-functional default Mainnet RPC.
      `https://starknet.drpc.org` was the default in `useWallet.ts`, `.env.example`
      and `.env.sepolia`. Verified 2026-08-17: it answers `starknet_chainId` but
      returns "method does not exist" for `starknet_call`, `starknet_blockNumber`,
      `starknet_specVersion` and `starknet_getTransactionReceipt`. A wallet would
      connect and then every `waitForTransaction` in `confirmTransaction` would
      fail. Swapped to `https://rpc.starknet.lava.build`, which serves the full
      method set. This is still a free public endpoint — the paid item below stands.
- [ ] Provision paid monitored Mainnet RPC infrastructure and failover.
- [ ] Configure monitoring/alerts for helper calls, failures, balances, vault
  health, and RPC degradation.
- [ ] Assign named on-call, security, auditor, and public-status contacts.
- [ ] Activate and test the Railway rollback/route-disable procedure.
- [ ] Publish supported wallets, verified addresses, privacy limitations,
  unsupported tokens/vaults, and known economic risks.

Operations draft: `docs/ops.md`.

## 13. Final Go/No-Go

- [ ] Frozen release SHA is independently audited.
- [ ] Mainnet-compatible contract and frontend checks pass from a clean
  checkout.
- [ ] Sepolia end-to-end evidence is complete.
- [ ] Mainnet dependencies have two-person verification.
- [ ] Mainnet deployer and fee limits are reviewed.
- [ ] Monitoring, rollback, incident response, and public communication are
  active.
- [ ] Railway production variables and bundle are reviewed.
- [ ] A named approver authorizes contract broadcast.
- [ ] A named approver authorizes Railway production promotion.

Do not treat local tests, the existing Sepolia deployment, or a successful
frontend build as Mainnet readiness.
