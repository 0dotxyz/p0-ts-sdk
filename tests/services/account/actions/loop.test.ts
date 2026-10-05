import {
  address,
  createNoopSigner,
  createSolanaRpc,
  getAddressDecoder,
  getBase64Encoder,
  unwrapOption,
} from "@solana/kit";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  getSetComputeUnitLimitInstruction,
} from "@solana-program/compute-budget";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import bankFixtures from "../../bank/fixtures/mainnet-banks.json";
import accountFixtures from "../fixtures/mainnet-accounts.json";

import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import { makeLoopTx } from "~/services/account/actions/loop";
import type { SwapEngineRequest } from "~/services/account/services/swap-engine";
import { SwapProvider } from "~/services/account/types";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import { TransactionFormat, TransactionType } from "~/services/transaction";

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const swapProgram = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const routeMint = getAddressDecoder().decode(new Uint8Array(32).fill(9));
const rpcEndpoint = "http://loop.test";

// Mainnet account with an asset in the default (mSOL) bank fixture and a liability in the SOL
// bank fixture; its other positions are dropped so every active bank is loaded.
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
const authority = createNoopSigner(marginfiAccount.authority);

describe("makeLoopTx", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const { id, method, params } = JSON.parse(init.body);
      const value =
        method === "getLatestBlockhash"
          ? { blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N", lastValidBlockHeight: 100 }
          : params[0].map(() => null); // getMultipleAccounts: no ATA exists yet
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value } })
      );
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("splices the swap between borrow and deposit and patches the deposit to min-out + principal", async () => {
    const requests: SwapEngineRequest[] = [];
    const minOutNative = 426_000_000n;

    const result = await makeLoopTx({
      programAddress,
      marginfiAccount,
      authority,
      rpc: createSolanaRpc(rpcEndpoint),
      bankMap,
      bankMetadataMap: {},
      assetShareValueMultiplierByBank: new Map(),
      depositOpts: {
        depositBank: banks.default,
        tokenProgram,
        inputDepositAmount: 1,
        loopMode: "DEPOSIT",
        marketPrice: 190,
      },
      borrowOpts: { borrowBank: banks.sol, tokenProgram, borrowAmount: 0.5, marketPrice: 150 },
      swapOpts: {},
      txFormat: { version: 0, luts: {} },
      swapEngineRunner: async (request) => {
        requests.push(request);
        const payer = createNoopSigner(request.taker);
        const [routeAta] = await findAssociatedTokenPda({
          mint: routeMint,
          owner: request.taker,
          tokenProgram,
        });
        const [depositAta] = await findAssociatedTokenPda({
          mint: banks.default.mint,
          owner: request.taker,
          tokenProgram,
        });
        return {
          swapInstructions: [
            { programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) },
          ],
          setupInstructions: [
            getSetComputeUnitLimitInstruction({ units: 123 }),
            getCreateAssociatedTokenIdempotentInstruction({
              payer,
              ata: depositAta,
              owner: request.taker,
              mint: banks.default.mint,
            }),
            getCreateAssociatedTokenIdempotentInstruction({
              payer,
              ata: routeAta,
              owner: request.taker,
              mint: routeMint,
            }),
          ],
          swapLuts: {},
          quoteResponse: {
            inAmount: "500000000",
            outAmount: "450000000",
            otherAmountThreshold: minOutNative.toString(),
            slippageBps: 50,
          },
          outputAmountNative: minOutNative,
          provider: SwapProvider.JUPITER,
        };
      },
    });

    const [request] = requests;
    const [depositAta] = await findAssociatedTokenPda({
      mint: banks.default.mint,
      owner: authority.address,
      tokenProgram,
    });
    expect(request).toMatchObject({
      inputMint: banks.sol.mint,
      outputMint: banks.default.mint,
      amountNative: 500_000_000,
      taker: authority.address,
      destinationTokenAccount: depositAta,
    });

    expect(result.transactions.map((tx) => tx.type)).toEqual([
      TransactionType.CREATE_ATA,
      TransactionType.FLASHLOAN,
    ]);
    expect(result.actionTxIndex).toBe(1);

    // The engine's compute-budget ix and deposit-mint ATA are dropped; its route ATA is kept.
    const setupIxs = result.transactions[0].message.instructions;
    expect(setupIxs.some((ix) => ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS)).toBe(false);
    expect(
      setupIxs
        .filter((ix) => ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS)
        .map((ix) => ix.accounts?.[3]?.address)
    ).toEqual([banks.sol.mint, banks.default.mint, routeMint]);

    // [begin, cu limit, cu price, borrow, swap, deposit, end]
    const flashloanIxs = result.transactions[1].message.instructions;
    const kinds = flashloanIxs.map((ix) =>
      ix.programAddress === swapProgram ? "swap" : parseMarginfiIx(ix)?.instructionType
    );
    expect(kinds).toEqual([
      MarginfiInstruction.LendingAccountStartFlashloan,
      undefined,
      undefined,
      MarginfiInstruction.LendingAccountBorrow,
      "swap",
      MarginfiInstruction.LendingAccountDeposit,
      MarginfiInstruction.LendingAccountEndFlashloan,
    ]);

    const begin = parseMarginfiIx(flashloanIxs[0]);
    const deposit = parseMarginfiIx(flashloanIxs[5]);
    if (
      begin?.instructionType !== MarginfiInstruction.LendingAccountStartFlashloan ||
      deposit?.instructionType !== MarginfiInstruction.LendingAccountDeposit
    ) {
      throw new Error("unexpected flashloan layout");
    }
    expect(begin.data.endIndex).toBe(6n);
    // min-out of the swap plus the 1 mSOL principal (9 decimals)
    expect(deposit.data.amount).toBe(minOutNative + 1_000_000_000n);
    expect(unwrapOption(deposit.data.depositUpToLimit)).toBeNull();
  });

  it("builds version 1 messages with the same flashloan layout and tells the swap engine the format", async () => {
    const minOutNative = 426_000_000n;

    const build = async (txFormat: TransactionFormat) => {
      const requests: SwapEngineRequest[] = [];
      const result = await makeLoopTx({
        programAddress,
        marginfiAccount,
        authority,
        rpc: createSolanaRpc(rpcEndpoint),
        bankMap,
        bankMetadataMap: {},
        assetShareValueMultiplierByBank: new Map(),
        depositOpts: {
          depositBank: banks.default,
          tokenProgram,
          inputDepositAmount: 1,
          loopMode: "DEPOSIT",
          marketPrice: 190,
        },
        borrowOpts: { borrowBank: banks.sol, tokenProgram, borrowAmount: 0.5, marketPrice: 150 },
        swapOpts: {},
        txFormat,
        swapEngineRunner: async (request) => {
          requests.push(request);
          const [routeAta] = await findAssociatedTokenPda({
            mint: routeMint,
            owner: request.taker,
            tokenProgram,
          });
          return {
            swapInstructions: [
              { programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) },
            ],
            setupInstructions: [
              getSetComputeUnitLimitInstruction({ units: 123 }),
              getCreateAssociatedTokenIdempotentInstruction({
                payer: createNoopSigner(request.taker),
                ata: routeAta,
                owner: request.taker,
                mint: routeMint,
              }),
            ],
            swapLuts: {},
            quoteResponse: {
              inAmount: "500000000",
              outAmount: "450000000",
              otherAmountThreshold: minOutNative.toString(),
              slippageBps: 50,
            },
            outputAmountNative: minOutNative,
            provider: SwapProvider.JUPITER,
          };
        },
      });

      const flashloanIxs = result.transactions[result.actionTxIndex].message.instructions;
      const begin = parseMarginfiIx(flashloanIxs[0]);
      if (begin?.instructionType !== MarginfiInstruction.LendingAccountStartFlashloan) {
        throw new Error("unexpected flashloan layout");
      }
      return {
        result,
        requests,
        endIndex: begin.data.endIndex,
        kinds: flashloanIxs.map((ix) => {
          if (ix.programAddress === swapProgram) return "swap";
          if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) return "compute budget";
          return parseMarginfiIx(ix)?.instructionType;
        }),
      };
    };

    const v0 = await build({ version: 0, luts: {} });
    const v1 = await build({ version: 1 });

    expect(v0.result.transactions.map((tx) => tx.message.version)).toEqual([0, 0]);
    expect(v1.result.transactions.map((tx) => tx.message.version)).toEqual([1, 1]);
    expect(v1.result.transactions.map((tx) => tx.type)).toEqual([
      TransactionType.CREATE_ATA,
      TransactionType.FLASHLOAN,
    ]);

    // The compute-budget placeholders stay in the version 1 flashloan, so the end index holds.
    expect(v1.kinds).toEqual([
      MarginfiInstruction.LendingAccountStartFlashloan,
      "compute budget",
      "compute budget",
      MarginfiInstruction.LendingAccountBorrow,
      "swap",
      MarginfiInstruction.LendingAccountDeposit,
      MarginfiInstruction.LendingAccountEndFlashloan,
    ]);
    expect(v1.kinds).toEqual(v0.kinds);
    expect(v1.endIndex).toBe(6n);
    expect(v1.endIndex).toBe(v0.endIndex);

    expect(v0.requests).toHaveLength(1);
    expect(v0.requests[0].footprint?.txFormat).toEqual({ version: 0, luts: {} });
    expect(v1.requests).toHaveLength(1);
    expect(v1.requests[0].footprint?.txFormat).toEqual({ version: 1 });
  });
});
