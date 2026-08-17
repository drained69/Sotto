# Contract deployment runbook

Do not broadcast Mainnet transactions from this runbook until a named
approver signs section 13 of `todo.md`.

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
working-tree candidate hashes and class hash are recorded in `docs/release.md`.
Do not declare them until the source is frozen and the build, hashes, clean
checkout verification, and independent audit are repeated against that SHA.

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

## Mainnet (do not execute)

1. Create a dedicated hardware-backed or multisig deployer. Do not reuse the
   Sepolia key.
2. Store signing material outside the repository and outside every `VITE_`
   variable.
3. Add the account to `~/.starknet_accounts/` and keep the
   `sotto-mainnet` sncast profile pointed at that alias.
4. Fund only declaration plus deployment fees plus a small margin.
5. Second reviewer checks network, account, class hash, empty constructor,
   and fee limits.
6. Named approver authorizes broadcast.

```bash
# PREVIEW ONLY. Do not run against Mainnet until approval exists.
sncast --profile sotto-mainnet declare \
  --contract-name SottoVesuAnonymizer \
  --package sotto_vesu_anonymizer \
  --network mainnet \
  --dry-run --detailed

# After written approval:
# sncast --profile sotto-mainnet --wait declare \
#   --contract-name SottoVesuAnonymizer \
#   --package sotto_vesu_anonymizer \
#   --network mainnet
# sncast --profile sotto-mainnet --wait deploy \
#   --class-hash 0x<AUDITED_CLASS_HASH> \
#   --network mainnet
```

## Post-deployment checks

- Explorer source/class verification
- Class hash equals the audited build
- Controlled smoke test with a minimal amount only after review
- Helper balances and allowances are zero after the test
- Vesu deposit and redeem outputs reconcile exactly
- Stop before enabling the frontend route if anything disagrees
