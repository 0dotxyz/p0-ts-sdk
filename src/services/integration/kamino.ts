import type { Address, GetMultipleAccountsApi, Rpc } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { DEFAULT_ADDRESS } from "~/constants";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import {
  decodeKaminoFarmState,
  decodeKlendObligation,
  decodeKlendReserve,
  kaminoFarmStateToDto,
  kaminoObligationToDto,
  kaminoReserveToDto,
  scaledSupplies,
  type KaminoFarmState,
  type KaminoFarmStateJSON,
  type KaminoObligation,
  type KaminoObligationJSON,
  type KaminoReserve,
  type KaminoReserveJSON,
} from "~/vendor/klend";

export interface KaminoBankInput {
  bankAddress: Address;
  reserve: Address;
  obligation: Address;
}

export type KaminoStateByBank = Record<
  string,
  { reserveState: KaminoReserve; obligationState: KaminoObligation; farmState?: KaminoFarmState }
>;

export type KaminoStateJsonByBank = Record<
  string,
  {
    reserveState: KaminoReserveJSON;
    obligationState: KaminoObligationJSON;
    farmState?: KaminoFarmStateJSON;
  }
>;

/**
 * Fetches each bank's Kamino reserve and obligation, plus the reserve's collateral farm when it has
 * one, keyed by bank address. Banks with a default reserve or obligation address, or a missing
 * account, are left out.
 */
export async function fetchKaminoStates(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: KaminoBankInput[]
): Promise<KaminoStateByBank> {
  const validBanks = banks.filter(
    (bank) => bank.reserve !== DEFAULT_ADDRESS && bank.obligation !== DEFAULT_ADDRESS
  );
  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    validBanks.flatMap((bank) => [bank.reserve, bank.obligation])
  );

  const states: KaminoStateByBank = {};
  validBanks.forEach((bank, i) => {
    const reserve = accounts[2 * i];
    const obligation = accounts[2 * i + 1];
    if (reserve && obligation) {
      states[bank.bankAddress] = {
        reserveState: decodeKlendReserve(reserve.data),
        obligationState: decodeKlendObligation(obligation.data),
      };
    }
  });

  const farmBanks = Object.keys(states).filter(
    (bank) => states[bank].reserveState.farmCollateral !== DEFAULT_ADDRESS
  );
  const farms = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    farmBanks.map((bank) => states[bank].reserveState.farmCollateral)
  );
  farmBanks.forEach((bank, i) => {
    const farm = farms[i];
    if (farm) {
      states[bank].farmState = decodeKaminoFarmState(farm.data);
    }
  });

  return states;
}

/** {@link fetchKaminoStates} in the JSON wire format served by API routes. */
export async function getKaminoStatesDto(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: KaminoBankInput[]
): Promise<KaminoStateJsonByBank> {
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

/** Underlying tokens per Kamino cToken of `reserve` (1 when it has no collateral yet). */
export function getKaminoCTokenMultiplier(reserve: KaminoReserve): BigNumber {
  const [totalLiquidity, totalCollateral] = scaledSupplies(reserve);

  return totalCollateral.isZero()
    ? new BigNumber(1)
    : new BigNumber(totalLiquidity.dividedBy(totalCollateral).toString());
}
