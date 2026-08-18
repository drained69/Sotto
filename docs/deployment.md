# Contract deployment runbook

Hackathon scope: no independent audit is planned within the timeframe. The
contract has 20 passing tests covering deposit/redeem semantics, allowance
lifecycle, boundary values, malicious-token classes, and the permissionless
sweep risk. Sepolia has a live helper that has been re-verified against chain
state. That is the safety envelope — go slowly and use small amounts on the
first Mainnet transaction.

Everything documented as still-risky is still risky. The helper is
permissionless by construction: any tokens left in it between atomic STRK20
batches can be consumed by any subsequent caller. Operators must not leave
funds in the helper.

## Rebuild the candidate

```bash
export PATH="$(asdf where scarb 2.16.1)/bin:$(asdf where starknet-foundry 0.63.0)/bin:$PATH"
scarb --version    # expect 2.16.1 / Cairo 2.16.1 / Sierra 1.7.0
snforge --version  # expect 0.63.0
sncast --version   # expect 0.63.0
cd contracts
scarb fmt --check
scarb build
snforge test
scarb --profile release build
sncast utils class-hash --contract-name SottoVesuAnonymizer --package sotto_vesu_anonymizer
```

Hash and archive:

- `contracts/target/release/sotto_vesu_anonymizer_SottoVesuAnonymizer.contract_class.json`
- `contracts/target/release/sotto_vesu_anonymizer_SottoVesuAnonymizer.compiled_contract_class.json`

Constructor calldata is empty.

The repository pins Scarb `2.16.1`, which emits Sierra `1.7.0`, the version
explicitly listed by Starknet chain information as accepted on Mainnet. The
class hash `0x0424a607bd691a277eba542917d6378a5e059db49829d881b19af3eabb3b8ff4`
is reproducible from a clean checkout: the compare command against the
recorded value is
`sncast utils class-hash --sierra-file target/release/sotto_vesu_anonymizer_SottoVesuAnonymizer.contract_class.json`.
Freeze source, rebuild, and re-hash before declaring.

## Sepolia (allowed after tests pass)

Profile: `sotto-sepolia` in `contracts/snfoundry.toml`.

Deployer:

- Address: `0x00dec0c3d3718999727f7ffdfdfe6bb9975904cc175932333a559d626aef534fd`
  (canonical form `0xdec0c3d3718999727f7ffdfdf6bb9975904cc175932333a559d626aef534fd`)
- Network: Sepolia
- Observed 2026-08-17: deployed OZ account, nonce `3`, STRK balance
  `96085812361002659392` (~96 STRK)

Estimate:

```bash
cd contracts
sncast --profile sotto-sepolia declare \
  --contract-name SottoVesuAnonymizer \
  --package sotto_vesu_anonymizer \
  --network sepolia \
  --dry-run --detailed
```

Declare and deploy only after the class hash from `sncast utils class-hash`
matches the dry-run:

```bash
sncast --profile sotto-sepolia --wait declare \
  --contract-name SottoVesuAnonymizer \
  --package sotto_vesu_anonymizer \
  --network sepolia

sncast --profile sotto-sepolia --wait deploy \
  --class-hash 0x<CLASS_HASH> \
  --network sepolia
```

Recorded Sepolia deployment 2026-08-17 (working-tree helper, not a frozen
Mainnet release):

| Item | Value |
| --- | --- |
| Class hash | `0x01d4a3353a4d7d89f2a8e3e154e3597bdb356158f9e1c8a1c2c3c83fa4742970` |
| Contract | `0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297` |
| Declare tx | `0x02a8e5b2a5bf3c90d351b41a695d9d7fc42d23a961bf614f1eb793e7b0320aea` |
| Deploy tx | `0x024ab9311ca12cc6379899df08416e6f75b0a13b6a3603f5a05bafcacb4db558` |
| Class | https://sepolia.voyager.online/class/0x01d4a3353a4d7d89f2a8e3e154e3597bdb356158f9e1c8a1c2c3c83fa4742970 |
| Contract | https://sepolia.voyager.online/contract/0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297 |

Working-tree class hash recorded 2026-08-17 (recompute after any Cairo
change):

```
0x01d4a3353a4d7d89f2a8e3e154e3597bdb356158f9e1c8a1c2c3c83fa4742970
```

