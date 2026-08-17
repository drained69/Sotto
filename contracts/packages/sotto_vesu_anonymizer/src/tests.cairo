use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address, test_address,
};
use starknet::ContractAddress;
use crate::sotto_vesu_anonymizer::{
    ISottoVesuAnonymizerDispatcher, ISottoVesuAnonymizerDispatcherTrait, LendingOperation,
};
use crate::test_contracts::{
    IMockTokenDispatcher, IMockTokenDispatcherTrait, IMockVaultDispatcher,
    IMockVaultDispatcherTrait, TOKEN_APPROVE_RETURNS_FALSE, TOKEN_APPROVE_REVERTS,
    TOKEN_FEE_ON_TRANSFER, TOKEN_TRANSFER_FROM_RETURNS_FALSE, TOKEN_TRANSFER_FROM_REVERTS,
};

const NOTE_ID: felt252 = 77;

fn privacy_pool() -> ContractAddress {
    'privacy_pool'.try_into().unwrap()
}

fn attacker() -> ContractAddress {
    'attacker'.try_into().unwrap()
}

fn deploy_anonymizer() -> ContractAddress {
    let contract = declare("SottoVesuAnonymizer").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    address
}

fn deploy_token() -> ContractAddress {
    let contract = declare("MockToken").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    address
}

fn deploy_vault(underlying: ContractAddress, output_amount: u256) -> ContractAddress {
    let contract = declare("MockVault").unwrap().contract_class();
    let mut calldata = array![];
    underlying.serialize(ref calldata);
    output_amount.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

fn deploy_reentrant_vault(helper: ContractAddress, underlying: ContractAddress) -> ContractAddress {
    let contract = declare("ReentrantVault").unwrap().contract_class();
    let mut calldata = array![];
    helper.serialize(ref calldata);
    underlying.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

fn dispatcher(address: ContractAddress) -> ISottoVesuAnonymizerDispatcher {
    ISottoVesuAnonymizerDispatcher { contract_address: address }
}

fn fund(token: ContractAddress, recipient: ContractAddress, amount: u256) {
    IMockTokenDispatcher { contract_address: token }.mint(recipient, amount);
}

fn deposit(
    anonymizer: ContractAddress,
    underlying: ContractAddress,
    vault: ContractAddress,
    amount: u256,
    note_id: felt252,
) {
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, amount, note_id);
}

#[test]
#[should_panic(expected: ('ZERO_IN_TOKEN',))]
fn rejects_zero_input_token() {
    dispatcher(deploy_anonymizer())
        .privacy_invoke(
            LendingOperation::Deposit, 0.try_into().unwrap(), test_address(), 1, NOTE_ID,
        );
}

#[test]
#[should_panic(expected: ('ZERO_OUT_TOKEN',))]
fn rejects_zero_output_token() {
    dispatcher(deploy_anonymizer())
        .privacy_invoke(
            LendingOperation::Deposit, test_address(), 0.try_into().unwrap(), 1, NOTE_ID,
        );
}

#[test]
#[should_panic(expected: ('ZERO_AMOUNT',))]
fn rejects_zero_amount() {
    dispatcher(deploy_anonymizer())
        .privacy_invoke(
            LendingOperation::Deposit, test_address(), 'output'.try_into().unwrap(), 0, NOTE_ID,
        );
}

#[test]
#[should_panic(expected: ('TOKENS_EQUAL',))]
fn rejects_equal_tokens() {
    let token = test_address();
    dispatcher(deploy_anonymizer())
        .privacy_invoke(LendingOperation::Deposit, token, token, 1, NOTE_ID);
}

#[test]
fn deposit_approves_vault_and_returns_measured_shares() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let shares = 1250_u256;
    let prior_shares = 90_u256;
    let amount = 500_u256;
    let vault = deploy_vault(underlying, shares);
    fund(underlying, anonymizer, amount);
    IMockVaultDispatcher { contract_address: vault }.mint(anonymizer, prior_shares);
    start_cheat_caller_address(anonymizer, privacy_pool());

    let result = dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, amount, NOTE_ID);

    assert!(result.len() == 1);
    assert!(
        *result
            .at(
                0,
            ) == privacy::objects::OpenNoteDeposit {
                note_id: NOTE_ID, token: vault, amount: shares.try_into().unwrap(),
            },
    );
    assert!(
        IMockTokenDispatcher { contract_address: underlying }.allowance(anonymizer, vault) == 0,
    );
    assert!(
        IMockVaultDispatcher { contract_address: vault }
            .allowance(anonymizer, privacy_pool()) == shares,
    );
    assert!(IMockVaultDispatcher { contract_address: vault }.last_deposit_assets() == amount);
    assert!(IMockVaultDispatcher { contract_address: vault }.last_receiver() == anonymizer);
    assert!(
        IMockVaultDispatcher { contract_address: vault }.balance_of(anonymizer) == prior_shares
            + shares,
    );
    assert!(IMockTokenDispatcher { contract_address: underlying }.balance_of(anonymizer) == 0);
    assert!(IMockTokenDispatcher { contract_address: underlying }.balance_of(vault) == amount);
}

