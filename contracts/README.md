# Sotto Contracts

`sotto_vesu_anonymizer` is the app-specific STRK20 helper for private Vesu lending.
It follows the documented `privacy_invoke` pattern: the pool sends input assets
to the helper, the helper calls the Vesu ERC-4626-style vault, and the helper
returns an `OpenNoteDeposit` for the measured output.

It must be reviewed and deployed on the target Starknet network before setting
`VITE_VESU_LENDING_HELPER_ADDRESS`. The frontend fails closed when that address or
the corresponding vToken configuration is missing.

Build with the Starknet Privacy repository's supported Scarb toolchain:

```bash
cd contracts
scarb build
```

The helper is stateless and is intended to be called by the STRK20 pool through
`privacy_invoke`. It does not accept direct user calls as a substitute for a
privacy proof. The frontend invokes it through a Wallet API batch containing an
`OPEN` transfer for the output vToken followed by one `invoke` action.

The Vesu interface uses asset-denominated `withdraw`, not share-denominated
`redeem`: the input amount for a withdrawal operation is the number of assets
requested from the vault. Review the exact deployed vault ABI before enabling a
route.

The helper measures output by balance delta and approves the privacy pool to
pull the result. Open-note output amounts are public by design, while the open
note owner remains private.
