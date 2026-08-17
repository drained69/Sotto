# Unsupported token and vault classes

These cases were exercised or explicitly ruled out by the helper tests in
`contracts/packages/sotto_vesu_anonymizer/src/tests.cairo`.

| Class | Helper behavior | Product rule |
| --- | --- | --- |
| Zero token / zero amount / equal tokens | Revert | Frontend must not construct these calls |
| Vault credits zero output | `ZERO_OUT_AMOUNT` | Do not allowlist empty or broken vaults |
| Output does not fit `u128` | `RECEIVED_AMOUNT_OVERFLOW` | Open-note amounts are `u128` |
| `approve` reverts or returns false | Transaction reverts when the vault later pulls | Standard ERC-20 only |
| `transferFrom` reverts or returns false | Vault/helper reverts | Standard ERC-20 only |
| Fee-on-transfer | Vault sees a short received amount and reverts | Unsupported |
| Rebasing | Balance-delta measurement can over/under count | Unsupported; do not allowlist |
| Malicious vault callback | `REENTRANCY` | Unsupported; allowlist reviewed vaults only |
| Async ERC-7540 Vesu Vaults | Cannot complete redeem in one tx | Unsupported |
| Leftover helper balances | Any caller can `privacy_invoke` them | Operators must not leave funds in the helper |
| After a successful emptied call | A later unauthorized deposit reverts | No residual steal path if the helper is empty |

Allowance notes:

- Each successful call replaces the output allowance with the current
  measured amount.
- A vault revert after `approve` rolls the entire Starknet transaction back,
  including that allowance.