#[test]
fn repeated_deposits_replace_allowances_with_the_current_output() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let shares = 1250_u256;
    let vault = deploy_vault(underlying, shares);
    fund(underlying, anonymizer, 800);
    start_cheat_caller_address(anonymizer, privacy_pool());

    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 500, NOTE_ID);
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 300, NOTE_ID + 1);

    assert!(
        IMockTokenDispatcher { contract_address: underlying }.allowance(anonymizer, vault) == 0,
    );
    assert!(
        IMockVaultDispatcher { contract_address: vault }
            .allowance(anonymizer, privacy_pool()) == shares,
    );
    assert!(IMockVaultDispatcher { contract_address: vault }.balance_of(anonymizer) == shares * 2);
    assert!(IMockTokenDispatcher { contract_address: underlying }.balance_of(anonymizer) == 0);
}

#[test]
fn withdraw_redeems_exact_shares_and_returns_measured_underlying() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let assets = 777_u256;
    let shares = 321_u256;
    let vault = deploy_vault(underlying, assets);
    IMockVaultDispatcher { contract_address: vault }.mint(anonymizer, shares);
    fund(underlying, vault, assets);
    start_cheat_caller_address(anonymizer, privacy_pool());

    let result = dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Withdraw, vault, underlying, shares, NOTE_ID);

    assert!(
        *result
            .at(
                0,
            ) == privacy::objects::OpenNoteDeposit {
                note_id: NOTE_ID, token: underlying, amount: assets.try_into().unwrap(),
            },
    );
    assert!(IMockVaultDispatcher { contract_address: vault }.last_redeem_shares() == shares);
    assert!(IMockVaultDispatcher { contract_address: vault }.last_receiver() == anonymizer);
    assert!(IMockVaultDispatcher { contract_address: vault }.last_owner() == anonymizer);
    assert!(
        IMockTokenDispatcher { contract_address: underlying }
            .allowance(anonymizer, privacy_pool()) == assets,
    );
    assert!(IMockVaultDispatcher { contract_address: vault }.balance_of(anonymizer) == 0);
    assert!(IMockTokenDispatcher { contract_address: underlying }.balance_of(anonymizer) == assets);
}

#[test]
fn successful_calls_leave_no_stranded_input_or_output_after_pool_collects() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let shares = 400_u256;
    let amount = 250_u256;
    let vault = deploy_vault(underlying, shares);
    fund(underlying, anonymizer, amount);
    start_cheat_caller_address(anonymizer, privacy_pool());

    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, amount, NOTE_ID);

    start_cheat_caller_address(vault, privacy_pool());
    IMockVaultDispatcher { contract_address: vault }
        .transfer_from(anonymizer, privacy_pool(), shares);

    assert!(IMockTokenDispatcher { contract_address: underlying }.balance_of(anonymizer) == 0);
    assert!(IMockVaultDispatcher { contract_address: vault }.balance_of(anonymizer) == 0);
    assert!(IMockVaultDispatcher { contract_address: vault }.balance_of(privacy_pool()) == shares);
    assert!(
        IMockVaultDispatcher { contract_address: vault }.allowance(anonymizer, privacy_pool()) == 0,
    );
}

#[test]
#[should_panic(expected: ('ZERO_OUT_AMOUNT',))]
fn rejects_zero_vault_output() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 0);
    fund(underlying, anonymizer, 1);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer).privacy_invoke(LendingOperation::Deposit, underlying, vault, 1, NOTE_ID);
}

