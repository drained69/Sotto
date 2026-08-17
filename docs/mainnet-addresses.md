# Mainnet dependency registry

Status: **partial first-pass only**. Two-person verification is still required
before any address is written into Railway or a production bundle.

## Tokens

| Asset | Address | Source | On-chain 2026-08-17 | Sign-off |
| --- | --- | --- | --- | --- |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | Starknet official STRK | Class present | Pending second reviewer |
| Native USDC | `0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb` | [Circle migration guide](https://www.circle.com/blog/starknet-migration-guide) | Class `0x078a357382d29a07ab7e32c5ce3ffae20021abee67c353b8885737b1d643eac9` | Pending second reviewer |
| Bridged USDC.e | `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8` | Circle / Vesu V1 docs | Class present | Do not use as Sotto's `USDC` unless STRK20 and the selected vault both require it |

The frontend previously used
`0x053c91253bc9682c04929ca02adb0bb3e4230cc62b3d7d5e0d083a16e7d1103a`.
A `starknet_getClassHashAt` call against Mainnet returned `Contract not found`.
Sotto now points at Circle native USDC.

Confirm with the STRK20 pool allowlist that native USDC is the screened asset
before enabling deposits. If the pool only accepts USDC.e, switch the frontend
to the bridged address above and re-test.

## STRK20 pool

No official class hash or contract address is recorded here yet. A third-party
article cited a truncated `0x0403…812a` value; that is not sufficient for
allowlisting. Obtain the address from StarkWare / STRK20 documentation and
verify it independently before Mainnet use.

## Vesu

[Vesu V2 addresses](https://docs.vesu.xyz/developers/contract-addresses)
publish **pool** contracts, not ERC-4626 vTokens:

| Name | Address | Usable as Sotto vault? |
| --- | --- | --- |
| Prime pool | `0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5` | No — not a vToken |
| Re7 USDC Prime pool | `0x02eef0c13b10b487ea5916b54c0a7f98ec43fb3048f60fdeedaf5b08f6f88aaf` | No — not a vToken |

### Correction (2026-08-17): compatible vTokens do exist

This document previously concluded that Vesu Vaults are ERC-7540 asynchronous and
therefore unusable. **That conclusion was wrong** and it blocked the Vesu route
unnecessarily. It was drawn from the docs address page, which lists pools; the
per-market vToken addresses are exposed by `https://api.vesu.xyz/markets`.

The live v2 vToken classes were read from chain via `starknet_getClass`. Each
implements the exact synchronous interface the helper calls:

- `deposit(assets: u256, receiver: ContractAddress) -> u256`
- `redeem(shares: u256, receiver: ContractAddress, owner: ContractAddress) -> u256`
- plus `withdraw`, `mint`, `asset`, `decimals`

and exposes **no** `request*` / `claim*` / `pending*` entrypoints — there is no
ERC-7540 async surface on these classes.

Non-deprecated v2 candidates whose `asset()` is official STRK or Circle native USDC:

| Label | vToken | `asset()` | Share decimals | `total_assets` |
| --- | --- | --- | --- | --- |
| vSTRK Prime | `0x06d6d2bf905dd199c78f2e421521d8473042737be9f47904e7578536c10f279d` | STRK | 18 | ~10,149,227 STRK |
| vUSDC Prime | `0x00387e8ddbb1ab36ca08874d9abc702ef4872ad600dcf76b7f240b71d7bc4e65` | native USDC | 18 | ~1,473,708 USDC |
| vUSDC Re7 Core | `0x017891114c00b07317b9102adefbad9fd5de40c5616f094ee09fe2fad67191b1` | native USDC | 18 | ~2,568,217 USDC |

**Share decimals are 18 on every one of these, including the vUSDC vaults whose
asset has 6.** Vault config must therefore carry `vTokenDecimals` explicitly;
`getVesuVaults()` drops any vault that omits it.

These addresses are a first-pass on-chain read only. Governance review and
two-person sign-off per the criteria below are still required.

A vault may be allowlisted only when all of the following are true:

1. It implements sync `deposit(assets, receiver) -> u256`.
2. It implements sync `redeem(shares, receiver, owner) -> u256`.
3. Share decimals and underlying decimals are documented.
4. Ownership, upgradeability, pause, fees, caps, oracles, and emergency
   controls have been reviewed.
5. Two reviewers sign the exact address.

Until that review exists, `VITE_VESU_LENDING_HELPER_ADDRESS` and
`VITE_VESU_VAULTS` must stay empty so the frontend fail-closes.

## Helper

| Network | Class hash | Contract | Status |
| --- | --- | --- | --- |
| Sepolia | `0x01d4a3353a4d7d89f2a8e3e154e3597bdb356158f9e1c8a1c2c3c83fa4742970` | `0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297` | Declared and deployed 2026-08-17; verified class hash on-chain; not a frozen Mainnet release. Token/pool/vault review: `docs/sepolia-addresses.md` |
| Mainnet | Do not declare | Do not deploy | Blocked |

## Economic and admin risks

- Vesu markets can pause, upgrade, change fees, or fail oracles.
- Privacy does not remove liquidation or curator-mandate risk.
- The helper is permissionless. Leftover tokens sent to it outside an atomic
  STRK20 batch can be consumed by any later `privacy_invoke` caller.
