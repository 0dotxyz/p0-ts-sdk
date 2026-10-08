import {
  AccountRole,
  blockhash,
  compileTransactionMessage,
  createNoopSigner,
  getAddressDecoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BigNumber } from "bignumber.js";
import { describe, expect, it, vi } from "vitest";

import { USDC_MINT, USDT_MINT, WSOL_MINT } from "~/constants";
import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import {
  makeBridgedTx,
  type BridgeLeg,
  type MakeBridgedTxParams,
} from "~/services/account/actions/bridge-swap";
import type { MarginfiAccountType, SwapQuoteResult } from "~/services/account/types";
import { AssetTag, BankType, OperationalState } from "~/services/bank/types";
import { makeTransactionMessage } from "~/services/transaction/helpers/tx-formatting";
import { TransactionType } from "~/services/transaction/types";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const authority = createNoopSigner(key(1));
const latestBlockhash = {
  blockhash: blockhash("EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k"),
  lastValidBlockHeight: 0n,
};
const tooLarge = TransactionBuildingError.swapSizeExceededLoop(2_000, 70);

let bankCount = 60;
function bank(mint: Address): BankType {
  return {
    address: key(bankCount++),
    mint,
    tokenSymbol: mint.slice(0, 4),
    config: {
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.Operational,
      borrowLimit: new BigNumber(100),
    },
  } as unknown as BankType;
}

const source = bank(key(50));
const destination = bank(key(51));
const bridgeBanks = [bank(USDC_MINT), bank(WSOL_MINT), bank(USDT_MINT)];
const bankMap = new Map([source, destination, ...bridgeBanks].map((b) => [b.address, b]));

function account(assetsIn: BankType[] = []): MarginfiAccountType {
  return {
    address: key(3),
    balances: assetsIn.map((b) => ({
      active: true,
      bankPk: b.address,
      assetShares: new BigNumber(1),
      liabilityShares: new BigNumber(0),
    })),
  } as unknown as MarginfiAccountType;
}

const ix = (fill: number): Instruction => ({
  programAddress: key(150),
  accounts: [{ address: key(fill), role: AccountRole.WRITABLE }],
  data: new Uint8Array([fill]),
});
const tx = (type: TransactionType, fill: number) => ({
  message: makeTransactionMessage({
    instructions: [ix(fill)],
    feePayer: authority,
    latestBlockhash,
    txFormat: { version: 0, luts: {} },
  }),
  type,
});
const quote = (q: Partial<SwapQuoteResult> = {}): SwapQuoteResult => ({
  inAmount: "1",
  outAmount: "1",
  otherAmountThreshold: "1",
  slippageBps: 0,
  ...q,
});
const leg = (fill: number, q?: Partial<SwapQuoteResult>): BridgeLeg => ({
  transactions: [tx(TransactionType.FLASHLOAN, fill)],
  actionTxIndex: 0,
  quoteResponse: quote(q),
});

function params(overrides: Partial<MakeBridgedTxParams> = {}): MakeBridgedTxParams {
  return {
    programAddress: key(200),
    marginfiAccount: account(),
    authority,
    rpc: {} as never,
    bankMap,
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    swapOpts: {},
    txFormat: { version: 0, luts: {} },
    bridgeOpts: {
      tokenProgramByMint: new Map(bridgeBanks.map((b) => [b.mint, TOKEN_PROGRAM_ADDRESS])),
    },
    side: "deposit",
    sourceMint: source.mint,
    destinationMint: destination.mint,
    buildWithoutBridge: async () => {
      throw tooLarge;
    },
    buildOpenBridgeLeg: async () => leg(10),
    buildCloseBridgeLeg: async () => leg(20),
    ...overrides,
  };
}