#[test]
#[should_panic(expected: ('RECEIVED_AMOUNT_OVERFLOW',))]
fn rejects_output_larger_than_open_note_amount() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 0x100000000000000000000000000000000);
    fund(underlying, anonymizer, 1);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer).privacy_invoke(LendingOperation::Deposit, underlying, vault, 1, NOTE_ID);
}

#[test]
#[should_panic(expected: ('APPROVE_REVERTED',))]
fn reverts_when_input_token_approve_reverts() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 10);
    IMockTokenDispatcher { contract_address: underlying }.set_mode(TOKEN_APPROVE_REVERTS);
    fund(underlying, anonymizer, 10);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 10, NOTE_ID);
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_ALLOWANCE',))]
fn reverts_when_input_token_approve_returns_false() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 10);
    IMockTokenDispatcher { contract_address: underlying }.set_mode(TOKEN_APPROVE_RETURNS_FALSE);
    fund(underlying, anonymizer, 10);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 10, NOTE_ID);
}

#[test]
#[should_panic(expected: ('TRANSFER_FROM_REVERTED',))]
fn reverts_when_vault_cannot_pull_input_tokens() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 10);
    IMockTokenDispatcher { contract_address: underlying }.set_mode(TOKEN_TRANSFER_FROM_REVERTS);
    fund(underlying, anonymizer, 10);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 10, NOTE_ID);
}

#[test]
#[should_panic(expected: ('VAULT_DEPOSIT_REVERTED',))]
fn reverts_when_vault_deposit_fails_after_approve() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 10);
    IMockVaultDispatcher { contract_address: vault }.set_fail_deposit(true);
    fund(underlying, anonymizer, 10);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 10, NOTE_ID);
}

#[test]
#[should_panic(expected: ('TRANSFER_FROM_FALSE',))]
fn reverts_when_transfer_from_returns_false() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 10);
    IMockTokenDispatcher { contract_address: underlying }
        .set_mode(TOKEN_TRANSFER_FROM_RETURNS_FALSE);
    fund(underlying, anonymizer, 10);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 10, NOTE_ID);
}

#[test]
#[should_panic(expected: ('FEE_ON_TRANSFER',))]
fn fee_on_transfer_tokens_are_unsupported() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 100);
    IMockTokenDispatcher { contract_address: underlying }.set_mode(TOKEN_FEE_ON_TRANSFER);
    fund(underlying, anonymizer, 100);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 100, NOTE_ID);
}

#[test]
fn leftover_balances_can_be_consumed_by_any_direct_caller() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let shares = 50_u256;
    let vault = deploy_vault(underlying, shares);
    fund(underlying, anonymizer, 50);
    start_cheat_caller_address(anonymizer, attacker());

    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 50, NOTE_ID);

    assert!(
        IMockVaultDispatcher { contract_address: vault }
            .allowance(anonymizer, attacker()) == shares,
    );
    assert!(IMockTokenDispatcher { contract_address: underlying }.balance_of(anonymizer) == 0);
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE',))]
fn unauthorized_caller_cannot_steal_after_a_successful_emptied_call() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 25);
    fund(underlying, anonymizer, 25);
    deposit(anonymizer, underlying, vault, 25, NOTE_ID);
    start_cheat_caller_address(anonymizer, attacker());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 25, NOTE_ID);
}

#[test]
#[should_panic(expected: ('REENTRANCY',))]
fn malicious_vault_callback_is_unsupported() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_reentrant_vault(anonymizer, underlying);
    fund(underlying, anonymizer, 10);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer)
        .privacy_invoke(LendingOperation::Deposit, underlying, vault, 10, NOTE_ID);
}

#[test]
#[should_panic(expected: ('ZERO_OUT_AMOUNT',))]
fn incorrect_vault_zero_share_credit_reverts() {
    let anonymizer = deploy_anonymizer();
    let underlying = deploy_token();
    let vault = deploy_vault(underlying, 0);
    fund(underlying, anonymizer, 8);
    start_cheat_caller_address(anonymizer, privacy_pool());
    dispatcher(anonymizer).privacy_invoke(LendingOperation::Deposit, underlying, vault, 8, NOTE_ID);
}
