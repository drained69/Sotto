use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockToken<T> {
    fn mint(ref self: T, recipient: ContractAddress, amount: u256);
    fn set_mode(ref self: T, mode: u8);
    fn set_fee_bps(ref self: T, fee_bps: u256);
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

/// Token behaviour flags used by the helper tests.
/// 0 standard, 1 approve reverts, 2 approve returns false, 3 transfer_from reverts,
/// 4 transfer_from returns false, 5 fee-on-transfer.
pub const TOKEN_STANDARD: u8 = 0;
pub const TOKEN_APPROVE_REVERTS: u8 = 1;
pub const TOKEN_APPROVE_RETURNS_FALSE: u8 = 2;
pub const TOKEN_TRANSFER_FROM_REVERTS: u8 = 3;
pub const TOKEN_TRANSFER_FROM_RETURNS_FALSE: u8 = 4;
pub const TOKEN_FEE_ON_TRANSFER: u8 = 5;

#[starknet::contract]
pub mod MockToken {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use super::IMockToken;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        mode: u8,
        fee_bps: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.fee_bps.write(100);
    }

    fn spend_allowance(
        ref self: ContractState, owner: ContractAddress, spender: ContractAddress, amount: u256,
    ) {
        let current = self.allowances.entry((owner, spender)).read();
        assert(current >= amount, 'INSUFFICIENT_ALLOWANCE');
        self.allowances.entry((owner, spender)).write(current - amount);
    }

    fn move(
        ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) {
        let sender_balance = self.balances.entry(sender).read();
        assert(sender_balance >= amount, 'INSUFFICIENT_BALANCE');
        self.balances.entry(sender).write(sender_balance - amount);
        self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
    }

    #[abi(embed_v0)]
    impl MockTokenImpl of IMockToken<ContractState> {
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
        }

        fn set_mode(ref self: ContractState, mode: u8) {
            self.mode.write(mode);
        }

        fn set_fee_bps(ref self: ContractState, fee_bps: u256) {
            self.fee_bps.write(fee_bps);
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let mode = self.mode.read();
            assert(mode != 1, 'APPROVE_REVERTED');
            if mode == 2 {
                return false;
            }
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            move(ref self, get_caller_address(), recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let mode = self.mode.read();
            assert(mode != 3, 'TRANSFER_FROM_REVERTED');
            if mode == 4 {
                return false;
            }
            spend_allowance(ref self, sender, get_caller_address(), amount);
            if mode == 5 {
                let fee = amount * self.fee_bps.read() / 10000;
                let received = amount - fee;
                let sender_balance = self.balances.entry(sender).read();
                assert(sender_balance >= amount, 'INSUFFICIENT_BALANCE');
                self.balances.entry(sender).write(sender_balance - amount);
                self
                    .balances
                    .entry(recipient)
                    .write(self.balances.entry(recipient).read() + received);
                return true;
            }
            move(ref self, sender, recipient, amount);
            true
        }
    }
}

#[starknet::interface]
pub trait IMockVault<T> {
    fn mint(ref self: T, recipient: ContractAddress, amount: u256);
    fn set_fail_deposit(ref self: T, fail: bool);
    fn set_fail_redeem(ref self: T, fail: bool);
    fn deposit(ref self: T, assets: u256, receiver: ContractAddress) -> u256;
    fn redeem(ref self: T, shares: u256, receiver: ContractAddress, owner: ContractAddress) -> u256;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn last_deposit_assets(self: @T) -> u256;
    fn last_redeem_shares(self: @T) -> u256;
    fn last_receiver(self: @T) -> ContractAddress;
    fn last_owner(self: @T) -> ContractAddress;
}

#[starknet::contract]
pub mod MockVault {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{IMockTokenDispatcher, IMockTokenDispatcherTrait, IMockVault};

    #[storage]
    struct Storage {
        underlying: ContractAddress,
        output_amount: u256,
        fail_deposit: bool,
        fail_redeem: bool,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        last_deposit_assets: u256,
        last_redeem_shares: u256,
        last_receiver: ContractAddress,
        last_owner: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, underlying: ContractAddress, output_amount: u256) {
        self.underlying.write(underlying);
        self.output_amount.write(output_amount);
    }

    fn share_output(self: @ContractState, _assets: u256) -> u256 {
        self.output_amount.read()
    }

    fn burn_shares(ref self: ContractState, owner: ContractAddress, shares: u256) {
        let balance = self.balances.entry(owner).read();
        assert(balance >= shares, 'INSUFFICIENT_SHARES');
        self.balances.entry(owner).write(balance - shares);
    }

