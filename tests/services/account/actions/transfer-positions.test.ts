import {
  address,
  createNoopSigner,
  getAddressDecoder,
  getBase64Encoder,
  type Address,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BigNumber } from "bignumber.js";
import { describe, it, expect } from "vitest";

import bankFixtures from "../../bank/fixtures/mainnet-banks.json";
import accountFixtures from "../fixtures/mainnet-accounts.json";

import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import {
  buildCollateralLegIxs,
  classifyAndValidate,
  BuildContext,
  ClassifiedPosition,
  makeTransferPositionsTx,
} from "~/services/account/actions/transfer-positions";
import { MakeTransferPositionsTxParams } from "~/services/account/types";
import { MarginfiAccountType } from "~/services/account/types/account.types";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import { AssetTag, BankType } from "~/services/bank";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import { BankIntegrationMetadataMap } from "~/types";
import { KaminoReserve } from "~/vendor/klend";

const pk = (seed: number) =>
  getAddressDecoder().decode(Uint8Array.from({ length: 32 }, (_, i) => (seed + i) % 256));

// --------------------------------------------------------------------------------------
// Hard cap on positions per transfer
// --------------------------------------------------------------------------------------

describe("classifyAndValidate (position cap)", () => {
  // The cap check fires before any balance/oracle lookup, so minimal params suffice.
  const capParams = (bankCount: number, maxPositions?: number): MakeTransferPositionsTxParams =>
    ({
      programAddress: pk(99),
      authority: createNoopSigner(pk(31)),
      rpc: {} as never,
      marginfiAccount: {
        address: pk(30),
        authority: pk(31),
        group: pk(32),
        balances: [],
      } as unknown as MarginfiAccountType,
      bankAddresses: Array.from({ length: bankCount }, (_, i) => pk(100 + i)),
      bankMap: new Map(),
      bankMetadataMap: {} as BankIntegrationMetadataMap,
      assetShareValueMultiplierByBank: new Map(),
      tokenProgramsByBank: new Map(),
      txFormat: { version: 0, luts: {} },
      maxPositions,
    }) as MakeTransferPositionsTxParams;

  it("throws INVALID_SELECTION when the selection exceeds the default cap of 5", () => {
    try {
      classifyAndValidate(capParams(6));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TransactionBuildingError);
      expect((e as TransactionBuildingError).code).toBe(
        TransactionBuildingErrorCode.TRANSFER_POSITIONS_INVALID_SELECTION
      );
    }
  });

  it("respects a custom maxPositions", () => {
    expect(() => classifyAndValidate(capParams(3, 2))).toThrow(/cannot transfer 3 positions/);
  });

  it("throws INVALID_SELECTION on an empty selection", () => {
    try {
      classifyAndValidate(capParams(0));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TransactionBuildingError).code).toBe(
        TransactionBuildingErrorCode.TRANSFER_POSITIONS_INVALID_SELECTION
      );
    }
  });
});

describe("classifyAndValidate (costly position limit)", () => {
  const authority = pk(31);
  const group = pk(32);
  const makeBank = (seed: number, assetTag: AssetTag) =>
    ({
      address: pk(seed),
      mint: pk(seed + 50),
      mintDecimals: 9,
      assetShareValue: new BigNumber(1),
      liabilityShareValue: new BigNumber(1),
      premiumActive: false,
      config: { assetTag },
    }) as unknown as BankType;
  const balanceIn = (bank: BankType) => ({
    active: true,
    bankPk: bank.address,
    assetShares: new BigNumber(1e9),
    liabilityShares: new BigNumber(0),
  });

  it("rejects a transfer that leaves the destination with more than 4 integration/staked positions", () => {
    const staked = [makeBank(150, AssetTag.STAKED), makeBank(151, AssetTag.STAKED)];
    const kamino = [150, 151, 152].map((seed) => makeBank(seed + 10, AssetTag.KAMINO));
    const params = {
      programAddress: pk(99),
      authority: createNoopSigner(authority),
      rpc: {} as never,
      marginfiAccount: { address: pk(30), authority, group, balances: staked.map(balanceIn) },
      destinationAccount: { address: pk(33), authority, group, balances: kamino.map(balanceIn) },
      bankAddresses: staked.map((b) => b.address),
      bankMap: new Map([...staked, ...kamino].map((b) => [b.address, b])),
      bankMetadataMap: {} as BankIntegrationMetadataMap,
      assetShareValueMultiplierByBank: new Map(),
      tokenProgramsByBank: new Map(staked.map((b) => [b.address, TOKEN_PROGRAM_ADDRESS])),
      txFormat: { version: 0, luts: {} },
    } as unknown as MakeTransferPositionsTxParams;

    expect(() => classifyAndValidate(params)).toThrow(
      "destination account cannot hold 5 integration and staked positions (max 4)"
    );
    expect(() =>
      classifyAndValidate({ ...params, bankAddresses: [staked[0].address] })
    ).not.toThrow();
  });
});

