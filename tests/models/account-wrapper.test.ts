import { address, createNoopSigner, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { makeAccount, makeBalance, makeBank } from "../helpers/factories";
import { isMarginfiIx } from "../helpers/ix";
import { mainnetAccount, mainnetBanks } from "../helpers/mainnet";
import { toWire, v283Cases, venueMetadataMap } from "../helpers/parity";
import { fakeRpc } from "../helpers/rpc";

import { MarginfiInstruction } from "~/instructions";
import { MarginfiAccount } from "~/models/account";
import { MarginfiAccountWrapper } from "~/models/account-wrapper";
import { Bank } from "~/models/bank";
import { Project0Client } from "~/models/client";
import { MarginfiGroup } from "~/models/group";
import { BankType } from "~/services/bank";

// A client over the lending-actions fixtures: the wrapper's one-line calls must build the same
// instructions the v2.8.3 builders did from the explicit parameters.
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const banks = Object.fromEntries(
  Object.entries(mainnetBanks).map(([label, bank]) => [label, Bank.fromBankType(bank)])
);
const bankMap = new Map(Object.values(banks).map((bank) => [bank.address as string, bank]));
const account = MarginfiAccount.fromAccountType(mainnetAccount());

const client = new Project0Client(
  {} as never,
  "",
  programAddress,
  new MarginfiGroup(account.authority, account.group),
  bankMap,
  venueMetadataMap,
  new Map(),
  new Map(),
  new Map(Object.values(banks).map((bank) => [bank.address, { mint: bank.mint, tokenProgram }])),
  {},
  []
);
const wrapper = new MarginfiAccountWrapper(account, client);

describe("MarginfiAccountWrapper", () => {
  it("signs with a noop signer for the account authority by default", () => {
    expect(wrapper.signer.address).toBe(account.authority);
    const signer = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));
    expect(new MarginfiAccountWrapper(account, client, signer).signer).toBe(signer);
  });

  const cases: Record<
    Exclude<keyof typeof v283Cases, "createAccount">,
    () => Promise<Instruction[]>
  > = {
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
    beginFlashloan: async () => [await wrapper.makeBeginFlashLoanIx(5)],
    endFlashloan: async () => [
      await wrapper.makeEndFlashLoanIx([banks.default.address, banks.sol.address]),
    ],
  };

  it.each(Object.keys(cases) as (keyof typeof cases)[])("%s matches v2.8.3", async (name) => {
    expect(toWire(await cases[name]())).toEqual(v283Cases[name]);
  });

  it("passes the client's state so deposits get the pulse with no extra arguments", async () => {
    const [sol, usdc, usdt] = Array.from({ length: 3 }, () =>
      makeBank({ premiumTag: 1, premiumActive: true })
    );
    const marginfiAccount = MarginfiAccount.fromAccountType(
      makeAccount([makeBalance(sol, "asset", 1_000e6), makeBalance(usdc, "liability", 100e6)])
    );
    const premiumClient = {
      programAddress,
      rpc: fakeRpc({ accountsExist: true }),
      bankMap: new Map<string, BankType>([sol, usdc, usdt].map((b) => [b.address, b])),
      mintDataByBank: new Map(
        [sol, usdc, usdt].map((b) => [b.address, { mint: b.mint, tokenProgram }])
      ),
      addressLookupTables: {},
      bankIntegrationMap: {},
      assetShareValueMultiplierByBank: new Map(),
    } as unknown as Project0Client;
    const premiumWrapper = new MarginfiAccountWrapper(marginfiAccount, premiumClient);

    const tx = await premiumWrapper.makeDepositTx(usdt.address, 10);
    const ixs = tx.message.instructions;
    const isPulse = isMarginfiIx(MarginfiInstruction.LendingAccountPulseHealth);
    expect(isPulse(ixs[ixs.length - 1])).toBe(true);
  });
});
