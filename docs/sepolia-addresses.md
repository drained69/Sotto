# Sepolia address review

Independent review recorded 2026-08-17 against Starknet Sepolia
(`chain_id` `0x534e5f5345504f4c4941` / `SN_SEPOLIA`) via
`https://api.cartridge.gg/x/starknet/sepolia`.

Re-run: `npm run sepolia:verify-addresses`.

## Decision

| Use | Address | Enable in Sepolia frontend? |
| --- | --- | --- |
| Official STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | Yes |
| Official Circle USDC | `0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343` | Yes |
| STRK20 privacy pool v2.0 | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` | Wallet-owned; documented only |
| Sotto helper | `0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297` | Yes (address only) |
| Vesu Genesis vUSDC / vSTRK | See vaults below | **No** — underlyings are Vesu mock tokens |

The Sepolia frontend therefore sets official STRK and Circle USDC, records the
reviewed helper, and keeps `VITE_VESU_VAULTS={"vaults":[]}`. Enabling those
vTokens while the UI spends official STRK or Circle USDC would call
`deposit`/`redeem` on a vault whose `asset()` is a different ERC-20.

## Tokens

### Official STRK

| Field | Value |
| --- | --- |
| Address | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Source | [Starknet chain information](https://docs.starknet.io/learn/cheatsheets/chain-info) Sepolia table |
| On-chain name / symbol / decimals | `Starknet Token` / `STRK` / `18` |
| Class | `0x02e77ee61d4df3d988ee1f42ea5442e913862cc82c2584d212ecda76666498fc` |
| Sign-off | First reviewer, 2026-08-17. Second reviewer still required for Mainnet. |

The Sepolia and Mainnet STRK addresses are identical. That is the official
deployment, not a reused Mainnet placeholder.

### Official Circle USDC

| Field | Value |
| --- | --- |
| Address | `0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343` |
| Source | [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) Starknet Sepolia row |
| On-chain name / symbol / decimals | `USDC` / `USDC` / `6` |
| Class | `0x078a357382d29a07ab7e32c5ce3ffae20021abee67c353b8885737b1d643eac9` |
| Sign-off | First reviewer, 2026-08-17 |

That class hash matches Circle native USDC on Mainnet
(`docs/mainnet-addresses.md`).

**Rejected alternate:** Circle's Starknet quickstart code still embeds
`0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080`.
That contract exists and also reports `USDC` / 6 decimals, but its class is
`0x0b45dbc3714180381c5680e41931172d67194d77d504413465390e0bef194ec`.
Do not use it.

### Vesu mock tokens (not used by the frontend)

Published on [Vesu V1 Sepolia](https://docs.vesu.xyz/developers/vesu-v1/addresses):

| Asset | Address | On-chain name | Class |
| --- | --- | --- | --- |
| Vesu USDC | `0x0715649d4c493ca350743e43915b88d2e6838b1c78ddc23d6d9385446b9d6844` | `usd-coin` | `0x0618504dfbef2146b7c9fb2273437db6bf294248d35d5930205c91aede0a9c20` |
| Vesu STRK | `0x01278f23115f7e8acf07150b17c1f4b2a58257dde88aad535dbafc142edbd289` | `starknet` | same as Vesu USDC |

These are Vesu's test tokens. They are not official STRK or Circle USDC.

## STRK20 pool

| Field | Value |
| --- | --- |
| Address | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Source | [STRK20 by Example SDK getting started](https://strk20-by-example.org/sdk/getting-started.md) — “privacy pool (v2.0)” |
| Class | `0x056ab118a8a6e38efc93ad758cefe909fee421fa931ce3cf72df624d345623b2` |
| `get_version` | `0x322e30` (`2.0`) |
| `get_auditor_public_key` | `0x01d17f98be07e99713265714699a5c40ccbf7b50c950fb7a2abd81846fcdfbb2` |
| Explorer | https://sepolia.voyager.online/contract/0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91 |

The class ABI includes `__execute__`, `__validate__`, `apply_actions`,
`compile_actions`, `get_note`, `nullifier_exists`, channel views, and
`get_screener_public_key`. There is no public token-allowlist view; deposit
screening is the documented FPI signature path.

The frontend never embeds this address. The connected privacy wallet owns the
pool it talks to.

## Helper

| Field | Value |
| --- | --- |
| Address | `0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297` |
| Class | `0x01d4a3353a4d7d89f2a8e3e154e3597bdb356158f9e1c8a1c2c3c83fa4742970` |
| Declare / deploy | `docs/deployment.md` |
| Explorer | https://sepolia.voyager.online/contract/0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297 |

On-chain class hash equals the documented working-tree class. Helper balances
and allowances to the STRK20 pool were zero for official STRK, Circle USDC,
Vesu mock STRK/USDC, vUSDC, and vSTRK at review time.

## Vesu vaults

Vesu V1 Sepolia Genesis pool id
`0x19dba49de42c8869e9d3e3f98da15780df5d067491826255c4f22882c91255e`
matches the published decimal id
`730993554056884283224259059297934576024721456828383733531590831263129347422`.

Extension `v_token_for_collateral_asset` on
`0x0571efca8cae0e426cb7052dad04badded0855b4cd6c6f475639af3356bc33fe`:

| Vault | Address | `asset()` | Official token? |
| --- | --- | --- | --- |
| vUSDC | `0x074655d40dcdf5d0c2d1c508e0d79ca57416dbd51facda53a08f9ec2380cf96d` | Vesu mock USDC | No |
| vSTRK | `0x05c89191eb94efd85fd4d376eef08a491e19d53f4bf10c1ddbdcb6f1a364d908` | Vesu mock STRK | No |
| official STRK | `0x0` | — | No vault |
| Circle USDC | `0x0` | — | No vault |

Both deployed vTokens share class
`0x05c64c6cb528bdbffe4187ba3385ff3843b43e8375ad4c3ddd6c28c1d5193576`
and expose synchronous ERC-4626 `deposit` and `redeem`.
`preview_deposit` / `preview_redeem` returned non-zero amounts.

They are Vesu-compatible, but they are **not** allowlistable next to official
STRK / Circle USDC. Vesu V2 publishes pools, not vTokens. Vesu's ERC-7540
async vaults remain unsupported (`docs/unsupported-tokens.md`).

Optional mock-token profile, **not** loaded by the current Sepolia frontend:

```dotenv
VITE_SEPOLIA_STRK_ADDRESS=0x01278f23115f7e8acf07150b17c1f4b2a58257dde88aad535dbafc142edbd289
VITE_SEPOLIA_USDC_ADDRESS=0x0715649d4c493ca350743e43915b88d2e6838b1c78ddc23d6d9385446b9d6844
VITE_VESU_VAULTS={"vaults":[{"id":"vesu-sepolia-usdc","label":"Vesu Sepolia Genesis USDC","underlying":"USDC","vTokenAddress":"0x074655d40dcdf5d0c2d1c508e0d79ca57416dbd51facda53a08f9ec2380cf96d","vTokenDecimals":18},{"id":"vesu-sepolia-strk","label":"Vesu Sepolia Genesis STRK","underlying":"STRK","vTokenAddress":"0x05c89191eb94efd85fd4d376eef08a491e19d53f4bf10c1ddbdcb6f1a364d908","vTokenDecimals":18}]}
```

Do not mix that vault list with official token addresses.

## Frontend configuration

Use `npm run dev:sepolia` / `npm run build:sepolia`, or copy the Sepolia block
from `.env.example` into `.env.local`. The helper is set so operators can see
the reviewed address; the vault list stays empty so the lending route
fail-closes.