// --------------------------------------------------------------------------------------
// Integration collateral-leg dispatch
// --------------------------------------------------------------------------------------

const KAMINO_BANK_PK = pk(20);
const PROGRAM_PK = pk(99);
const ACCOUNT_B_PK = pk(40);

/** A minimal on-chain-shaped Kamino reserve (same shape the metadata map carries). */
const reserve: KaminoReserve = {
  lendingMarket: pk(1),
  farmCollateral: pk(2),
  liquidity: {
    mintPubkey: pk(3),
    supplyVault: pk(4),
    mintDecimals: 6n,
    totalAvailableAmount: 123456789n,
    borrowedAmountSf: 987654321000000000n,
    accumulatedProtocolFeesSf: 111n,
    accumulatedReferrerFeesSf: 222n,
    pendingReferrerFeesSf: 333n,
  },
  collateral: { mintPubkey: pk(5), mintTotalSupply: 55555555n, supplyVault: pk(6) },
  withdrawQueue: { queuedCollateralAmount: 0n },
  config: {
    protocolTakeRatePct: 15,
    hostFixedInterestRateBps: 25,
    depositLimit: 10000000000000000n,
    borrowLimit: 9000000000000000n,
    borrowRateCurve: { points: [{ utilizationRateBps: 0, borrowRateBps: 100 }] },
    tokenInfo: {
      scopeConfiguration: { priceFeed: pk(7) },
      switchboardConfiguration: { priceAggregator: pk(8), twapAggregator: pk(9) },
      pythConfiguration: { price: pk(10) },
    },
  },
} as unknown as KaminoReserve;

const kaminoBank = {
  address: KAMINO_BANK_PK,
  mint: pk(21),
  liquidityVault: pk(24),
  mintDecimals: 6,
  tokenSymbol: "kTKN",
  config: { assetTag: AssetTag.KAMINO },
  kaminoIntegrationAccounts: { kaminoReserve: pk(22), kaminoObligation: pk(23) },
} as unknown as BankType;

function baseCtx(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    programAddress: PROGRAM_PK,
    authority: createNoopSigner(pk(31)),
    accountA: {
      address: pk(30),
      authority: pk(31),
      group: pk(32),
      balances: [],
    } as unknown as MarginfiAccountType,
    accountB: { address: ACCOUNT_B_PK, group: pk(32) } as unknown as MarginfiAccountType,
    bankMap: new Map(),
    bankMetadataMap: {
      [KAMINO_BANK_PK]: { kaminoStates: { reserveState: reserve } },
    } as unknown as BankIntegrationMetadataMap,
    assetShareValueMultiplierByBank: new Map([[KAMINO_BANK_PK, new BigNumber(2)]]),
    borrowPaddingBps: 10,
    groupRateLimiterEnabled: false,
    destPreexistingBanks: [],
    ...overrides,
  };
}

const kaminoPosition: ClassifiedPosition = {
  bankAddress: KAMINO_BANK_PK,
  side: "collateral",
  uiAmount: new BigNumber(100),
  bank: kaminoBank,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
};

