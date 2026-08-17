# Independent security audit scope

An independent Starknet/Cairo reviewer must be engaged before Mainnet. This
file is the scope packet, not a substitute for that review.

## Commit under audit

Audit the exact release commit after it is frozen. The current last committed
SHA is `0c3821fa3a6d81cd53ff37f75e32970b6c186378`, but the working tree still
contains helper, test, and frontend changes. Do not audit a dirty tree.

Pinned privacy revision:

```
66e3caae8c0201227a6719696d004e30d90aea65
```

## In scope

- `contracts/packages/sotto_vesu_anonymizer/src/sotto_vesu_anonymizer.cairo`
- Helper constructor, storage, and `privacy_invoke` control flow
- Vesu ABI assumptions: sync `deposit` and share-denominated `redeem`
- STRK20 action ordering in `src/strk20.ts` (`withdraw` + `OPEN` + `invoke`)
- Caller/trust model: any address may call the helper
- Approval lifetime on input and output tokens
- Reentrancy lock
- Frontend address configuration and fail-closed vault parsing
- Sepolia evidence once it exists

## Explicit assumptions to challenge

- The STRK20 pool atomically funds the helper and then pulls the approved
  output in the same transaction.
- Configured vaults are not fee-on-transfer, rebasing, callback, or async.
- Users review Wallet API calldata before authorizing.
- Operators never leave balances in the helper.

## Exit criteria

- All Critical/High findings resolved
- Auditor verifies remediations
- Lower-severity risks are accepted in writing
- Final signed report is tied to the audited commit SHA

Any later source or dependency change requires documented impact review and
may require a re-audit.
