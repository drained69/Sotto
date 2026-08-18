# Sotto

Sotto is a private yield account for DeFi. It lets users hold shielded assets, lend, stake, and allocate capital across supported strategies without exposing their total holdings or making every position easy to link back to one identity.

Users can deposit from supported chains, manage their private account from one interface, move capital between configured DeFi positions, and withdraw to a fresh wallet when they are ready to exit. The account is non-custodial: Sotto never asks for seed phrases, private keys, or viewing keys.

The current implementation uses STRK20 on Starknet. STRK20 represents balances as encrypted notes, while the connected privacy-enabled wallet remains responsible for note discovery, viewing-key custody, proof generation, and transaction authorization. Cross-chain deposits and additional DeFi protocols are represented in the product model but remain disabled until their bridge, relayer, indexer, and contract integrations are deployed and verified.

## Table of contents

- [Product overview](#product-overview)
- [Core capabilities](#core-capabilities)
- [Current integration status](#current-integration-status)
- [How Sotto works](#how-sotto-works)
- [Privacy model](#privacy-model)
- [Supported assets and networks](#supported-assets-and-networks)
- [User workflows](#user-workflows)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Vesu integration](#vesu-integration)
- [Contract development](#contract-development)
- [Production deployment](#production-deployment)
- [Security considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [References](#references)
- [License](#license)

## Product overview

Public DeFi activity can expose a detailed relationship between a wallet, its balances, and its positions. Sotto is designed to make the private account the primary place where capital is held and allocated. Supported assets enter a privacy pool before they are transferred or routed into an integrated protocol, reducing the amount of portfolio information visible from a single public address.

The product is built around four principles:

- **Private by default:** balances and internal transfers are discovered through the user's wallet rather than reconstructed by the frontend.
- **One account for many strategies:** lending, staking, reserve holdings, and future protocol routes can be managed from the same shielded account.
- **Chain-agnostic entry and exit:** users should be able to deposit from supported source chains and withdraw to a fresh destination wallet as bridge infrastructure becomes available.
- **Explicit trust boundaries:** public deposit and withdrawal edges, protocol activity, configuration limits, and remaining DeFi risks are shown clearly.

The account dashboard provides five primary functions:

1. Connect a compatible privacy wallet and verify the capabilities required by the selected route.
2. Discover shielded balances through the wallet-owned viewing key.
3. Submit deposits, private transfers, withdrawals, and configured lending or staking actions.
4. Allocate capital across available strategies while keeping internal account balances private.
5. Track transactions submitted during the current browser session and verify their receipts on-chain.

Sotto is intentionally fail-closed. If a token, lending helper, vault, bridge, or wallet capability is not configured, the related action remains unavailable. The application does not replace missing integrations with mock transactions, estimated balances, invented yield rates, or synthetic confirmations.

## Core capabilities

### Private account dashboard

- Displays STRK20 balances returned by the connected wallet.
- Separates liquid shielded assets from recognized yield-position tokens.
- Allows balances to be hidden in the interface.
- Reports the connected network, Wallet API versions, route availability, and synchronization state.
- Provides explicit empty, loading, unsupported, and error states.

### Starknet wallet connection

- Discovers compatible wallets through the Starknet Wallet Standard.
- Connects through `WalletAccountV6` from `starknet.js`.
- Supports Starknet Mainnet and Starknet Sepolia RPC providers.
- Requires Wallet API `0.10.3` or newer before enabling STRK20 actions.
- Keeps the account connection in browser memory and exposes a manual disconnect action.

### Shielded asset operations

- Shields configured STRK or USDC into encrypted STRK20 notes.
- Transfers configured assets privately to another registered STRK20 account.
- Queries private balances with `strk20Balances`.
- Withdraws shielded assets to a user-selected Starknet address.
- Supports the fresh-wallet withdrawal pattern intended to reduce direct address reuse.
- Waits for transaction receipts and distinguishes confirmed transactions from reverted transactions.
- Refreshes private balances after successful settlement.

### Private yield allocation

- Reads an allowlisted set of Vesu vaults from deployment configuration.
- Converts shielded underlying assets into private vToken notes through an app-specific anonymizer.
- Dry-runs the complete STRK20 action list before requesting the final proof and submission.
- Recognizes configured vToken balances as private yield positions in the dashboard.
- Keeps each lending, staking, or allocation route disabled unless its helper, contracts, and market configuration pass validation.
- Provides the product surface for adding more protocols without exposing a public aggregate portfolio.

### Privacy-aware interface

- Explains what STRK20 protects and what remains visible on-chain.
- Warns users that deposit and withdrawal edges are public.
- Recommends a genuinely unused destination address for withdrawals intended to reduce linkage.
- Does not describe privacy as anonymity or claim to conceal every part of a transaction.

## Current integration status

| Area | Status | Behavior |
| --- | --- | --- |
| Wallet discovery | Implemented | Discovers Starknet Wallet Standard providers and requests account access. |
| Capability detection | Implemented | Requires Wallet API `0.10.3` or newer for STRK20 operations. |
| Private balance discovery | Implemented | Reads balances from the connected wallet with `strk20Balances`. |
| Starknet shield deposits | Implemented | Submits a STRK20 `deposit` action for configured STRK or USDC. |
| Starknet withdrawals | Implemented | Submits a STRK20 `withdraw` action to the requested recipient. |
| Private transfers | Implemented | Submits a STRK20 `transfer` action to a registered recipient address. |
| Receipt tracking | Implemented | Tracks transactions submitted in the current browser session. |
| Vesu lending | Configuration-dependent | The first live yield route; enabled only when a reviewed helper and verified vault addresses are configured. |
| Additional lending and staking protocols | Planned | The account model is designed for multiple strategies, but each protocol requires its own reviewed adapter and route. |
| Ethereum, Base, and Arbitrum deposits | Interface only | Source-chain routes are shown but disabled until Privacy Bridge infrastructure is deployed and tested. |
| Fresh-wallet withdrawal guidance | Implemented | The withdrawal flow recommends an unused destination address, while the user remains responsible for address selection. |
| Historical portfolio indexing | Not included | The activity panel only contains transactions submitted in the current session. |
| Live APY data | Not included | Sotto does not render a rate unless a verified market-data source is integrated. |

## How Sotto works

### Balance discovery

1. The user connects a privacy-enabled Starknet wallet.
2. Sotto checks the wallet's supported Wallet API versions.
3. The frontend creates a `WalletAccountV6` bound to the RPC provider for the connected network.
4. Sotto requests balances with `strk20Balances(...)` for the configured liquid assets and recognized Vesu vTokens.
5. The wallet discovers notes using its viewing key and returns the resulting token balances.
6. The frontend normalizes token addresses, labels recognized assets and vault tokens, and displays only positive balances.

The frontend never receives the user's viewing key. It only receives the balance response authorized and produced by the wallet.

### Shielding an asset

1. The user selects Starknet, an asset, and an amount.
2. Sotto converts the decimal amount into the token's base units.
3. The frontend creates a STRK20 `deposit` action.
4. The wallet prepares the private transaction, generates the required proof, and submits it.
5. Sotto waits for the Starknet receipt and refreshes wallet-discovered balances after confirmation.

### Withdrawing an asset

1. The user selects an asset and enters an amount and destination address.
2. Sotto creates a STRK20 `withdraw` action for that recipient.
3. The wallet proves and submits the transaction.
4. The withdrawal address, asset, amount, and timing are visible at the public exit edge.
5. After confirmation, Sotto refreshes the private account balance.

### Sending a private transfer

1. The sender selects an asset, amount, and recipient Starknet address.
2. Sotto creates a STRK20 `transfer` action and leaves note selection and proof generation to the wallet.
3. The wallet performs registration and channel setup when required and supported by its STRK20 implementation.
4. The wallet spends the sender's notes, creates the recipient note, and creates any required change note.
5. The recipient discovers the note through the wallet's viewing key. Public observers cannot see the sender, recipient, token, amount, or spent notes inside the pool.

The recipient must be registered with the STRK20 pool before the transfer can settle. Sotto does not ask users for viewing keys or attempt to perform note discovery in the browser.

### Opening a private yield position

The Vesu route combines two STRK20 actions:

1. Open a note for the resulting vToken shares with a `transfer` action whose amount is the literal `"OPEN"`.
2. Invoke the anonymizer, which receives the selected underlying amount from the pool, deposits it into the selected Vesu vault, and returns the resulting shares to the open note.

Before submission, Sotto calls `strk20PrepareInvoke(actions, true)` to dry-run the exact action sequence. It then submits the same actions with `strk20InvokeTransaction`.

STRK20 supports one external invoke per pool transaction. Operations involving multiple protocols must therefore be executed as separate proved transactions rather than as one multi-protocol rebalance.

## Privacy model

Sotto improves transaction privacy, but it does not make all account activity invisible. Users and operators should understand the exact boundary before using the product.

### Information protected inside STRK20

- Ownership of encrypted notes.
- Private sender and receiver relationships within the pool.
- Shielded token balances.
- Amounts represented by private notes.
- Which private notes are consumed by a transaction.
- The sender and recipient relationship for private transfers.

### Information visible at public edges

- The wallet that deposits into the privacy pool.
- The token and amount deposited.
- The destination of a withdrawal.
- The token and amount withdrawn.
- Transaction timing and other public Starknet metadata.
- Anonymizer or helper contract activity.
- Open-note output amounts used by supported DeFi integrations.

### Registration, screening, and selective disclosure

The viewing key remains under wallet control and is used by the wallet to discover notes. An account must register a public viewing key before it can hold or receive private balances. Wallets handle first-use registration and channel setup when their implementation supports it.

Deposits are screened by the protocol's configured screening provider and require a valid screening signature verified on-chain. A self-hosted prover does not bypass deposit screening.

The STRK20 protocol also includes auditor-encrypted viewing-key material as part of its selective-disclosure model. An authorized protocol auditor may be able to recover escrowed viewing information under that model, but viewing access does not grant spending authority.

### Practical privacy guidance

- Do not assume that shielding erases the public deposit transaction.
- Avoid withdrawing to an address already associated with the original depositor if reducing linkage is important.
- Consider timing, amount uniqueness, and subsequent public activity when evaluating privacy.
- Treat DeFi helper activity and open-note amounts as public metadata.
- Treat deposit screening as a protocol requirement for every route into the pool.
- Review the current STRK20 protocol documentation and deployed contracts before relying on specific privacy properties.

## Supported assets and networks

Sotto's long-term account model is multi-chain, but support is activated route by route. A chain appearing in the interface does not mean deposits are currently enabled on that chain.

### Networks

| Network | Wallet connection | Shield and withdraw | Vesu route |
| --- | --- | --- | --- |
| Starknet Mainnet | Supported | Supported for configured assets | Supported when configured |
| Starknet Sepolia | Supported | Supported when test token addresses are configured | Supported when test helper and vaults are configured |
| Ethereum | Not yet active | Bridge route disabled | Not applicable |
| Base | Not yet active | Bridge route disabled | Not applicable |
| Arbitrum | Not yet active | Bridge route disabled | Not applicable |

The Ethereum, Base, and Arbitrum options represent planned source-chain routes through the Starknet Privacy Bridge and Circle CCTP. The interface prevents submission until the necessary contracts and server-side services are available.

### Assets

| Asset | Mainnet configuration | Decimals |
| --- | --- | --- |
| STRK | Built-in Starknet Mainnet address | 18 |
| USDC | Circle native USDC on Starknet Mainnet | 6 |

Sepolia token addresses must be provided explicitly. Mainnet addresses are never reused as testnet defaults.

## User workflows

### Connect an account

1. Open the wallet dialog from the top navigation.
2. Select a discovered Starknet wallet.
3. Approve the account request in the wallet.
4. Confirm that the interface reports Mainnet or Sepolia and marks the privacy API as available.

If no wallet is listed, install a Starknet wallet that implements the required STRK20 Wallet API. A standard wallet without the privacy methods can connect at the provider level but cannot be used for private balance discovery or STRK20 transactions.

### Deposit into Sotto

1. Select **Deposit**.
2. Choose a supported source chain.
3. Select a configured asset and enter the amount to shield.
4. Approve the source-chain transfer or bridge flow, when applicable.
5. Approve proof generation and submission in the privacy wallet.
6. Wait for the transaction to confirm and the private account balance to synchronize.

### Withdraw from Sotto

1. Select **Withdraw**.
2. Choose the asset and amount.
3. Enter a valid destination address on a supported withdrawal network. Use a genuinely fresh wallet when reducing direct linkage matters.
4. Review the public-exit warning.
5. Approve the private withdrawal in the wallet.
6. Verify the confirmed transaction through the explorer link in the activity panel.

### Open a private lending position

1. Ensure the deployment has a configured Vesu anonymizer and at least one verified vault.
2. Select **Open position**.
3. Choose a configured vault and enter a shielded amount.
4. Approve the wallet dry run and final proof request.
5. Wait for confirmation and balance synchronization.
6. Confirm that the resulting vToken appears as a private position.

## Architecture

```text
Browser
  |
  +-- Sotto React application
  |     +-- product interface and route configuration
  |     +-- token amount validation and formatting
  |     +-- transaction receipt tracking
  |     +-- no viewing-key or private-note storage
  |
  +-- Starknet Wallet Standard provider
  |     +-- account authorization
  |     +-- Wallet API capability reporting
  |     +-- network and account selection
  |
  +-- WalletAccountV6 privacy methods
  |     +-- strk20Balances
  |     +-- private transfer actions
  |     +-- strk20PrepareInvoke
  |     +-- strk20InvokeTransaction
  |     +-- wallet-owned note discovery and proof generation
  |
  +-- Starknet RPC provider
  |     +-- transaction submission support
  |     +-- receipt polling and settlement verification
  |
  +-- STRK20 privacy pool
        +-- encrypted notes
        +-- shielded transfers
        +-- public deposit and withdrawal edges
        +-- privacy_invoke integration boundary
              |
              +-- Sotto Vesu anonymizer
                    +-- deposits assets into a configured Vesu vToken
                    +-- redeems configured vToken shares
                    +-- returns output assets as an open STRK20 note
```

### Frontend trust boundary

The frontend is responsible for constructing actions, validating deployment configuration, presenting privacy disclosures, and tracking receipts. The wallet is responsible for viewing-key custody, note discovery, proof generation, and user authorization. The Starknet network and deployed contracts are responsible for validating and settling the transaction.

The Privacy SDK is intentionally not bundled into this browser application. The official architecture reserves direct SDK use for privacy wallets and advanced account-controlled backends because it requires direct custody of a viewing key, proving configuration, discovery configuration, note management, and proof submission. Sotto uses the recommended Wallet API route instead.

### Fail-closed configuration

Addresses supplied through environment variables are parsed with Starknet address validation. Invalid helper addresses are discarded, malformed vault JSON produces an empty route list, and a vault is accepted only when it has:

- A valid vToken contract address.
- A recognized underlying asset.
- A non-empty display label.
- A configured helper address for the same deployment.

This behavior prevents partially configured routes from appearing actionable in the interface.

## Technology stack

- React 19
- TypeScript 5
- Vite 6
- `starknet.js` 10.4
- `@starknet-io/types-js` STRK20 action types
- Starknet Wallet Standard discovery packages
- Starknet Wallet API types
- Scarb/Cairo 2.16.1 contract workspace (Sierra 1.7.0), pinned in `.tool-versions`
- OpenZeppelin Cairo contracts
- Starknet Privacy library
- Lucide React icons

## Local development

### Prerequisites

- Node.js 20 or newer is recommended.
- npm 10 or newer is recommended.
- A Starknet wallet for connection testing.
- A privacy-enabled wallet implementing Wallet API `0.10.3` or newer for live STRK20 testing.
- Scarb compatible with the contract workspace when building Cairo contracts.

### Install dependencies

```bash
npm install
```

### Configure the environment

```bash
cp .env.example .env.local
```

Sepolia: use `npm run dev:sepolia` (loads `.env.sepolia`) instead of flipping
the Mainnet template. The included public RPC endpoints are suitable for
basic development. Blast public Starknet endpoints are retired; the example
file uses Lava for Mainnet and Cartridge for Sepolia. Use dedicated RPC
endpoints for reliable testing and production traffic.

### Start the development server

```bash
npm run dev
```

Open `http://localhost:5173`.

### Create a production build

```bash
npm run build
```

The build command runs the TypeScript project build and then emits the optimized Vite application to `dist/`.

### Preview the production build

```bash
npm run preview
```

### Run static analysis

```bash
npm run lint
```

### Sepolia checks

```bash
npm test
npm run sepolia:verify-addresses
npm run dev:sepolia      # official Sepolia tokens, helper set, vaults empty
npm run build:sepolia
```

Address review: `docs/sepolia-addresses.md`. Live wallet campaign: `docs/sepolia-e2e.md`.

## Configuration

All frontend environment variables are embedded into the browser bundle by Vite. Never place private keys, signing material, paymaster credentials, manager keys, or other secrets in variables prefixed with `VITE_`.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_STRK20_NETWORK` | No | Asset configuration network. Defaults to `mainnet`; use `sepolia` for testnet token configuration. |
| `VITE_STARKNET_MAINNET_RPC_URL` | Recommended | Starknet Mainnet JSON-RPC endpoint. |
| `VITE_STARKNET_SEPOLIA_RPC_URL` | Recommended | Starknet Sepolia JSON-RPC endpoint. |
| `VITE_STARKNET_RPC_URL` | No | Legacy Mainnet RPC fallback used when the dedicated Mainnet variable is absent. |
| `VITE_SEPOLIA_STRK_ADDRESS` | Sepolia only | STRK contract address used when `VITE_STRK20_NETWORK=sepolia`. |
| `VITE_SEPOLIA_USDC_ADDRESS` | Sepolia only | USDC contract address used when `VITE_STRK20_NETWORK=sepolia`. |
| `VITE_VESU_LENDING_HELPER_ADDRESS` | Vesu only | Deployed and reviewed Sotto Vesu anonymizer address. |
| `VITE_VESU_VAULTS` | Vesu only | JSON object containing the allowlisted Vesu vault definitions. |

Example Mainnet development configuration:

```dotenv
VITE_STRK20_NETWORK=mainnet
VITE_STARKNET_MAINNET_RPC_URL=https://your-mainnet-rpc.example
VITE_STARKNET_SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
VITE_VESU_LENDING_HELPER_ADDRESS=0x...
VITE_VESU_VAULTS={"vaults":[{"id":"vesu-usdc","label":"Vesu USDC","underlying":"USDC","vTokenAddress":"0x..."}]}
```

Example Sepolia configuration (reviewed 2026-08-17; see `docs/sepolia-addresses.md`):

```dotenv
VITE_STRK20_NETWORK=sepolia
VITE_STARKNET_SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
VITE_SEPOLIA_STRK_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
VITE_SEPOLIA_USDC_ADDRESS=0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343
VITE_VESU_LENDING_HELPER_ADDRESS=0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297
VITE_VESU_VAULTS={"vaults":[]}
```

Published Vesu Sepolia vTokens wrap Vesu mock tokens, not official STRK or
Circle USDC. Leave `VITE_VESU_VAULTS` empty until a vault whose `asset()`
matches those official tokens is reviewed.

The selected `VITE_STRK20_NETWORK`, token addresses, helper, vaults, and wallet network must all refer to the same Starknet deployment. The frontend detects the connected wallet network independently; operators are responsible for publishing a consistent configuration.

## Vesu integration

The repository includes `sotto_vesu_anonymizer`, a Cairo helper that holds no user balances and converts assets between an underlying ERC-20 and a Vesu vToken during `privacy_invoke`.

### Contract behavior

For a deposit operation, the helper:

1. Receives the underlying asset from the STRK20 transaction.
2. Approves the configured vToken contract to spend the requested amount.
3. Calls the vToken's `deposit` function with the helper as receiver.
4. Measures the vToken balance increase.
5. Approves the calling privacy pool to collect the output.
6. Returns an `OpenNoteDeposit` describing the vToken output and target note.

For a withdrawal operation, the helper:

1. Receives vToken shares from the STRK20 transaction.
2. Calls the vToken's `redeem` function.
3. Measures the underlying token balance increase.
4. Approves the calling privacy pool to collect the output.
5. Returns an `OpenNoteDeposit` describing the underlying output and target note.

The helper rejects zero token addresses, zero amounts, identical input and output tokens, zero output amounts, and outputs that cannot fit the STRK20 open-note amount type.

### Deployment requirements

- Review and audit the exact contract source and pinned dependencies.
- Confirm that every configured vault implements the expected vToken interface.
- Deploy the helper to the same network selected by the frontend configuration.
- Verify the declared class and deployed contract through the appropriate Starknet tooling.
- Populate `VITE_VESU_LENDING_HELPER_ADDRESS` with the verified deployment.
- Populate `VITE_VESU_VAULTS` with an explicit allowlist of reviewed vault contracts.
- Test both deposit and redemption behavior before exposing the route to users.

## Contract development

The Cairo workspace is located in `contracts/` and pins the Starknet Privacy dependency to a specific revision for reproducibility.

Build the contracts with the supported Scarb toolchain:

```bash
cd contracts
scarb build
```

Format the workspace:

```bash
cd contracts
scarb fmt
```

The anonymizer is designed to be called as part of the STRK20 pool's `privacy_invoke` flow. A direct call from an ordinary user account is not a substitute for an STRK20 privacy proof and should not be treated as a supported product path.

## Production deployment

Before operating Sotto with real assets, complete the following controls:

1. Audit the anonymizer contract and all local modifications to the upstream privacy integration pattern.
2. Verify every token, pool, helper, and vToken address for the target network.
3. Use dedicated, monitored RPC infrastructure with appropriate rate limits and failover.
4. Add persistent transaction indexing if users require history across browser sessions.
5. Reconcile open-note outputs and protocol positions against trusted indexer data.
6. Integrate a verified market-data source before displaying APYs or estimated yield.
7. Test supported wallets and detect individual STRK20 methods before enabling each action.
8. Add slippage, minimum-output, deadline, and vault-health controls where the protocol flow permits them.
9. Review token approval behavior and verify that allowances cannot be abused or left unexpectedly active.
10. Define recovery behavior for failed proofs, reverted invokes, RPC timeouts, stale balances, and interrupted sessions.
11. Complete threat modeling for frontend compromise, malicious wallets, incorrect configuration, contract upgrades, compromised RPC providers, and address poisoning.
12. Add monitoring for contract events, transaction failures, balance reconciliation errors, and RPC degradation.
13. Publish verified contract addresses, supported wallet versions, known risks, and incident-response contacts.
14. Independently validate the privacy claims against the exact deployed STRK20 contracts and wallet implementation.

### Cross-chain routes

Activating EVM source-chain deposits requires more than a frontend contract address. A complete Privacy Bridge deployment must include the relevant CCTP contracts, derived account flow, indexer, prover, relaying or paymaster services, and secure server-side configuration. Until the full route is deployed and tested, Sotto intentionally blocks Ethereum, Base, and Arbitrum submissions.

### Private sub-accounts

The STRK20 documentation calls this capability private sub-accounts, rather than a separate stealth-account Wallet API. The SDK route is available for account-controlled integrations in the documented SDK release line, but the Wallet API used by this browser dapp does not expose a sub-account method. Sotto therefore does not generate or claim to manage stealth accounts. Adding that flow here would require taking control of account keys and moving the product onto the advanced SDK route, which would change the wallet trust boundary.

## Security considerations

### No custody by the frontend

Sotto does not request or store seed phrases, private keys, or viewing keys. Wallet prompts should be reviewed carefully, and users should reject any request that does not match the intended action.

### Browser configuration is public

Every `VITE_` variable is readable by users of the deployed application. Public contract and RPC addresses are appropriate; credentials and secret material are not.

### Configuration is part of the security boundary

A valid Starknet address is not necessarily a safe contract. Address validation prevents malformed configuration but does not verify contract bytecode, ownership, upgradeability, protocol legitimacy, or economic safety. Operators must review and allowlist every deployed dependency.

### RPC providers affect availability and observability

An RPC provider can delay, omit, or misreport responses even though it cannot forge a valid Starknet state transition. Production deployments should use trusted providers, monitor discrepancies, and consider independent receipt verification.

### DeFi risk remains

Privacy does not remove smart-contract, oracle, liquidity, liquidation, governance, upgrade, or economic risk in an integrated protocol. A private Vesu position remains exposed to the risks of its underlying market and contracts.

### Frontend integrity matters

The browser constructs the action list presented to the wallet. Production releases should use protected deployment pipelines, dependency review, content-security controls, reproducible builds where practical, and wallet interfaces that clearly display the action being authorized.

## Troubleshooting

### No wallet is detected

- Confirm that a Starknet wallet extension is installed and enabled.
- Refresh the page after installing or unlocking the wallet.
- Verify that the wallet exposes the Starknet Wallet Standard provider.
- Use a privacy-enabled wallet for STRK20 actions.

### The interface reports `API unsupported`

- Check the Wallet API versions displayed in the account status panel.
- Upgrade the wallet to a release implementing Wallet API `0.10.3` or newer.
- Confirm that the wallet exposes the STRK20 methods required by `WalletAccountV6`.

### Private balances are unavailable

- Confirm that the wallet is connected to Starknet Mainnet or Sepolia.
- Verify that the configured RPC endpoint is reachable and supports the required Starknet RPC version.
- Unlock the wallet and approve any balance-discovery request.
- Retry synchronization from the dashboard.
- Check that testnet token addresses are configured when using Sepolia.

### A token is not configured

- Ensure `VITE_STRK20_NETWORK` matches the intended deployment.
- Set both Sepolia token addresses when using `sepolia`.
- Restart the Vite server after changing environment variables.
- Do not use Mainnet addresses as Sepolia placeholders.

### The Vesu route says `Not deployed`

- Set `VITE_VESU_LENDING_HELPER_ADDRESS` to a valid deployed Starknet address.
- Confirm `VITE_VESU_VAULTS` is valid single-line JSON.
- Ensure each vault has a label, supported underlying symbol, and valid vToken address.
- Verify that the helper and all vaults are deployed on the configured network.
- Restart or rebuild the application after changing the deployment environment.

### A transaction remains in `Confirming`

- Open the transaction through a Starknet explorer and inspect its network status.
- Confirm that the configured RPC is healthy and serving the connected chain.
- Wait for network inclusion if the transaction is pending.
- Refresh private balances after the transaction settles if the browser session was interrupted.

### A cross-chain source is disabled

This is expected until the Privacy Bridge contracts and supporting services are configured. The frontend will not request funds or simulate a successful bridge transaction when the route is unavailable.

## Project structure

```text
.
├── contracts/
│   ├── Scarb.toml
│   ├── README.md
│   └── packages/sotto_vesu_anonymizer/
│       ├── Scarb.toml
│       └── src/
│           ├── lib.cairo
│           ├── sotto_vesu_anonymizer.cairo
│           ├── test_contracts.cairo
│           └── tests.cairo
├── docs/                       Release, address, audit, ops, deploy, and Sepolia review notes
├── src/
│   ├── App.tsx          Product interface and transaction workflows
│   ├── data.ts          Source-chain presentation data
│   ├── main.tsx         React application entry point
│   ├── strk20.ts        STRK20 actions, token configuration, and Vesu route
│   ├── styles.css       Responsive application styles
│   └── useWallet.ts     Wallet discovery, connection, and capability detection
├── .env.example         Public Mainnet template (Vesu fail-closed)
├── .env.sepolia         Public Sepolia profile for `vite --mode sepolia`
├── index.html
├── package.json
├── tsconfig.app.json
├── tsconfig.json
└── vite.config.ts
```

## References

- [STRK20 builder guide](https://strk20.starknet.io/build)
- [STRK20 by Example](https://strk20-by-example.org/what-is-strk20)
- [Starknet Privacy SDK](https://github.com/starkware-libs/starknet-privacy)
- [Starknet Privacy Bridge](https://github.com/starkware-libs/privacy-bridge)
- [Starknet.js documentation](https://starknetjs.com/)
- [Vesu documentation](https://docs.vesu.xyz/)

## License

MIT
