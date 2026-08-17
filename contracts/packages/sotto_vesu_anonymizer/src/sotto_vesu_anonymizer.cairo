//! Sotto's Vesu lending anonymizer.
//!
//! This is based on the reference implementation in the Starknet Privacy
//! repository. It holds no user balances and is intended to be called by the
//! STRK20 pool through `privacy_invoke` during an atomic private transaction.
//! The only persistent storage is a reentrancy lock used for the duration of
//! an invoke.

use privacy::objects::OpenNoteDeposit;
use starknet::ContractAddress;

#[starknet::interface]
pub trait IVToken<T> {
    fn deposit(ref self: T, assets: u256, receiver: ContractAddress) -> u256;
    /// Burns `shares` from `owner` and sends the corresponding underlying to `receiver`.
    ///
    /// This is `redeem`, not `withdraw`: on Withdraw the caller supplies a vToken *share* count
    /// (that is what the shielded note holds), whereas ERC-4626 `withdraw` takes an *underlying
    /// asset* amount. Using `withdraw` here would burn `convertToShares(amount)` shares and strand
    /// the remainder in this stateless, permissionless contract.
    fn redeem(ref self: T, shares: u256, receiver: ContractAddress, owner: ContractAddress) -> u256;
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum LendingOperation {
    Deposit,
    Withdraw,
}

#[starknet::interface]
pub trait ISottoVesuAnonymizer<T> {
    fn privacy_invoke(
        ref self: T,
        operation: LendingOperation,
        in_token: ContractAddress,
        out_token: ContractAddress,
        amount: u256,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

pub mod errors {
    pub const ZERO_IN_TOKEN: felt252 = 'ZERO_IN_TOKEN';
    pub const ZERO_OUT_TOKEN: felt252 = 'ZERO_OUT_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const TOKENS_EQUAL: felt252 = 'TOKENS_EQUAL';
    pub const RECEIVED_AMOUNT_OVERFLOW: felt252 = 'RECEIVED_AMOUNT_OVERFLOW';
    pub const ZERO_OUT_AMOUNT: felt252 = 'ZERO_OUT_AMOUNT';
    pub const REENTRANCY: felt252 = 'REENTRANCY';
}

#[starknet::contract]
pub mod SottoVesuAnonymizer {
    use core::num::traits::Zero;
    use openzeppelin::interfaces::token::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use privacy::objects::OpenNoteDeposit;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        ISottoVesuAnonymizer, IVTokenDispatcher, IVTokenDispatcherTrait, LendingOperation, errors,
    };

    #[storage]
    struct Storage {
        locked: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    pub impl SottoVesuAnonymizerImpl of ISottoVesuAnonymizer<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: LendingOperation,
            in_token: ContractAddress,
            out_token: ContractAddress,
            amount: u256,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(!self.locked.read(), errors::REENTRANCY);
            self.locked.write(true);

            assert(in_token.is_non_zero(), errors::ZERO_IN_TOKEN);
            assert(out_token.is_non_zero(), errors::ZERO_OUT_TOKEN);
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);
            assert(in_token != out_token, errors::TOKENS_EQUAL);

            let self_addr = get_contract_address();
            let privacy_addr = get_caller_address();
            let in_erc20 = IERC20Dispatcher { contract_address: in_token };
            let out_erc20 = IERC20Dispatcher { contract_address: out_token };
            let balance_before = out_erc20.balance_of(account: self_addr);

            match operation {
                LendingOperation::Deposit => {
                    in_erc20.approve(spender: out_token, :amount);
                    IVTokenDispatcher { contract_address: out_token }
                        .deposit(assets: amount, receiver: self_addr)
                },
                LendingOperation::Withdraw => {
                    // `amount` is the vToken share count to redeem.
                    IVTokenDispatcher { contract_address: in_token }
                        .redeem(shares: amount, receiver: self_addr, owner: self_addr)
                },
            }

            let balance_after = out_erc20.balance_of(account: self_addr);
            let out_amount: u128 = (balance_after - balance_before)
                .try_into()
                .expect(errors::RECEIVED_AMOUNT_OVERFLOW);
            assert(out_amount.is_non_zero(), errors::ZERO_OUT_AMOUNT);
            out_erc20.approve(spender: privacy_addr, amount: out_amount.into());
            self.locked.write(false);

            [OpenNoteDeposit { note_id, token: out_token, amount: out_amount }].span()
        }
    }
}
