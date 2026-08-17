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

The helper holds no user balances and uses a transient reentrancy lock. It is
intended to be called by the STRK20 pool through `privacy_invoke`. A direct
call is not a substitute for a privacy proof, but the contract is
permissionless: leftover tokens sent to it can be consumed by any later
caller. The frontend invokes it through a Wallet API batch containing a
`withdraw` that funds the helper, an `OPEN` transfer for the output token, and
one `invoke` action.

The Vesu interface uses share-denominated `redeem`, not asset-denominated
`withdraw`. A withdrawal supplies a vToken share count because that is what a
shielded note holds. Using `withdraw` would burn `convertToShares(amount)` and
could strand leftover shares in this stateless helper. Review the exact
deployed vault ABI before enabling a route.

The helper measures output by balance delta and approves the privacy pool to
pull the result. Open-note output amounts are public by design, while the open
note owner remains private.
