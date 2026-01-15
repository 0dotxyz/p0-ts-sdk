import { Address, Program } from "@coral-xyz/anchor";
import {
  AccountMeta,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { KlendIdlType } from "./idl";
import { bool, struct } from "@coral-xyz/borsh";
import { KLEND_PROGRAM_ID } from "./constants";

/**
 * Refresh a generic Kamino reserve with a legacy Pyth oracle
 * @param program
 * @param reserve
 * @param market
 * @param oracle
 * @returns
 */
type MakeRefreshReserveIxParams = {
  program: Program<KlendIdlType>;
  reserve: PublicKey;
  market: PublicKey;
  pythOracle: PublicKey | null;
  switchboardPriceOracle: PublicKey | null;
  switchboardTwapOracle: PublicKey | null;
  scopePrices: PublicKey | null;
};

const DEFAULT_PUBLIC_KEY: PublicKey = new PublicKey(
  "11111111111111111111111111111111"
);
const NULL_PUBKEY: PublicKey = new PublicKey(
  "nu11111111111111111111111111111111111111111"
);

function isNotNullPubkey(pubkey: PublicKey | null): boolean {
  if (!pubkey) {
    return false;
  }
  return !pubkey.equals(NULL_PUBKEY) && !pubkey.equals(DEFAULT_PUBLIC_KEY);
}

function optionalAccount(pubkey: PublicKey | null): PublicKey | null {
  if (isNotNullPubkey(pubkey)) {
    return pubkey;
  } else {
    return null;
  }
}

const makeRefreshReserveIx = ({
  program,
  reserve,
  market,
  pythOracle,
  switchboardPriceOracle,
  switchboardTwapOracle,
  scopePrices,
}: MakeRefreshReserveIxParams) => {
  const ix = program.methods
    .refreshReserve()
    .accounts({
      reserve: reserve,
      lendingMarket: market,
      pythOracle: optionalAccount(pythOracle),
      switchboardPriceOracle: optionalAccount(switchboardPriceOracle),
      switchboardTwapOracle: optionalAccount(switchboardTwapOracle),
      scopePrices: optionalAccount(scopePrices),
    })
    .instruction();

  return ix;
};

/**
 * Refresh a generic Kamino obligation
 * @param program
 * @param market
 * @param obligation
 * @param remaining - pack the reserves used in this obligation, in the order they appear, starting
 * with lending reserves. For example, a user lending USDC at index 0, SOL at index 1, borrowing
 * BONK at index 0, pass [USDC, SOL, BONK] reserves
 * @returns
 */
export const REFRESH_OBLIGATION_DISCRIMINATOR = Buffer.from([
  33, 132, 147, 228, 151, 192, 72, 89,
]);

export interface RefreshObligationAccounts {
  lendingMarket: Address;
  obligation: Address;
}

export const makeRefreshObligationIx = (
  lendingMarket: PublicKey,
  obligation: PublicKey,
  reserve: PublicKey
): TransactionInstruction => {
  const keys: AccountMeta[] = [
    // lendingMarket: read-only, not a signer
    { pubkey: lendingMarket, isSigner: false, isWritable: false },

    // obligation: writable, not a signer (typical for state being updated)
    { pubkey: obligation, isSigner: false, isWritable: true },

    // any additional metas (e.g., oracles, reserves, payer signer, sysvars, etc.)
    {
      pubkey: reserve,
      isSigner: false,
      isWritable: false,
    },
  ];

  return new TransactionInstruction({
    keys,
    programId: KLEND_PROGRAM_ID,
    data: REFRESH_OBLIGATION_DISCRIMINATOR, // no extra encoding—just the 8-byte discriminator
  });
};

const REFRESH_BATCH_DISCRIMINATOR = Buffer.from([
  144, 110, 26, 103, 162, 204, 252, 147,
]);

interface RefreshReservesBatchArgs {
  skipPriceUpdates: boolean;
}

export const layout = struct<RefreshReservesBatchArgs>([
  bool("skipPriceUpdates"),
]);

type ReserveRemainingAccounts = {
  reserve: PublicKey;
  lendingMarket: PublicKey;
};

export function makeRefreshReservesBatchIx(
  reserves: ReserveRemainingAccounts[],
  programId: PublicKey = KLEND_PROGRAM_ID
) {
  const remainingAccounts = reserves.flatMap((reserve) => [
    {
      pubkey: reserve.reserve,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: reserve.lendingMarket,
      isSigner: false,
      isWritable: false,
    },
  ]);

  const keys: Array<AccountMeta> = [...remainingAccounts];
  const buffer = Buffer.alloc(1000);
  const len = layout.encode(
    {
      skipPriceUpdates: true,
    },
    buffer
  );
  const data = Buffer.concat([REFRESH_BATCH_DISCRIMINATOR, buffer]).slice(
    0,
    8 + len
  );
  const ix = new TransactionInstruction({
    programId,
    keys,
    data,
  });
  return ix;
}

const klendInstructions = {
  makeRefreshReserveIx,
  makeRefreshObligationIx,
  makeRefreshReservesBatchIx,
};

export default klendInstructions;
