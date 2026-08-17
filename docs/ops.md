# Operations and incident readiness

## Supported surface

- Networks: Starknet Mainnet and Starknet Sepolia only
- Wallet API: `0.10.3` or newer
- Assets: configured STRK and native USDC
- Vesu route: disabled unless both helper and vault configuration validate
- Ethereum / Base / Arbitrum: remain disabled until the Privacy Bridge,
  prover, indexer, relayer/paymaster, and security work are complete

## Known privacy limitations

- Deposit and withdrawal edges are public
- Helper activity and open-note output amounts are public
- Deposit screening is required
- Viewing keys stay in the wallet; Sotto never custodied them
- The helper does not prove that its caller is the STRK20 pool

## Known economic risks

- Vesu curator, oracle, pause, fee, and upgrade risk
- Helper leftover balances are spendable by any later caller
- Fee-on-transfer, rebasing, callback, and async ERC-7540 vaults are
  unsupported
- The previous Blast public RPC is dead; use a monitored provider

## Monitoring

Watch at least:

- Helper `privacy_invoke` failures and unexpected approvals
- Transaction revert rate
- Wallet balance-query errors versus explorer/indexer balances
- Vault pause, utilization, and oracle health
- RPC latency, error rate, and chain-id mismatches

## RPC

- Development fallbacks: Mainnet `https://rpc.starknet.lava.build`, Sepolia
  `https://api.cartridge.gg/x/starknet/sepolia`
- Production must use a paid, rate-limited provider plus a failover URL
- Do not put authenticated RPC credentials in `VITE_` variables

## Disable the Vesu route quickly

1. In Railway, set `VITE_VESU_LENDING_HELPER_ADDRESS=` and
   `VITE_VESU_VAULTS={"vaults":[]}`.
2. Redeploy. The frontend fail-closes the route when either value is missing
   or malformed.
3. Confirm the public bundle no longer embeds a helper address.

## Failure behavior

| Event | User-visible behavior | Operator action |
| --- | --- | --- |
| Failed proof | Wallet/error toast; no receipt tracked | Retry after wallet upgrade or input correction |
| Reverted invoke | Activity row becomes `Reverted` | Inspect explorer; do not retry blindly |
| RPC timeout | Confirmation stays `Confirming` or balance sync fails | Switch RPC; ask user to refresh |
| Stale balances | Dashboard shows last wallet response | Manual refresh; compare explorer |
| Interrupted session | In-memory activity list is lost | User checks explorer; no fabricated history |

## Railway rollback

- Keep the previous successful deployment available
- Revert the service to that deployment if a bad config is promoted
- Production promotion requires a named approver

## Incident contacts

Fill these before go-live:

- On-call:
- Status page / public channel:
- Auditor / security contact:

## Mainnet deployer procedure

- Dedicated account, hardware-backed or multisig preferred
- Recovery: document who can rotate the deployer and where the backup lives
- Incident: if the deployer is exposed, do not declare new classes with it;
  rotate and treat every unfinalized transaction as hostile