    #[abi(embed_v0)]
    impl MockVaultImpl of IMockVault<ContractState> {
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
        }

        fn set_fail_deposit(ref self: ContractState, fail: bool) {
            self.fail_deposit.write(fail);
        }

        fn set_fail_redeem(ref self: ContractState, fail: bool) {
            self.fail_redeem.write(fail);
        }

        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            assert(!self.fail_deposit.read(), 'VAULT_DEPOSIT_REVERTED');
            let underlying = self.underlying.read();
            if underlying.is_non_zero() {
                let token = IMockTokenDispatcher { contract_address: underlying };
                let before = token.balance_of(get_contract_address());
                let ok = token
                    .transfer_from(
                        sender: get_caller_address(),
                        recipient: get_contract_address(),
                        amount: assets,
                    );
                assert(ok, 'TRANSFER_FROM_FALSE');
                let received = token.balance_of(get_contract_address()) - before;
                assert(received == assets, 'FEE_ON_TRANSFER');
            }
            let output = share_output(@self, assets);
            self.last_deposit_assets.write(assets);
            self.last_receiver.write(receiver);
            self.balances.entry(receiver).write(self.balances.entry(receiver).read() + output);
            output
        }

        fn redeem(
            ref self: ContractState,
            shares: u256,
            receiver: ContractAddress,
            owner: ContractAddress,
        ) -> u256 {
            assert(!self.fail_redeem.read(), 'VAULT_REDEEM_REVERTED');
            assert(owner == get_caller_address(), 'OWNER_NOT_CALLER');
            burn_shares(ref self, owner, shares);
            let output = share_output(@self, shares);
            let underlying = self.underlying.read();
            if underlying.is_non_zero() {
                IMockTokenDispatcher { contract_address: underlying }
                    .transfer(recipient: receiver, amount: output);
            }
            self.last_redeem_shares.write(shares);
            self.last_receiver.write(receiver);
            self.last_owner.write(owner);
            output
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            burn_shares(ref self, get_caller_address(), amount);
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let current = self.allowances.entry((sender, spender)).read();
            assert(current >= amount, 'INSUFFICIENT_ALLOWANCE');
            self.allowances.entry((sender, spender)).write(current - amount);
            burn_shares(ref self, sender, amount);
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
            true
        }

        fn last_deposit_assets(self: @ContractState) -> u256 {
            self.last_deposit_assets.read()
        }

        fn last_redeem_shares(self: @ContractState) -> u256 {
            self.last_redeem_shares.read()
        }

        fn last_receiver(self: @ContractState) -> ContractAddress {
            self.last_receiver.read()
        }

        fn last_owner(self: @ContractState) -> ContractAddress {
            self.last_owner.read()
        }
    }
}

#[starknet::interface]
pub trait IReentrantVault<T> {
    fn deposit(ref self: T, assets: u256, receiver: ContractAddress) -> u256;
    fn redeem(ref self: T, shares: u256, receiver: ContractAddress, owner: ContractAddress) -> u256;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}

/// Vault that re-enters the helper during `deposit`. Used to document callback risk.
#[starknet::contract]
pub mod ReentrantVault {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use crate::sotto_vesu_anonymizer::{
        ISottoVesuAnonymizerDispatcher, ISottoVesuAnonymizerDispatcherTrait, LendingOperation,
    };
    use super::IReentrantVault;

    #[storage]
    struct Storage {
        helper: ContractAddress,
        underlying: ContractAddress,
        entered: bool,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, helper: ContractAddress, underlying: ContractAddress) {
        self.helper.write(helper);
        self.underlying.write(underlying);
    }

    #[abi(embed_v0)]
    impl ReentrantVaultImpl of IReentrantVault<ContractState> {
        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            if !self.entered.read() {
                self.entered.write(true);
                ISottoVesuAnonymizerDispatcher { contract_address: self.helper.read() }
                    .privacy_invoke(
                        LendingOperation::Deposit,
                        self.underlying.read(),
                        starknet::get_contract_address(),
                        assets,
                        1,
                    );
            }
            self.balances.entry(receiver).write(self.balances.entry(receiver).read() + assets);
            assets
        }

        fn redeem(
            ref self: ContractState,
            shares: u256,
            receiver: ContractAddress,
            owner: ContractAddress,
        ) -> u256 {
            let _ = (shares, receiver, owner);
            0
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            true
        }
    }
}
