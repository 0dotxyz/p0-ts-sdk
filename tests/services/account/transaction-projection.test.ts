import {
  address,
  createNoopSigner,
  getAddressDecoder,
  getBase64Encoder,
  type Instruction,
} from "@solana/kit";
import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import bankFixtures from "../bank/fixtures/mainnet-banks.json";

import accountFixtures from "./fixtures/mainnet-accounts.json";

import { decodeBank, decodeMarginfiAccount } from "~/accounts";
import instructions from "~/instructions";
import {
  computeProjectedActiveBalancesNoCpi,
  computeProjectedActiveBanksNoCpi,
} from "~/services/account/utils/compute/transaction-projection.utils";
import { parseMarginfiAccountRaw } from "~/services/account/utils/deserialize.utils";
import { balanceToDto } from "~/services/account/utils/serialize.utils";
import { parseBankRaw } from "~/services/bank/utils/deserialize.utils";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");

// Mainnet account with 14 active positions, incl. an asset in the default bank fixture and a
// liability in the SOL bank fixture; the other fixture banks become new positions.
const accountFixture = accountFixtures[1];
const account = parseMarginfiAccountRaw(
  address(accountFixture.address),
  decodeMarginfiAccount(base64.encode(accountFixture.data))
);
const banks = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    parseBankRaw(address(bankAddress), decodeBank(base64.encode(data))),
  ])
);
const banksMap = new Map(Object.values(banks).map((bank) => [bank.address, bank]));

const group = account.group;
const marginfiAccount = account.address;
const authority = createNoopSigner(account.authority);
const tokenAccounts = { liquidityVault: key(6), tokenProgram: key(7) };
const venue = { group, marginfiAccount, authority, mint: key(9), integrationAcc1: key(10) };
const kamino = {
  ...venue,
  bank: banks.kamino.address,
  integrationAcc2: key(11),
  lendingMarket: key(30),
  lendingMarketAuthority: key(31),
  reserveLiquiditySupply: key(32),
  reserveCollateralMint: key(33),
  reserveSourceCollateral: key(34),
  liquidityVault: key(6),
  liquidityTokenProgram: key(7),
  destinationTokenAccount: key(5),
};
const juplend = {
  ...venue,
  bank: banks.juplend.address,
  fTokenMint: key(28),
  integrationAcc2: key(11),
  lendingAdmin: key(20),
  supplyTokenReservesLiquidity: key(21),
  lendingSupplyPositionOnLiquidity: key(22),
  rateModel: key(23),
  vault: key(24),
  liquidity: key(25),
  liquidityProgram: key(26),
  rewardsRateModel: key(27),
  liquidityVault: key(6),
  tokenProgram: key(7),
};

async function buildInstructions(): Promise<Instruction[]> {
  return [
    await instructions.makeDepositIx(programAddress, {
      ...tokenAccounts,
      group,
      marginfiAccount,
      authority,
      bank: banks.default.address,
      signerTokenAccount: key(5),
      amount: 1_000_000n,
      depositUpToLimit: null,
    }),
    await instructions.makeRepayIx(programAddress, {
      ...tokenAccounts,
      group,
      marginfiAccount,
      authority,
      bank: banks.sol.address,
      signerTokenAccount: key(5),
      amount: 100_000n,
      repayAll: null,
    }),
    // Different marginfi account: ignored
    await instructions.makeDepositIx(programAddress, {
      ...tokenAccounts,
      group,
      marginfiAccount: key(99),
      authority,
      bank: banks.drift.address,
      signerTokenAccount: key(5),
      amount: 7n,
      depositUpToLimit: null,
    }),
    await instructions.makeKaminoDepositIx(programAddress, {
      ...kamino,
      signerTokenAccount: key(5),
      reserveDestinationDepositCollateral: key(34),
      amount: 3_000_000n,
      refreshReserve: null,
    }),
    await instructions.makeJuplendDepositIx(programAddress, {
      ...juplend,
      signerTokenAccount: key(5),
      amount: 9_000_000n,
    }),
    await instructions.makeJuplendWithdrawIx(programAddress, {
      ...juplend,
      destinationTokenAccount: key(5),
      claimAccount: key(29),
      integrationAcc3: key(12),
      amount: 2_000_000n,
      withdrawAll: null,
    }),
    // withdraw-all via kaminoWithdraw's flags bit 0
    await instructions.makeKaminoWithdrawIx(programAddress, {
      ...kamino,
      amount: 0n,
      isFinalWithdrawal: true,
      refreshReserve: false,
    }),
    await instructions.makeWithdrawIx(programAddress, {
      ...tokenAccounts,
      group,
      marginfiAccount,
      authority,
      bank: banks.default.address,
      destinationTokenAccount: key(5),
      amount: 500_000n,
      withdrawAll: null,
    }),
  ];
}

// Matches the v2.8.3 (Anchor-decoding) projection for the same instruction bytes.
describe("transaction projection", () => {
  it("projects which banks stay active", async () => {
    const projected = computeProjectedActiveBanksNoCpi({
      account,
      instructions: await buildInstructions(),
      programAddress,
    });

    expect(projected).toContain(banks.juplend.address);
    expect(projected).not.toContain(banks.kamino.address);
    expect(projected).not.toContain(banks.drift.address);
    expect(projected).toMatchSnapshot();
  });

  it("projects balance shares through deposits, repays and withdraws", async () => {
    const result = computeProjectedActiveBalancesNoCpi({
      account,
      instructions: await buildInstructions(),
      programAddress,
      banksMap,
      assetShareValueMultiplierByBank: new Map([
        [banks.kamino.address, new BigNumber(1.2345)],
        [banks.juplend.address, new BigNumber(1.011)],
      ]),
    });

    expect(result.withdrawnBanks).toEqual([
      banks.juplend.address,
      banks.kamino.address,
      banks.default.address,
    ]);
    expect({
      ...result,
      projectedBalances: result.projectedBalances.map(balanceToDto),
    }).toMatchSnapshot();
  });
});
