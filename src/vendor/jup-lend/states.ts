import type { GetMultipleAccountsApi, Rpc } from "@solana/kit";
import { getMintDecoder } from "@solana-program/token";

import {
  decodeJupLendingRewardsRateModel,
  decodeJupLendingState,
  decodeJupRateModel,
  decodeJupTokenReserve,
} from "./accounts";
import { deriveJupLendRateModel } from "./pda";
import {
  jupLendingRewardsRateModelRawToDto,
  jupLendingStateRawToDto,
  jupRateModelRawToDto,
  jupTokenReserveRawToDto,
} from "./serialize";
import type { JupLendBankInput, JupLendStates, JupLendStatesJSON } from "./types";

import { DEFAULT_ADDRESS } from "~/constants";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/utils";

/**
 * Fetches each bank's {@link JupLendStates}, keyed by bank address. Banks with a default lending
 * state or a missing lending state, token reserve or fToken mint are left out.
 * @throws if a fetched account isn't the JupLend account it should be
 */
export async function fetchJupLendStates(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: JupLendBankInput[]
): Promise<Record<string, JupLendStates>> {
  const validBanks = banks.filter((bank) => bank.lendingState !== DEFAULT_ADDRESS);
  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    validBanks.map((bank) => bank.lendingState)
  );
  const decoded = validBanks.flatMap((bank, i) => {
    const lending = accounts[i];
    return lending
      ? [
          {
            bankAddress: bank.bankAddress,
            lendingState: decodeJupLendingState(bank.lendingState, lending.data),
          },
        ]
      : [];
  });

  const rateModels = await Promise.all(
    decoded.map(async ({ lendingState }) => (await deriveJupLendRateModel(lendingState.mint))[0])
  );
  const venueAccounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    decoded.flatMap(({ lendingState }, i) => [
      lendingState.tokenReservesLiquidity,
      lendingState.rewardsRateModel,
      lendingState.fTokenMint,
      rateModels[i],
    ])
  );

  return Object.fromEntries(
    decoded.flatMap(({ bankAddress, lendingState }, i) => {
      const [tokenReserve, rewardsRateModel, fTokenMint, rateModel] = venueAccounts.slice(
        4 * i,
        4 * i + 4
      );
      return tokenReserve && fTokenMint
        ? [
            [
              bankAddress,
              {
                lendingState,
                tokenReserveState: decodeJupTokenReserve(
                  lendingState.tokenReservesLiquidity,
                  tokenReserve.data
                ),
                rewardsRateModel:
                  rewardsRateModel && lendingState.rewardsRateModel !== DEFAULT_ADDRESS
                    ? decodeJupLendingRewardsRateModel(rewardsRateModel.data)
                    : null,
                rateModel: rateModel ? decodeJupRateModel(rateModel.data) : null,
                fTokenTotalSupply: getMintDecoder().decode(fTokenMint.data).supply,
              },
            ],
          ]
        : [];
    })
  );
}

/**
 * {@link fetchJupLendStates} in the JSON wire format served by API routes.
 * @throws see {@link fetchJupLendStates}
 */
export async function fetchJupLendStatesDto(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: JupLendBankInput[]
): Promise<Record<string, JupLendStatesJSON>> {
  const states = await fetchJupLendStates(rpc, banks);
  return Object.fromEntries(
    Object.entries(states).map(([bank, state]) => [
      bank,
      {
        lendingState: jupLendingStateRawToDto(state.lendingState),
        tokenReserveState: jupTokenReserveRawToDto(state.tokenReserveState),
        rewardsRateModel:
          state.rewardsRateModel && jupLendingRewardsRateModelRawToDto(state.rewardsRateModel),
        rateModel: state.rateModel && jupRateModelRawToDto(state.rateModel),
        fTokenTotalSupply: state.fTokenTotalSupply.toString(),
      },
    ])
  );
}