describe("makeBridgedTx", () => {
  it("returns the swap built without a bridge when it fits", async () => {
    const unbridged = {
      transactions: [],
      actionTxIndex: 0,
      quoteResponse: undefined,
      mustBeAtomicBundle: false,
    };
    const buildOpenBridgeLeg = vi.fn();
    const result = await makeBridgedTx(
      params({ buildWithoutBridge: async () => unbridged, buildOpenBridgeLeg })
    );
    expect(result).toBe(unbridged);
    expect(buildOpenBridgeLeg).not.toHaveBeenCalled();
  });

  it("rethrows an error that splitting can't fix, and never splits a pinned route", async () => {
    const buildOpenBridgeLeg = vi.fn();
    await expect(
      makeBridgedTx(
        params({ buildWithoutBridge: () => Promise.reject(new Error("boom")), buildOpenBridgeLeg })
      )
    ).rejects.toThrow("boom");
    await expect(
      makeBridgedTx(params({ swapOpts: { swapIxs: {} as never }, buildOpenBridgeLeg }))
    ).rejects.toBe(tooLarge);
    expect(buildOpenBridgeLeg).not.toHaveBeenCalled();
  });

  it("tries the default bridges in order without the swap's own mints, then rethrows the original error", async () => {
    const tried: Address[] = [];
    const result = makeBridgedTx(
      params({
        sourceMint: USDC_MINT,
        buildOpenBridgeLeg: async ({ bridgeBank }) => {
          tried.push(bridgeBank.mint);
          return null;
        },
      })
    );
    await expect(result).rejects.toBe(tooLarge);
    expect(tried).toEqual([WSOL_MINT, USDT_MINT]);
  });

  it("follows bridgeCandidateMints", async () => {
    const tried: Address[] = [];
    await makeBridgedTx(
      params({
        bridgeOpts: { ...params().bridgeOpts, bridgeCandidateMints: [USDT_MINT, WSOL_MINT] },
        buildOpenBridgeLeg: async ({ bridgeBank }) => {
          tried.push(bridgeBank.mint);
          return null;
        },
      })
    ).catch(() => undefined);
    expect(tried).toEqual([USDT_MINT, WSOL_MINT]);
  });

  it("moves to the next bridge when a leg fails to build, but propagates other errors", async () => {
    const result = await makeBridgedTx(
      params({
        buildOpenBridgeLeg: async ({ bridgeBank }) => {
          if (bridgeBank.mint === USDC_MINT) throw tooLarge;
          return leg(10);
        },
      })
    );
    expect(result.bridgeMint).toBe(WSOL_MINT);

    await expect(
      makeBridgedTx(params({ buildOpenBridgeLeg: () => Promise.reject(new Error("rpc down")) }))
    ).rejects.toThrow("rpc down");
  });

  it("throws BRIDGE_CONFLICT when every bridge's bank holds the opposite side", async () => {
    await expect(
      makeBridgedTx(params({ side: "borrow", marginfiAccount: account(bridgeBanks) }))
    ).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.BRIDGE_CONFLICT,
      details: { bridgeTokenSide: "borrow" },
    });
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      makeBridgedTx(
        params({ bridgeOpts: { ...params().bridgeOpts, abortSignal: controller.signal } })
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("orders the bundle: merged setups, then each leg's refreshes before its flashloan", async () => {
    const result = await makeBridgedTx(
      params({
        buildOpenBridgeLeg: async () => ({
          transactions: [
            tx(TransactionType.CREATE_ATA, 10),
            tx(TransactionType.CRANK, 11),
            tx(TransactionType.FLASHLOAN, 12),
          ],
          actionTxIndex: 2,
          quoteResponse: quote(),
        }),
        buildCloseBridgeLeg: async () => ({
          transactions: [
            tx(TransactionType.CREATE_ATA, 20),
            tx(TransactionType.CRANK, 21),
            tx(TransactionType.FLASHLOAN, 22),
          ],
          actionTxIndex: 2,
          quoteResponse: quote(),
        }),
      })
    );

    const keysOf = (i: number) =>
      result.transactions[i].message.instructions.map(
        (instruction) => instruction.accounts?.[0].address
      );
    expect(result.transactions.map((t) => t.type)).toEqual([
      TransactionType.CREATE_ATA,
      TransactionType.CRANK,
      TransactionType.FLASHLOAN,
      TransactionType.CRANK,
      TransactionType.FLASHLOAN,
    ]);
    expect(keysOf(0)).toEqual([key(10), key(20)]);
    expect([1, 2, 3, 4].map((i) => keysOf(i)[0])).toEqual([key(11), key(12), key(21), key(22)]);
    expect(result).toMatchObject({
      actionTxIndex: 4,
      bridgeMint: USDC_MINT,
      mustBeAtomicBundle: true,
    });
  });

  it("places a leg's action by actionTxIndex, whatever its tag", async () => {
    const result = await makeBridgedTx(
      params({
        buildOpenBridgeLeg: async () => ({
          transactions: [tx(TransactionType.CRANK, 11), tx(TransactionType.CREATE_ATA, 12)],
          actionTxIndex: 1,
          quoteResponse: quote(),
        }),
      })
    );

    const firstKeys = result.transactions.map(
      (t) => t.message.instructions[0].accounts?.[0].address
    );
    // The mis-tagged action isn't merged into a setup or moved ahead of its refresh
    expect(firstKeys).toEqual([key(11), key(12), key(20)]);
  });

  it("skips a bridge whose bundle exceeds five transactions", async () => {
    const crowded = (fill: number): BridgeLeg => ({
      transactions: [
        tx(TransactionType.CRANK, fill),
        tx(TransactionType.CRANK, fill + 1),
        tx(TransactionType.FLASHLOAN, fill + 2),
      ],
      actionTxIndex: 2,
      quoteResponse: quote(),
    });
    const result = await makeBridgedTx(
      params({
        buildOpenBridgeLeg: async ({ bridgeBank }) =>
          bridgeBank.mint === USDC_MINT ? crowded(10) : leg(10),
        buildCloseBridgeLeg: async ({ bridgeBank }) =>
          bridgeBank.mint === USDC_MINT ? crowded(20) : leg(20),
      })
    );
    expect(result.bridgeMint).toBe(WSOL_MINT);
  });

  it("builds the close leg against the account the open leg leaves, with additionalIxs on the open leg only", async () => {
    const additionalIxs = [ix(90)];
    const marginfiAccount = account();
    const buildOpenBridgeLeg = vi.fn(async () => leg(10, { inAmount: "7" }));
    const buildCloseBridgeLeg = vi.fn(async () => leg(20));
    await makeBridgedTx(
      params({ additionalIxs, marginfiAccount, buildOpenBridgeLeg, buildCloseBridgeLeg })
    );

    const [[open]] = buildOpenBridgeLeg.mock.calls as unknown as [
      [Parameters<MakeBridgedTxParams["buildOpenBridgeLeg"]>[0]],
    ];
    const [[close]] = buildCloseBridgeLeg.mock.calls as unknown as [
      [Parameters<MakeBridgedTxParams["buildCloseBridgeLeg"]>[0]],
    ];
    expect(open.context.additionalIxs).toBe(additionalIxs);
    expect(open.context.marginfiAccount).toBe(marginfiAccount);
    expect("additionalIxs" in close.context).toBe(false);
    expect(close.context.marginfiAccount).not.toBe(marginfiAccount);
    expect(close.openLegQuote.inAmount).toBe("7");
  });

  it("quotes the swap into the bridge followed by the swap out of it", async () => {
    const run = (side: MakeBridgedTxParams["side"]) =>
      makeBridgedTx(
        params({
          side,
          buildOpenBridgeLeg: async () =>
            leg(10, {
              inAmount: "100",
              outAmount: "200",
              otherAmountThreshold: "190",
              slippageBps: 100,
            }),
          buildCloseBridgeLeg: async () =>
            leg(20, {
              inAmount: "300",
              outAmount: "400",
              otherAmountThreshold: "380",
              slippageBps: 100,
            }),
        })
      );

    // Deposited bridge: the open leg swaps into it
    expect((await run("deposit")).quoteResponse).toMatchObject({
      inAmount: "100",
      outAmount: "400",
      otherAmountThreshold: "380",
      slippageBps: 199,
    });
    // Borrowed bridge: the close leg swaps into it
    expect((await run("borrow")).quoteResponse).toMatchObject({
      inAmount: "300",
      outAmount: "200",
      otherAmountThreshold: "190",
      slippageBps: 199,
    });
  });
});

describe("makeBridgedTx setup merge", () => {
  const lookupTable = key(100);
  // Both legs' accounts are in the lookup table, so a version 0 leg's instruction carries
  // lookup-table account metas (a version 1 leg has no table)
  const luts = { [lookupTable]: [10, 11, 12, 20, 21, 22].map(key) };
  // The setup program + the two read-only accounts of each leg
  const READONLY_ACCOUNTS = 5;

  const setupIx = (firstKey: number): Instruction => ({
    programAddress: key(201),
    accounts: [
      { address: key(firstKey), role: AccountRole.WRITABLE },
      { address: key(firstKey + 1), role: AccountRole.READONLY },
      { address: key(firstKey + 2), role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  });
  const setupLeg = (firstKey: number, version: 0 | 1): BridgeLeg => ({
    transactions: [
      {
        message: makeTransactionMessage({
          instructions: [setupIx(firstKey)],
          feePayer: authority,
          latestBlockhash,
          txFormat: version === 1 ? { version: 1 } : { version: 0, luts },
        }),
        type: TransactionType.CREATE_ATA,
      },
    ],
    // A setup-only leg, to isolate the merge
    actionTxIndex: 1,
    quoteResponse: quote(),
  });

  async function mergeSetups(openVersion: 0 | 1, closeVersion: 0 | 1) {
    const { transactions } = await makeBridgedTx(
      params({
        buildOpenBridgeLeg: async () => setupLeg(10, openVersion),
        buildCloseBridgeLeg: async () => setupLeg(20, closeVersion),
      })
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TransactionType.CREATE_ATA);
    expect(transactions[0].message.instructions).toHaveLength(2);
    return transactions[0].message;
  }

  it("merges version 1 setup transactions into one version 1 transaction", async () => {
    const message = await mergeSetups(1, 1);

    expect(message.version).toBe(1);
    const compiled = compileTransactionMessage(message);
    expect("addressTableLookups" in compiled).toBe(false);
    expect(compiled.header.numReadonlyNonSignerAccounts).toBe(READONLY_ACCOUNTS);
  });

  it("merges version 0 setup transactions into one version 0 transaction", async () => {
    expect((await mergeSetups(0, 0)).version).toBe(0);
  });

  it("falls back to version 0 when the legs mix versions", async () => {
    const message = await mergeSetups(1, 0);

    expect(message.version).toBe(0);
    // The version 1 leg's accounts stay static, the version 0 leg's stay in the lookup table
    const compiled = compileTransactionMessage(message);
    const lookups = "addressTableLookups" in compiled ? (compiled.addressTableLookups ?? []) : [];
    expect(lookups).toEqual([
      { lookupTableAddress: lookupTable, writableIndexes: [3], readonlyIndexes: [4, 5] },
    ]);
    // No read-only account is encoded as writable: the static and the looked-up ones add up
    expect(
      compiled.header.numReadonlyNonSignerAccounts +
        lookups.flatMap((lookup) => lookup.readonlyIndexes).length
    ).toBe(READONLY_ACCOUNTS);
  });
});