describe("buildCollateralLegIxs (integration dispatch)", () => {
  it("routes a KAMINO position to the Kamino builders and locks its reserve/obligation accounts", async () => {
    const { withdrawIxs, depositIxs } = await buildCollateralLegIxs(baseCtx(), kaminoPosition);

    expect(withdrawIxs.length).toBeGreaterThan(0);
    expect(depositIxs.length).toBeGreaterThan(0);

    // Every emitted instruction targets the marginfi program (the Kamino CPI accounts ride as keys).
    for (const ix of [...withdrawIxs, ...depositIxs]) {
      expect(ix.programAddress).toBe(PROGRAM_PK);
    }

    // The Kamino reserve/obligation plumbing pulled from bankMetadataMap must appear in the keys —
    // proof the dispatch chose the Kamino builder rather than the plain lending ix.
    const keys = [...withdrawIxs, ...depositIxs].flatMap((ix) =>
      (ix.accounts ?? []).map((meta) => meta.address)
    );
    expect(keys).toContain(reserve.lendingMarket);
    expect(keys).toContain(reserve.liquidity.supplyVault);
    expect(keys).toContain(reserve.collateral.supplyVault);
    expect(keys).toContain(pk(23)); // kaminoObligation

    // The deposit leg targets the destination account B.
    const depositKeys = depositIxs.flatMap((ix) => (ix.accounts ?? []).map((meta) => meta.address));
    expect(depositKeys).toContain(ACCOUNT_B_PK);
  });

  it("throws KAMINO_RESERVE_NOT_FOUND when the reserve state is missing from the metadata map", async () => {
    const ctx = baseCtx({ bankMetadataMap: {} as unknown as BankIntegrationMetadataMap });
    await expect(buildCollateralLegIxs(ctx, kaminoPosition)).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.KAMINO_RESERVE_NOT_FOUND,
    });
  });

  it("throws JUPLEND_STATE_NOT_FOUND when the lending state is missing from the metadata map", async () => {
    const jupBank = {
      ...kaminoBank,
      config: { assetTag: AssetTag.JUPLEND },
      jupLendIntegrationAccounts: {
        jupLendingState: pk(50),
        jupFTokenVault: pk(51),
        jupFTokenAta: pk(52),
      },
    } as unknown as BankType;
    const jupPosition: ClassifiedPosition = { ...kaminoPosition, bank: jupBank };

    await expect(buildCollateralLegIxs(baseCtx(), jupPosition)).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.JUPLEND_STATE_NOT_FOUND,
    });
  });
});

describe("makeTransferPositionsTx (new destination)", () => {
  it("searches for a free index under the requested thirdPartyId", async () => {
    const base64 = getBase64Encoder();
    const banks = Object.fromEntries(
      bankFixtures.map(({ label, address: bankAddress, data }) => [
        label.split(" ")[0],
        decodeBank(address(bankAddress), base64.encode(data)),
      ])
    );
    const bankMap = new Map(Object.values(banks).map((bank) => [bank.address, bank]));
    const parsed = decodeMarginfiAccount(
      address(accountFixtures[1].address),
      base64.encode(accountFixtures[1].data)
    );
    const marginfiAccount = {
      ...parsed,
      balances: parsed.balances.filter((balance) => bankMap.has(balance.bankPk)),
    };

    // Every account is free; record what was looked up
    const queried: Address[] = [];
    const rpc = {
      getLatestBlockhash: () => ({
        send: async () => ({
          value: {
            blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
            lastValidBlockHeight: 1n,
          },
        }),
      }),
      getMultipleAccounts: (addresses: Address[]) => ({
        send: async () => {
          queried.push(...addresses);
          return { context: { slot: 1n }, value: addresses.map(() => null) };
        },
      }),
    };

    const result = await makeTransferPositionsTx({
      programAddress: address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"),
      authority: createNoopSigner(marginfiAccount.authority),
      rpc: rpc as never,
      marginfiAccount,
      bankAddresses: [banks.default.address],
      createDestinationOpts: { thirdPartyId: 7 },
      bankMap,
      bankMetadataMap: {},
      assetShareValueMultiplierByBank: new Map(),
      tokenProgramsByBank: new Map([[banks.default.address, TOKEN_PROGRAM_ADDRESS]]),
      txFormat: { version: 0, luts: {} },
    });

    expect(queried).toContain(result.destinationAccount.address);
  });
});
