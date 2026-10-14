import {
  address,
  createNoopSigner,
  getBase16Decoder,
  getBase64Encoder,
  isSignerRole,
  isWritableRole,
  type Instruction,
} from "@solana/kit";

import expected from "../fixtures/lending-actions-v2.8.3.json";

import { mainnetAccount, mainnetBankMap, mainnetBanks } from "./mainnet";

import type { BankIntegrationMetadataMap } from "~/types";
import { decodeDriftSpotMarket, SpotBalanceType } from "~/vendor/drift";
import { decodeJupLendingState } from "~/vendor/jup-lend";

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Instructions the v2.8.3 (Anchor) builders built from the inputs below
export const v283Cases = expected.cases;

const driftSpotMarket = decodeDriftSpotMarket(base64.encode(expected.venues.driftSpotMarket));
const jupLendingState = decodeJupLendingState(
  address("BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3"),
  base64.encode(expected.venues.jupLendingState)
);

export const venueMetadataMap = {
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

const marginfiAccount = mainnetAccount();

export const depositParams = {
  programAddress,
  tokenProgram,
  marginfiAccount,
  authority: createNoopSigner(marginfiAccount.authority),
  bankMetadataMap: venueMetadataMap,
};
export const withdrawParams = { ...depositParams, bankMap: mainnetBankMap };

// The official token client adds SysvarRent to SyncNative; the v2.8.3 builder didn't.
export const toWire = (ixs: Instruction[]) =>
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