Sepolia declare dry-run with `--network sepolia`: about `4.071 STRK`.
A dry-run against `api.cartridge.gg` failed with JSON-RPC `-32603`
because that node is Starknet JSON-RPC 0.9 while sncast 0.63 expects
0.10. Use `--network sepolia` for declare/deploy.

## Mainnet

Recorded Mainnet deployment 2026-08-18:

| Item | Value |
| --- | --- |
| Class hash | `0x0424a607bd691a277eba542917d6378a5e059db49829d881b19af3eabb3b8ff4` |
| Contract | `0x06277c357edf60e9acbbd5a9efaeb8fcb0d0b0daf1f06801ed94d4247a9b1e6a` |
| Deploy tx | `0x018af3f4d95f6d8064c56738daba6d82ae99d4be6144af8966aeef828ad4c52b` |

The class was already declared when the deployment run began, so no new
declaration transaction was submitted.

Prerequisites (all done by a human, none by the repo):

1. **Dedicated deployer account.** Do not reuse the Sepolia key. Fund it with
   about 3 STRK — declares and deploys on Mainnet each run well under 1 STRK
   at current gas, and the slack keeps you above the floor.
2. **Import it into sncast** under the alias `sotto-mainnet-deployer` — the
   `sotto-mainnet` profile in `contracts/snfoundry.toml` expects that exact
   name:
   ```bash
   sncast account import --name sotto-mainnet-deployer \
     --address 0xYOUR_DEPLOYER --type braavos --network mainnet \
     --private-key 0xYOUR_KEY
   ```
   Type is `braavos`, `oz`, or `argent` depending on your account.
3. **Freeze the source SHA** you are deploying and rebuild from a clean
   checkout. The class hash produced must equal the value recorded in
   `docs/release.md` — if it does not, stop.

Then, in order:

```bash
cd contracts

# 1. Preview the declare fee. Reads-only, no state change.
sncast --profile sotto-mainnet declare \
  --contract-name SottoVesuAnonymizer \
  --package sotto_vesu_anonymizer \
  --network mainnet \
  --dry-run --detailed

# 2. Declare the class. Waits for L2 acceptance.
sncast --profile sotto-mainnet --wait declare \
  --contract-name SottoVesuAnonymizer \
  --package sotto_vesu_anonymizer \
  --network mainnet

# 3. Deploy the class. Constructor calldata is empty. The output prints the
#    deployed contract address — that is the value for
#    VITE_VESU_LENDING_HELPER_ADDRESS.
sncast --profile sotto-mainnet --wait deploy \
  --class-hash 0x0424a607bd691a277eba542917d6378a5e059db49829d881b19af3eabb3b8ff4 \
  --network mainnet
```

The class hash above is the current release build; regenerate it from your
frozen SHA with `sncast utils class-hash --sierra-file …` and use *that*
value if it differs.

## Post-deployment checks

- Verify the deployed source and class on an explorer
- Deployed class hash equals the class hash printed by
  `sncast utils class-hash` locally
- Smoke-test with the smallest amount that produces a real lend (about 12–15
  STRK — 6 STRK covers the pool fee, ~6 STRK is the actual deposit)
- Confirm the helper's balance and every token allowance from the helper are
  zero after the smoke test — anything non-zero can be swept by another caller
- Vesu deposit and redeem outputs match the amounts the wallet showed
- Stop enabling the frontend route if any value disagrees

## Enable the Mainnet Vesu route in the frontend

The helper is deployed, so this is a single-variable flip. The verified
Prime STRK and Prime USDC vaults are baked into `build:mainnet` — you only
need to set the helper address.

1. Confirm vault addresses still match chain state:
   ```bash
   npm run mainnet:verify-addresses
   ```
   Zero failures required. This checks `asset()`, share decimals, and the
   absence of ERC-7540 async entrypoints for each vault.

2. Build the frontend, substituting the address printed by `sncast deploy`:
   ```bash
    VITE_VESU_LENDING_HELPER_ADDRESS=0x06277c357edf60e9acbbd5a9efaeb8fcb0d0b0daf1f06801ed94d4247a9b1e6a npm run build:mainnet
   ```
   Or set it via your deploy target's env-var UI (Railway, Vercel, etc).

3. Serve the resulting `dist/` and smoke-test with the smallest lend that
   produces a real deposit — see the post-deployment checks above.

If `mainnet:verify-addresses` fails on any vault, stop. The Vesu route
fails-closed on both a missing helper and an empty allowlist, so shipping
without either is safe — the UI hides the section entirely and users still
get shield / transfer / withdraw.
