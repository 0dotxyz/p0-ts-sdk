import {
  address,
  createNoopSigner,
  getBase16Decoder,
  getBase64Encoder,
  isSignerRole,
  isWritableRole,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import bankFixtures from "../../bank/fixtures/mainnet-banks.json";
import accountFixtures from "../fixtures/mainnet-accounts.json";
import expected from "../fixtures/lending-actions-v2.8.3.json";

import { decodeBank, decodeMarginfiAccount } from "~/accounts";
import {
  makeCloseMarginfiAccountIx,
  makeCreateMarginfiAccountIx,
} from "~/services/account/actions/account-lifecycle";
import { makeBorrowIx } from "~/services/account/actions/borrow";
import {
  makeDepositIx,
  makeDriftDepositIx,
  makeJuplendDepositIx,
} from "~/services/account/actions/deposit";
import { makeBeginFlashLoanIx, makeEndFlashLoanIx } from "~/services/account/actions/flash-loan";
import { makeRepayIx } from "~/services/account/actions/repay";
import {
  makeDriftWithdrawIx,
  makeJuplendWithdrawIx,
  makeWithdrawIx,
} from "~/services/account/actions/withdraw";
import { parseMarginfiAccountRaw } from "~/services/account/utils/deserialize.utils";
import { parseBankRaw } from "~/services/bank/utils/deserialize.utils";
import { decodeDriftSpotMarket, SpotBalanceType } from "~/vendor/drift";
import { decodeJupLendingState } from "~/vendor/jup-lend";

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Mainnet account with an asset in the default bank fixture and a liability in the SOL bank
// fixture; its other positions are dropped so every active bank is loaded.
const banks = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    parseBankRaw(address(bankAddress), decodeBank(base64.encode(data))),
  ])
);
const banksMap = new Map(Object.values(banks).map((bank) => [bank.address, bank]));
const parsed = parseMarginfiAccountRaw(
  address(accountFixtures[1].address),
  decodeMarginfiAccount(base64.encode(accountFixtures[1].data))
);
const marginfiAccount = {
  ...parsed,
  balances: parsed.balances.filter((balance) => banksMap.has(balance.bankPk)),
};
const authority = createNoopSigner(marginfiAccount.authority);
const group = marginfiAccount.group;
const driftSpotMarket = decodeDriftSpotMarket(base64.encode(expected.venues.driftSpotMarket));
const jupLendingState = decodeJupLendingState(
  address("BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3"),
  base64.encode(expected.venues.jupLendingState)
);

const deposit = {
  programAddress,
  tokenProgram,
  accountAddress: marginfiAccount.address,
  authority,
  group,
};
const withdraw = { programAddress, tokenProgram, bankMap: banksMap, marginfiAccount, authority };

// The official token client adds SysvarRent to SyncNative; the v2.8.3 builder didn't.
const toWire = (ixs: Instruction[]) =>
  ixs.map((ix) => ({
    programAddress: ix.programAddress,
    accounts: (ix.accounts ?? [])
      .filter(
        (meta) =>
          !(
            ix.programAddress === tokenProgram &&
            meta.address === "SysvarRent111111111111111111111111111111111"
          )
      )
      .map((meta) => [meta.address, isSignerRole(meta.role), isWritableRole(meta.role)]),
    data: getBase16Decoder().decode(ix.data ?? new Uint8Array()),
  }));

// Expected instructions were built by the v2.8.3 (Anchor) builders from the same inputs.
describe("lending action instructions", () => {
  const cases: Record<keyof typeof expected.cases, () => Promise<Instruction | Instruction[]>> = {
    deposit: () => makeDepositIx({ ...deposit, bank: banks.default, amount: 12.345678 }),
    depositSolWrap: () =>
      makeDepositIx({ ...deposit, bank: banks.sol, amount: 1.5, opts: { wSolBalanceUi: 0.25 } }),
    repaySolAll: () => makeRepayIx({ ...deposit, bank: banks.sol, amount: 0.75, repayAll: true }),
    withdrawAll: () =>
      makeWithdrawIx({ ...withdraw, bank: banks.default, amount: 5, withdrawAll: true }),
    borrowSol: () => makeBorrowIx({ ...withdraw, bank: banks.sol, amount: 0.1 }),
    driftDeposit: () =>
      makeDriftDepositIx({
        ...deposit,
        bank: banks.drift,
        amount: 3,
        driftMarketIndex: driftSpotMarket.marketIndex,
        driftOracle: driftSpotMarket.oracle,
      }),
    driftWithdrawAll: () =>
      makeDriftWithdrawIx({
        ...withdraw,
        bank: banks.drift,
        amount: 1,
        driftSpotMarket,
        userRewards: [
          {
            oracle: driftSpotMarket.oracle,
            marketIndex: driftSpotMarket.marketIndex,
            spotMarket: driftSpotMarket.pubkey,
            mint: driftSpotMarket.mint,
            spotPosition: {
              scaledBalance: 0n,
              openBids: 0n,
              openAsks: 0n,
              cumulativeDeposits: 0n,
              marketIndex: driftSpotMarket.marketIndex,
              balanceType: SpotBalanceType.Deposit,
              openOrders: 0,
              padding: new Uint8Array(4),
            },
          },
        ],
        withdrawAll: true,
      }),
    juplendDeposit: () => makeJuplendDepositIx({ ...deposit, bank: banks.juplend, amount: 9 }),
    juplendWithdraw: () =>
      makeJuplendWithdrawIx({ ...withdraw, bank: banks.juplend, amount: 2, jupLendingState }),
    createAccount: () =>
      makeCreateMarginfiAccountIx({
        programAddress,
        authority,
        group,
        accountIndex: 4,
        thirdPartyId: 7,
      }),
    closeAccount: () => makeCloseMarginfiAccountIx({ programAddress, marginfiAccount, authority }),
    beginFlashloan: () =>
      makeBeginFlashLoanIx(programAddress, marginfiAccount.address, 5, authority),
    endFlashloan: () =>
      makeEndFlashLoanIx(
        programAddress,
        marginfiAccount.address,
        group,
        [banks.default, banks.sol],
        authority
      ),
  };

  it.each(Object.keys(cases) as (keyof typeof cases)[])("%s matches v2.8.3", async (name) => {
    const ixs = await cases[name]();
    expect(toWire(Array.isArray(ixs) ? ixs : [ixs])).toEqual(expected.cases[name]);
  });
});
