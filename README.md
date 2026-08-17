# Sotto

Sotto is a private yield account built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon). It gives users one shielded account from which they can allocate capital across Starknet DeFi without publishing a wallet-to-position graph, then withdraw to a fresh address.

## What works

- Responsive account dashboard with shielded balance controls, yield positions, allocation management, privacy posture, and private activity history.
- Starknet wallet discovery using the Wallet Standard.
- Live STRK20 shield, unshield, and encrypted balance requests through `WalletAccountV6` in `starknet.js` 10.4.0.
- Source-chain deposit routing UX for Starknet, Ethereum, Base, and Arbitrum.
- Fresh-address withdrawal UX with explicit privacy warnings.
- Demo-mode portfolio and interactions for reviewers without a privacy-enabled wallet.

## Privacy model

Sotto keeps the user's viewing key in their wallet. The frontend asks the wallet to discover notes, generate a proof, and submit STRK20 actions.

Inside the STRK20 pool, sender, receiver, token, amount, and spent notes are hidden. The following remain public and are disclosed in the interface:

- Depositor, deposited token and amount at the entry edge.
- Withdrawal recipient, token, amount, and timing at the exit edge.
- Anonymizer/helper activity and open-note amounts for DeFi actions.
- Auditor-encrypted viewing-key material required by the protocol's selective disclosure model.

The dashboard's sample position data is a demo. A production yield route requires an audited `privacy_invoke` anonymizer for each protocol. STRK20 permits one external invoke per pool transaction, so a multi-protocol rebalance is executed as a sequence of separately proved transactions.

## Run locally

```bash
npm install
npm run dev
```

The default RPC is a public Starknet mainnet endpoint. For reliable live use, set:

```bash
VITE_STARKNET_RPC_URL=https://your-starknet-rpc
```

Then open `http://localhost:5173`.

## Build

```bash
npm run build
```

## Architecture

```text
React app
  |
  +-- Starknet Wallet API (WalletAccountV6)
  |     +-- wallet-owned viewing key
  |     +-- note discovery
  |     +-- STARK proof generation
  |     +-- shield / balance / withdraw
  |
  +-- STRK20 privacy pool
  |     +-- encrypted notes
  |     +-- private transfers
  |     +-- privacy_invoke
  |
  +-- Protocol anonymizers (deployment work)
  |     +-- Vesu lending helper
  |     +-- Nostra lending helper
  |     +-- Endur staking helper
  |
  +-- Privacy Bridge (integration work)
        +-- EVM USDC via Circle CCTP
        +-- inbound/outbound anonymizers
```

## Mainnet completion checklist

1. Deploy and audit protocol-specific anonymizers. The official Vesu helper is the first reference route.
2. Wire each allocation action to its helper address and exact calldata.
3. Integrate `@starkware-libs/starknet-privacy-bridge` for EVM USDC routes.
4. Add transaction receipt tracking and reconcile open-note output balances.
5. Replace demo APYs with verified protocol indexer data.
6. Test supported privacy wallets and detect STRK20 capabilities before presenting live actions.
7. Complete threat modeling, contract audits, slippage controls, allowance hygiene, and failure recovery.

## References

- [STRK20 builder guide](https://strk20.starknet.io/build)
- [STRK20 by Example](https://strk20-by-example.org/what-is-strk20)
- [Starknet Privacy SDK](https://github.com/starkware-libs/starknet-privacy)
- [Privacy Bridge](https://github.com/starkware-libs/privacy-bridge)
- [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit)

## License

MIT
