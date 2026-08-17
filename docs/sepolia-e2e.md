# Sepolia end-to-end evidence

Date: 2026-08-17.

Address review: `docs/sepolia-addresses.md`.
Helper deployment: `docs/deployment.md`.

## Status

| Checklist item | Result |
| --- | --- |
| Independently review token, STRK20 pool, and sync Vesu vault addresses | Done — first reviewer |
| Configure the Sepolia frontend | Done — official STRK + Circle USDC + helper; vaults empty |
| Shield / private transfer / withdraw with a privacy wallet | **Blocked** — no Wallet API 0.10.3 wallet in this environment |
| Vesu deposit / redeem with a privacy wallet | **Blocked** — no official-token vToken, and no privacy wallet |
| Mainnet wallet rejected by the Sepolia build | Automated gate proven; live wallet click still required |
| Wallet reject, dry-run, proof, revert, RPC timeout, interrupted session | Automated + code-path evidence; live wallet prompts still required |
| Reconcile STRK20 notes and Vesu balances | Idle helper/vault state reconciled; no private notes exist yet |

Do not treat this file as a completed live Sepolia campaign.

## What was executed here

1. On-chain review of every candidate address against `SN_SEPOLIA`.
2. Frontend Sepolia values written into `.env.example`.
3. `gateLiveWallet` extracted and unit-tested, including Mainnet-on-Sepolia.
4. `npm run sepolia:verify-addresses` — class hashes, metadata, helper zeros.
5. Sepolia production build (`npm run build:sepolia`, bundle
   `dist/assets/index-BN2TP9qf.js`): embeds official STRK, Circle USDC, and
   the helper; does not embed Vesu vUSDC/vSTRK, Vesu mock USDC, the rejected
   Circle quickstart USDC, or Mainnet native USDC. The minified gate still
   contains `Wrong network` / `This deployment is configured for Starknet`.

## Frontend configuration

```dotenv
VITE_STRK20_NETWORK=sepolia
VITE_SEPOLIA_STRK_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
VITE_SEPOLIA_USDC_ADDRESS=0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343
VITE_VESU_LENDING_HELPER_ADDRESS=0x03ef9a499a3be674f6b2af553adf2ab1d2d5fe130002e4e09113f5cfd1adc297
VITE_VESU_VAULTS={"vaults":[]}
```

A Sepolia build with this file reports the Vesu route as configured with
**0 verified vaults**. That is intentional. See the mock-token profile in
`docs/sepolia-addresses.md` if a later reviewer wants to test Vesu against
Vesu's own test tokens.

## Failure-path evidence (no live wallet)

| Event | Code path | Automated check |
| --- | --- | --- |
| Mainnet wallet on Sepolia build | `gateLiveWallet` → `Wrong network` | `src/walletGuards.test.ts` |
| Wallet missing privacy API | `Unsupported wallet` | same |
| User rejects connect / no account | wallet modal; `useWallet` catch | connect error is surfaced in the modal |
| Dry-run failure | `lendToVesu` / `unlendFromVesu` await `strk20PrepareInvoke` before submit | no receipt is created if prepare throws |
| Proof / wallet failure | `runAssetAction` / `runLend` catch → `Transaction failed` toast | no activity row without a hash |
| Transaction revert | `confirmTransaction` → status `Reverted` + thrown error | `transactionStatus(false)` / `revertedTransactionError()` |
| RPC timeout | `waitForTransaction` keeps the row at `Confirming` | documented in `docs/ops.md`; no fake confirmation |
| Interrupted session | `transactions` is React state only | `interruptedSessionState()` asserts no reconstructed history |

## Remaining live steps

Use a Ready (or other) wallet on **Starknet Sepolia** that reports Wallet API
`0.10.3+`. Fund it with official Sepolia STRK from
https://starknet-faucet.vercel.app/ and Circle test USDC from
https://faucet.circle.com/.

1. `cp .env.example .env.local` and keep only the Sepolia block.
2. `npm run dev` and open `http://localhost:5173`.
3. Connect the Sepolia privacy wallet. Confirm the dashboard says `Sepolia`
   and `STRK20 ready`.
4. Connect a Mainnet wallet (or switch the same wallet to Mainnet) and submit
   Deposit. Expect `Wrong network`.
5. Shield a small official STRK amount. Record the Voyager tx.
6. Private-transfer a slice to a second registered Sepolia privacy address.
7. Withdraw a slice to a fresh public Sepolia address.
8. Reject a wallet prompt and confirm only a toast appears.
9. Submit an amount larger than the shielded balance and confirm the wallet
   dry-run or proof fails without a confirmed receipt.
10. Interrupt the tab during `Confirming` and recover from Voyager, not from
    a rebuilt activity list.

Vesu deposit/redeem cannot be added to that list until a reviewer allowlists
a vault whose `asset()` is official STRK or Circle USDC.

## Idle-state reconciliation

Recorded 2026-08-17 against the Cartridge Sepolia RPC:

| Account | Token | Balance | Allowance to STRK20 pool |
| --- | --- | --- | --- |
| Helper | official STRK | 0 | 0 |
| Helper | Circle USDC | 0 | 0 |
| Helper | Vesu mock STRK / USDC | 0 | 0 |
| Helper | vSTRK / vUSDC | 0 | 0 |

There are no Sotto-generated STRK20 notes to compare with the indexer yet.
After a live campaign, reconcile:

- Wallet `strk20Balances` vs the STRK20 explorer/indexer for the same tokens
- Helper balances still zero after each successful lend/redeem
- Vault `balance_of(helper)` still zero
- Deposit/withdraw edges on Voyager match the intended public amounts
