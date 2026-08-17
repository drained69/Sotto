# Release candidate record

This file records the toolchain, pinned dependencies, and process for the
current Sotto working tree. It is not a Mainnet go-ahead.

## Toolchain

| Tool | Version | Notes |
| --- | --- | --- |
| Scarb | 2.16.1 | Pinned in `.tool-versions` |
| Cairo | 2.16.1 | Bundled with Scarb |
| Sierra | 1.7.0 | Accepted by Mainnet chain information on 2026-08-17 |
| snforge | 0.63.0 | Matches `snforge_std = "0.63.0"` |
| sncast | 0.63.0 | Same Starknet Foundry release |
| Node.js | 25.2.1 | Development host |
| npm | 11.6.2 | |

Recorded on 2026-08-17. This shell resolves Homebrew before the `asdf` shims,
so release commands must put both pinned tool directories first in `PATH`:

```bash
export PATH="$(asdf where scarb 2.16.1)/bin:$(asdf where starknet-foundry 0.63.0)/bin:$PATH"
scarb --version
snforge --version
sncast --version
```

Scarb 2.18.0 was also tested, but emits Sierra 1.8.0. Scarb 2.16.1 was chosen
because it emits Sierra 1.7.0, the version explicitly listed as accepted by
Mainnet. The exact current ceiling above 1.7.0 remains a separate confirmation
item in `todo.md`.

## Pinned dependencies

| Component | Pin |
| --- | --- |
| `privacy` | git `https://github.com/starkware-libs/starknet-privacy` rev `66e3caae8c0201227a6719696d004e30d90aea65` |
| OpenZeppelin Cairo | `3.0.0` |
| starknet crate | `2.17.0` |
| `starknet.js` | `10.4.0` |
| `@starknet-io/types-js` | `0.10.3` |

Any later source or dependency change must repeat contract tests, frontend
lint/build/audit, and security review before a new release SHA is recorded.

## Git state

- Branch: `main`
- Last committed SHA: `0c3821fa3a6d81cd53ff37f75e32970b6c186378`
- Working tree: dirty. The current helper, tests, frontend USDC address, and
  RPC fallbacks have not been committed.
- A frozen release SHA cannot be assigned until this work is committed and
  the remaining blocking gates in `todo.md` are complete.

## Compatible candidate artifacts

Rebuilt and verified on 2026-08-17 with the pinned toolchain. These are
compatible working-tree candidate artifacts, not audited final-release
artifacts; repeat this process after the release SHA is frozen.

| Artifact | SHA-256 |
| --- | --- |
| `contracts/target/release/sotto_vesu_anonymizer_SottoVesuAnonymizer.contract_class.json` | `b198ab5a6b93e16be05f33ce7383ed0eb07c7e20f1a5178cd34e98799437a857` |
| `contracts/target/release/sotto_vesu_anonymizer_SottoVesuAnonymizer.compiled_contract_class.json` | `ed087cdc82a72d0a3eae7871871abba46daccd875dae8c37ad0c9ee19396fe3b` |

Candidate class hash:

```text
0x0424a607bd691a277eba542917d6378a5e059db49829d881b19af3eabb3b8ff4
```

Verification passed: `scarb fmt --check`, all 20 `snforge` tests,
`npm test` (7 tests), `npm run lint`, `npm run build`,
`npm run build:sepolia`, `npm audit --audit-level=high`, and
`npm run sepolia:verify-addresses`.

## Review of uncommitted source

Reviewed on 2026-08-17:

- Helper now uses share-denominated `redeem`, measures output by balance
  delta, and rejects zero/equal tokens and `u128` overflow.
- A reentrancy lock was added after the mock callback vault was able to
  re-enter `privacy_invoke` and inflate the measured output.
- Generated `contracts/target/**` artifacts are tracked and will change with
  every rebuild. They are not a substitute for a hashed release archive.
- The previous default Blast RPC endpoints are offline. Fallbacks now use
  `https://rpc.starknet.lava.build` and
  `https://api.cartridge.gg/x/starknet/sepolia`.
- The previous hardcoded Mainnet USDC address was not a deployed contract.
  It has been replaced with Circle native USDC. See `docs/mainnet-addresses.md`.

## Repeat-review rule

If any of the following change after a future freeze, restart from contract
tests and treat the previous SHA as superseded:

- Cairo source
- `Scarb.toml` / `Scarb.lock`
- Frontend transaction construction
- Token, helper, or vault addresses
- RPC or Railway public configuration
