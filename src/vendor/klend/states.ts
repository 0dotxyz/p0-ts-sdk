import type { GetMultipleAccountsApi, Rpc } from "@solana/kit";

import { decodeKaminoFarmState, decodeKlendObligation, decodeKlendReserve } from "./accounts";
import { kaminoFarmStateToDto, kaminoObligationToDto, kaminoReserveToDto } from "./serialize";
import type { KaminoBankInput, KaminoStates, KaminoStatesJSON } from "./types";

import { DEFAULT_ADDRESS } from "~/constants";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/utils";

/**
 * Fetches each bank's {@link KaminoStates}, keyed by bank address. Banks with a default venue
 * address or a missing reserve or obligation are left out.
 * @throws if a fetched account isn't the Kamino account it should be
 */
export async function fetchKaminoStates(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: KaminoBankInput[]
): Promise<Record<string, KaminoStates>> {
  const validBanks = banks.filter(
    (bank) => bank.reserve !== DEFAULT_ADDRESS && bank.obligation !== DEFAULT_ADDRESS
  );
  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    validBanks.flatMap((bank) => [bank.reserve, bank.obligation])
  );
  const decoded = validBanks.flatMap((bank, i) => {
    const [reserve, obligation] = accounts.slice(2 * i, 2 * i + 2);
    return reserve && obligation
      ? [
          {
            bankAddress: bank.bankAddress,
            reserveState: decodeKlendReserve(reserve.data),
            obligationState: decodeKlendObligation(obligation.data),
          },
        ]
      : [];
  });

  const withFarm = decoded.filter(
    ({ reserveState }) => reserveState.farmCollateral !== DEFAULT_ADDRESS
  );
  const farms = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    withFarm.map(({ reserveState }) => reserveState.farmCollateral)
  );
  const farmByBank = new Map(withFarm.map(({ bankAddress }, i) => [bankAddress, farms[i]]));

  return Object.fromEntries(
    decoded.map(({ bankAddress, reserveState, obligationState }) => {
      const farm = farmByBank.get(bankAddress);
      return [
        bankAddress,
        { reserveState, obligationState, farmState: farm ? decodeKaminoFarmState(farm.data) : undefined },
      ];
    })
  );
}

/**
 * {@link fetchKaminoStates} in the JSON wire format served by API routes.
 * @throws see {@link fetchKaminoStates}
 */
export async function fetchKaminoStatesDto(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: KaminoBankInput[]
): Promise<Record<string, KaminoStatesJSON>> {
  const states = await fetchKaminoStates(rpc, banks);
  return Object.fromEntries(
    Object.entries(states).map(([bank, { reserveState, obligationState, farmState }]) => [
      bank,
      {
        reserveState: kaminoReserveToDto(reserveState),
        obligationState: kaminoObligationToDto(obligationState),
        farmState: farmState && kaminoFarmStateToDto(farmState),
      },
    ])
  );
}
