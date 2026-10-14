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

import expected from "../../../fixtures/lending-actions-v2.8.3.json";
import { mainnetAccount, mainnetBankMap, mainnetBanks } from "../../../helpers/mainnet";

import {
  makeCloseAccountIx,
  makeCreateAccountIx,
} from "~/services/account/actions/account-lifecycle";
import { makeBorrowIx } from "~/services/account/actions/borrow";
import { makeDepositIx } from "~/services/account/actions/deposit";
import { makeBeginFlashLoanIx, makeEndFlashLoanIx } from "~/services/account/actions/flash-loan";
import { makeRepayIx } from "~/services/account/actions/repay";
import { makeWithdrawIx } from "~/services/account/actions/withdraw";
import type { BankIntegrationMetadataMap } from "~/types";
import { decodeDriftSpotMarket, SpotBalanceType } from "~/vendor/drift";
import { decodeJupLendingState } from "~/vendor/jup-lend";

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const marginfiAccount = mainnetAccount();
const authority = createNoopSigner(marginfiAccount.authority);
const group = marginfiAccount.group;
const driftSpotMarket = decodeDriftSpotMarket(base64.encode(expected.venues.driftSpotMarket));
const jupLendingState = decodeJupLendingState(
  address("BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3"),
  base64.encode(expected.venues.jupLendingState)
);

const bankMetadataMap = {
  [mainnetBanks.drift.address]: {
    driftStates: {
      spotMarketState: driftSpotMarket,
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
    },
  },
  [mainnetBanks.juplend.address]: { jupLendStates: { lendingState: jupLendingState } },
} as BankIntegrationMetadataMap;

const deposit = { programAddress, tokenProgram, marginfiAccount, authority, bankMetadataMap };
const withdraw = { ...deposit, bankMap: mainnetBankMap };

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
    deposit: () => makeDepositIx({ ...deposit, bank: mainnetBanks.default, amount: 12.345678 }),
    depositSolWrap: () =>
      makeDepositIx({
        ...deposit,
        bank: mainnetBanks.sol,
        amount: 1.5,
        opts: { wSolBalanceUi: 0.25 },
      }),
    repaySolAll: () =>
      makeRepayIx({ ...deposit, bank: mainnetBanks.sol, amount: 0.75, repayAll: true }),
    withdrawAll: () =>
      makeWithdrawIx({ ...withdraw, bank: mainnetBanks.default, amount: 5, withdrawAll: true }),
    borrowSol: () => makeBorrowIx({ ...withdraw, bank: mainnetBanks.sol, amount: 0.1 }),
    driftDeposit: () => makeDepositIx({ ...deposit, bank: mainnetBanks.drift, amount: 3 }),
    driftWithdrawAll: () =>
      makeWithdrawIx({ ...withdraw, bank: mainnetBanks.drift, amount: 1, withdrawAll: true }),
    juplendDeposit: () => makeDepositIx({ ...deposit, bank: mainnetBanks.juplend, amount: 9 }),
    juplendWithdraw: () => makeWithdrawIx({ ...withdraw, bank: mainnetBanks.juplend, amount: 2 }),
    createAccount: () =>
      makeCreateAccountIx({
        programAddress,
        authority,
        group,
        accountIndex: 4,
        thirdPartyId: 7,
      }),
    closeAccount: () => makeCloseAccountIx({ programAddress, marginfiAccount, authority }),
    beginFlashloan: () =>
      makeBeginFlashLoanIx({ programAddress, marginfiAccount, authority, endIndex: 5 }),
    endFlashloan: () =>
      makeEndFlashLoanIx({
        programAddress,
        marginfiAccount,
        authority,
        bankMap: mainnetBankMap,
        activeBanks: [mainnetBanks.default.address, mainnetBanks.sol.address],
      }),
  };

  it.each(Object.keys(cases) as (keyof typeof cases)[])("%s matches v2.8.3", async (name) => {
    const ixs = await cases[name]();
    expect(toWire(Array.isArray(ixs) ? ixs : [ixs])).toEqual(expected.cases[name]);
  });
});
