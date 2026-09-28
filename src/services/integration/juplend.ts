import type { Address, GetMultipleAccountsApi, Rpc } from "@solana/kit";
import { getMintDecoder } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import { DEFAULT_ADDRESS } from "~/constants";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import {
  calculateJupLendNewExchangePrice,
  decodeJupLendingRewardsRateModel,
  decodeJupLendingState,
  decodeJupRateModel,
  decodeJupTokenReserve,
  deriveJupLendRateModel,
  JUP_EXCHANGE_PRICES_PRECISION,
  jupLendingRewardsRateModelRawToDto,
  jupLendingStateRawToDto,
  jupRateModelRawToDto,
  jupTokenReserveRawToDto,
  type JupLendingRewardsRateModel,
  type JupLendingRewardsRateModelJSON,
  type JupLendingState,
  type JupLendingStateJSON,
  type JupRateModel,
  type JupRateModelJSON,
  type JupTokenReserve,
  type JupTokenReserveJSON,
} from "~/vendor/jup-lend";

export interface JupLendBankInput {
  bankAddress: Address;
  lendingState: Address;
}

export type JupLendStateByBank = Record<
  string,
  {
    jupLendingState: JupLendingState;
    jupTokenReserveState: JupTokenReserve;
    jupRewardsRateModel: JupLendingRewardsRateModel | null;
    jupRateModel: JupRateModel | null;
    fTokenTotalSupply: bigint;
  }
>;

export type JupLendStateJsonByBank = Record<
  string,
  {
    jupLendingState: JupLendingStateJSON;
    jupTokenReserveState: JupTokenReserveJSON;
    jupRewardsRateModel: JupLendingRewardsRateModelJSON | null;
    jupRateModel: JupRateModelJSON | null;
    fTokenTotalSupply: string;
  }
>;

/**
 * Fetches each bank's JupLend lending state, then its token reserve, rewards rate model, rate
 * model and fToken supply, keyed by bank address. Banks with a default lending-state address, or a
 * missing or undecodable lending state, token reserve or fToken mint, are left out; a missing or
 * undecodable rewards rate model or rate model is `null`.
 */
export async function fetchJupLendStates(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: JupLendBankInput[]
): Promise<JupLendStateByBank> {
  const validBanks = banks.filter((bank) => bank.lendingState !== DEFAULT_ADDRESS);
  const lendingAccounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    validBanks.map((bank) => bank.lendingState)
  );

  const lendingStates = validBanks.flatMap((bank, i) => {
    const account = lendingAccounts[i];
    if (!account) {
      console.warn("JupLend Lending state account not found for bank:", bank.bankAddress);
      return [];
    }
    try {
      return [
        {
          bankAddress: bank.bankAddress,
          lendingState: decodeJupLendingState(bank.lendingState, account.data),
        },
      ];
    } catch (e) {
      console.warn("Failed to decode JupLend Lending state for bank:", bank.bankAddress, e);
      return [];
    }
  });

  const rateModels = await Promise.all(
    lendingStates.map(
      async ({ lendingState }) => (await deriveJupLendRateModel(lendingState.mint))[0]
    )
  );
  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    lendingStates.flatMap(({ lendingState }, i) => [
      lendingState.tokenReservesLiquidity,
      lendingState.rewardsRateModel,
      lendingState.fTokenMint,
      rateModels[i],
    ])
  );

  const states: JupLendStateByBank = {};
  lendingStates.forEach(({ bankAddress, lendingState }, i) => {
    const [tokenReserveAccount, rewardsRateModelAccount, fTokenMintAccount, rateModelAccount] =
      accounts.slice(4 * i, 4 * i + 4);

    if (!tokenReserveAccount) {
      console.warn("JupLend TokenReserve account not found for bank:", bankAddress);
      return;
    }
    if (!fTokenMintAccount) {
      console.warn("JupLend fToken mint account not found for bank:", bankAddress);
      return;
    }

    let tokenReserveState: JupTokenReserve;
    try {
      tokenReserveState = decodeJupTokenReserve(
        lendingState.tokenReservesLiquidity,
        tokenReserveAccount.data
      );
    } catch (e) {
      console.warn("Failed to decode JupLend TokenReserve for bank:", bankAddress, e);
      return;
    }

    let fTokenTotalSupply: bigint;
    try {
      fTokenTotalSupply = getMintDecoder().decode(fTokenMintAccount.data).supply;
    } catch (e) {
      console.warn("Failed to decode JupLend fToken mint for bank:", bankAddress, e);
      return;
    }

    let rewardsRateModel: JupLendingRewardsRateModel | null = null;
    if (rewardsRateModelAccount && lendingState.rewardsRateModel !== DEFAULT_ADDRESS) {
      try {
        rewardsRateModel = decodeJupLendingRewardsRateModel(rewardsRateModelAccount.data);
      } catch (e) {
        console.warn("Failed to decode JupLend RewardsRateModel for bank:", bankAddress, e);
      }
    }

    let rateModel: JupRateModel | null = null;
    if (rateModelAccount) {
      try {
        rateModel = decodeJupRateModel(rateModelAccount.data);
      } catch (e) {
        console.warn("Failed to decode JupLend RateModel for bank:", bankAddress, e);
      }
    }

    states[bankAddress] = {
      jupLendingState: lendingState,
      jupTokenReserveState: tokenReserveState,
      jupRewardsRateModel: rewardsRateModel,
      jupRateModel: rateModel,
      fTokenTotalSupply,
    };
  });

  return states;
}

/** {@link fetchJupLendStates} in the JSON wire format served by API routes. */
export async function getJupLendStatesDto(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: JupLendBankInput[]
): Promise<JupLendStateJsonByBank> {
  const states = await fetchJupLendStates(rpc, banks);
  return Object.fromEntries(
    Object.entries(states).map(([bank, state]) => [
      bank,
      {
        jupLendingState: jupLendingStateRawToDto(state.jupLendingState),
        jupTokenReserveState: jupTokenReserveRawToDto(state.jupTokenReserveState),
        jupRewardsRateModel:
          state.jupRewardsRateModel &&
          jupLendingRewardsRateModelRawToDto(state.jupRewardsRateModel),
        jupRateModel: state.jupRateModel && jupRateModelRawToDto(state.jupRateModel),
        fTokenTotalSupply: state.fTokenTotalSupply.toString(),
      },
    ])
  );
}

/**
 * Underlying tokens (native units) per JupLend fToken at `nowSeconds` (unix seconds): the projected
 * exchange price over its 1e12 precision.
 */
export function getJupLendFTokenMultiplier(
  lendingState: JupLendingState,
  tokenReserve: JupTokenReserve,
  rewardsModel: JupLendingRewardsRateModel | null,
  fTokenTotalSupply: bigint,
  nowSeconds: number
): BigNumber {
  const exchangePrice = calculateJupLendNewExchangePrice(
    lendingState,
    tokenReserve,
    rewardsModel,
    fTokenTotalSupply,
    BigInt(nowSeconds)
  );

  return new BigNumber(exchangePrice.toString()).dividedBy(
    JUP_EXCHANGE_PRICES_PRECISION.toString()
  );
}
