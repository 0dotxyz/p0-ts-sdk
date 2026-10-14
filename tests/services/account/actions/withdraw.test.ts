import { address, createNoopSigner, type Address, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { addr, LATEST_BLOCKHASH } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank } from "../../../helpers/factories";
import { mainnetBanks } from "../../../helpers/mainnet";
import { toWire, v283Cases, withdrawParams } from "../../../helpers/parity";

import { TransactionBuildingErrorCode } from "~/errors";
import { makeWithdrawIx, makeWithdrawTx, MarginfiAccountType } from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import type { BankIntegrationMetadataMap } from "~/types";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DEFAULT_ADDRESS = address("11111111111111111111111111111111");

const reserve = addr();
const obligation = addr();
const kamino = makeBank({
  kaminoIntegrationAccounts: { kaminoReserve: reserve, kaminoObligation: obligation },
  config: {
    oracleSetup: OracleSetup.KaminoPythPush,
    assetTag: AssetTag.KAMINO,
    oracleKeys: [addr(), reserve],
  },
});
const collateral = makeBank();
const bankMap = new Map<string, BankType>([kamino, collateral].map((b) => [b.address, b]));
const bankMetadataMap = {
  [kamino.address]: {
    kaminoStates: {
      reserveState: {
        lendingMarket: addr(),
        farmCollateral: DEFAULT_ADDRESS,
        liquidity: { supplyVault: addr() },
        collateral: { mintPubkey: addr(), supplyVault: addr() },
      },
    },
  },
} as unknown as BankIntegrationMetadataMap;

const asset = (b: BankType) => makeBalance(b, "asset", 1_000e6);

const withdrawIx = (
  target: BankType,
  marginfiAccount: MarginfiAccountType,
  overrides: Partial<Parameters<typeof makeWithdrawIx>[0]> = {}
) =>
  makeWithdrawIx({
    programAddress,
    bank: target,
    bankMap,
    tokenProgram,
    amount: 10,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    bankMetadataMap,
    ...overrides,
  });

// The withdraw ix lists the reserve as a Kamino oracle key; only klend ixs come from another program
const touchesOutsideMarginfi = (ixs: readonly Instruction[], key: Address) =>
  ixs.some(
    (ix) =>
      ix.programAddress !== programAddress &&
      (ix.accounts ?? []).some((meta) => meta.address === key)
  );

describe("makeWithdrawTx", () => {
  it("refreshes a Kamino bank that opts.activeBanks adds", async () => {
    const marginfiAccount = makeAccount([asset(collateral)]);
    const tx = await makeWithdrawTx({
      programAddress,
      bank: collateral,
      bankMap,
      tokenProgram,
      amount: 10,
      marginfiAccount,
      authority: createNoopSigner(marginfiAccount.authority),
      rpc: {} as never,
      txFormat: { version: 0, luts: {} },
      latestBlockhash: LATEST_BLOCKHASH,
      bankMetadataMap,
      opts: { activeBanks: [collateral.address, kamino.address] },
    });
    expect(touchesOutsideMarginfi(tx.message.instructions, reserve)).toBe(true);
    expect(touchesOutsideMarginfi(tx.message.instructions, obligation)).toBe(true);
  });
});

describe("makeWithdrawIx", () => {
  it("needs the Kamino multiplier for a partial UI withdraw, not for a withdraw-all", async () => {
    const marginfiAccount = makeAccount([asset(kamino)]);
    await expect(withdrawIx(kamino, marginfiAccount)).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.INVALID_AMOUNT,
    });
    await expect(withdrawIx(kamino, marginfiAccount, { withdrawAll: true })).resolves.toBeDefined();
  });

  it("rejects a cToken amount on a non-Kamino bank", async () => {
    await expect(
      withdrawIx(collateral, makeAccount([asset(collateral)]), {
        amount: { value: 10, type: "cToken" },
      })
    ).rejects.toMatchObject({ code: TransactionBuildingErrorCode.INVALID_AMOUNT });
  });

  it("matches the v2.8.3 instructions for a withdraw-all", async () => {
    const ixs = await makeWithdrawIx({
      ...withdrawParams,
      bank: mainnetBanks.default,
      amount: 5,
      withdrawAll: true,
    });
    expect(toWire(ixs)).toEqual(v283Cases.withdrawAll);
  });

  it("matches the v2.8.3 instructions for a Drift withdraw-all", async () => {
    const ixs = await makeWithdrawIx({
      ...withdrawParams,
      bank: mainnetBanks.drift,
      amount: 1,
      withdrawAll: true,
    });
    expect(toWire(ixs)).toEqual(v283Cases.driftWithdrawAll);
  });

  it("matches the v2.8.3 instructions for a JupLend withdraw", async () => {
    const ixs = await makeWithdrawIx({ ...withdrawParams, bank: mainnetBanks.juplend, amount: 2 });
    expect(toWire(ixs)).toEqual(v283Cases.juplendWithdraw);
  });
});
