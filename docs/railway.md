# Railway configuration

Do not promote a public production service until section 13 of `todo.md` is
signed. The current Railway login has no linked Sotto project.

## Existing config

`railway.toml` sets the health check and restart policy. Railway builds the
repository's multi-stage `Dockerfile`, and Caddy serves the generated SPA. The
production image runs `npm run build:mainnet`, which includes the reviewed
Mainnet vault allowlist and reads the deployed helper from
`VITE_VESU_LENDING_HELPER_ADDRESS`:

```text
node:22-alpine -> npm ci -> Mainnet build with the verified helper -> Caddy
caddy:2.10.0-alpine -> serve /srv on ${PORT:-3000}
```

The Caddy configuration includes SPA fallback, compression, CSP,
Permissions Policy, Referrer Policy, `nosniff`, and frame denial. Its
`connect-src` permits the current Lava Mainnet and Cartridge Sepolia RPC hosts;
retired Blast hosts are not permitted.

## Safe public variables

All `VITE_` values are embedded in the browser bundle. Allowed:

```dotenv
VITE_STRK20_NETWORK=mainnet
VITE_STARKNET_MAINNET_RPC_URL=https://<trusted-mainnet-rpc>
VITE_STARKNET_SEPOLIA_RPC_URL=https://<trusted-sepolia-rpc>
VITE_VESU_LENDING_HELPER_ADDRESS=0x06277c357edf60e9acbbd5a9efaeb8fcb0d0b0daf1f06801ed94d4247a9b1e6a
VITE_VESU_VAULTS=<build:mainnet supplies the reviewed Prime vaults>
```

Never place private keys, authenticated RPC credentials, paymaster secrets,
or manager keys in `VITE_` variables.

A Mainnet build must keep the helper empty until the deployed class and vault
addresses are verified. The UI reports the route as configured only when both
the helper and at least one valid vault are present.

## Commands to run after a named approver exists

```bash
railway login
railway init   # or select an existing project
railway link
railway variable set VITE_STRK20_NETWORK=mainnet
railway variable set VITE_STARKNET_MAINNET_RPC_URL=https://<trusted-mainnet-rpc>
railway variable set VITE_STARKNET_SEPOLIA_RPC_URL=https://<trusted-sepolia-rpc>
railway variable set VITE_VESU_LENDING_HELPER_ADDRESS=
railway variable set 'VITE_VESU_VAULTS={"vaults":[]}'
```

Inspect the generated `dist` bundle from a preview deployment before
promoting. Confirm:

- `VITE_STRK20_NETWORK` is `mainnet`
- a Sepolia wallet is rejected by `requireLiveWallet`
- the Vesu route stays disabled when helper or vault JSON is empty/malformed
- no secrets appear in `dist/assets/*.js`

## Local preview evidence

On 2026-08-17, `docker build -t sotto-preview:local .` succeeded and the image
served `/` with HTTP 200. Header inspection confirmed CSP, Permissions Policy,
Referrer Policy, `nosniff`, and frame denial. The image contained no source
maps and a scan found no private-key markers, deployer alias, or retired Blast
host. The build still contains dependency `eval`, so CSP retains
`script-src 'unsafe-eval'`; accepting or replacing that dependency remains an
explicit production decision. This evidence does not replace inspection of a
hosted Railway deployment.

## Current account

`railway whoami` on 2026-08-17: logged in as `drained`. Existing projects
(`telegraph`, `degenminer`, `tacit-ui`, `Covenant`, `Legwork`, `attestra`)
are unrelated. This repository is not linked.
