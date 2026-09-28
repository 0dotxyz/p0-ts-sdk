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

import expected from "../services/account/fixtures/lending-actions-v2.8.3.json";
import accountFixtures from "../services/account/fixtures/mainnet-accounts.json";
import bankFixtures from "../services/bank/fixtures/mainnet-banks.json";

import { MarginfiAccount } from "~/models/account";
import { MarginfiAccountWrapper } from "~/models/account-wrapper";
import { Bank } from "~/models/bank";
import { Project0Client } from "~/models/client";
import { MarginfiGroup } from "~/models/group";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import type { BankIntegrationMetadataMap } from "~/types";
import { decodeDriftSpotMarket, SpotBalanceType } from "~/vendor/drift";
import { decodeJupLendingState } from "~/vendor/jup-lend";

// A client over the lending-actions fixtures: the wrapper's one-line calls must build the same
// instructions the v2.8.3 builders did from the explicit parameters.
const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const banks = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    Bank.fromBankType(decodeBank(address(bankAddress), base64.encode(data))),
  ])
);
const bankMap = new Map(Object.values(banks).map((bank) => [bank.address as string, bank]));
const parsed = decodeMarginfiAccount(
  address(accountFixtures[1].address),
  base64.encode(accountFixtures[1].data)
);
const account = MarginfiAccount.fromAccountType({
  ...parsed,
  balances: parsed.balances.filter((balance) => bankMap.has(balance.bankPk)),
});

const driftSpotMarket = decodeDriftSpotMarket(base64.encode(expected.venues.driftSpotMarket));
const bankIntegrationMap = {
  [banks.drift.address]: {
    driftStates: {
      spotMarketState: driftSpotMarket,
      userState: {},
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
  [banks.juplend.address]: {
    jupLendStates: {
      lendingState: decodeJupLendingState(
        address("BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3"),
        base64.encode(expected.venues.jupLendingState)
      ),
    },
  },
} as unknown as BankIntegrationMetadataMap;

const client = new Project0Client(
  {} as never,
  "",
  programAddress,
  new MarginfiGroup(account.authority, account.group),
  bankMap,
  bankIntegrationMap,
  new Map(),
  new Map(),
  new Map(Object.values(banks).map((bank) => [bank.address, { mint: bank.mint, tokenProgram }])),
  {},
  []
);
const wrapper = new MarginfiAccountWrapper(account, client);

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

describe("MarginfiAccountWrapper", () => {
  it("signs with a noop signer for the account authority by default", () => {
    expect(wrapper.signer.address).toBe(account.authority);
    const signer = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));
    expect(new MarginfiAccountWrapper(account, client, signer).signer).toBe(signer);
  });

  const cases: Partial<Record<keyof typeof expected.cases, () => Promise<Instruction[]>>> = {
    deposit: () => wrapper.makeDepositIx(banks.default.address, 12.345678),
    depositSolWrap: () => wrapper.makeDepositIx(banks.sol.address, 1.5, { wSolBalanceUi: 0.25 }),
    repaySolAll: () => wrapper.makeRepayIx(banks.sol.address, 0.75, true),
    withdrawAll: () => wrapper.makeWithdrawIx(banks.default.address, 5, true),
    borrowSol: () => wrapper.makeBorrowIx(banks.sol.address, 0.1),
    driftDeposit: () => wrapper.makeDepositIx(banks.drift.address, 3),
    driftWithdrawAll: () => wrapper.makeWithdrawIx(banks.drift.address, 1, true),
    juplendDeposit: () => wrapper.makeDepositIx(banks.juplend.address, 9),
    juplendWithdraw: () => wrapper.makeWithdrawIx(banks.juplend.address, 2),
    closeAccount: async () => [await wrapper.makeCloseAccountIx()],
    beginFlashloan: () => wrapper.makeBeginFlashLoanIx(5),
    endFlashloan: () => wrapper.makeEndFlashLoanIx([banks.default.address, banks.sol.address]),
  };

  it.each(Object.keys(cases) as (keyof typeof cases)[])("%s matches v2.8.3", async (name) => {
    expect(toWire(await cases[name]!())).toEqual(expected.cases[name]);
  });
});
