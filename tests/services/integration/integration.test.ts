import { address, getBase64Encoder, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import fixture from "./fixtures/mainnet-integration.json";

import { DEFAULT_ADDRESS } from "~/constants";
import { AssetTag } from "~/services/bank";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import {
  fetchBankIntegrationMetadata,
  getDriftCTokenMultiplier,
  getDriftStatesDto,
  getJupLendFTokenMultiplier,
  getJupLendStatesDto,
  getKaminoCTokenMultiplier,
  getKaminoStatesDto,
} from "~/services/integration";

// One mainnet Kamino (with farm), Drift and JupLend (with rewards model) bank and every account
// their venue state reads. DTO snapshots were checked against v2.8.4 on all 40 mainnet venue banks.
const banks = fixture.banks.map((b) =>
  decodeBank(address(b.address), getBase64Encoder().encode(b.data))
);
const byTag = (tag: AssetTag) => banks.find((bank) => bank.config.assetTag === tag)!;
const [kaminoBank, driftBank, jupLendBank] = [
  AssetTag.KAMINO,
  AssetTag.DRIFT,
  AssetTag.JUPLEND,
].map(byTag);
const accounts = fixture.accounts as Record<
  string,
  { data: string; owner: string; lamports: number; executable: boolean } | null
>;

const mockRpc = () => {
  const requested: Address[] = [];
  const rpc = {
    getMultipleAccounts: (addresses: Address[]) => ({
      send: async () => {
        requested.push(...addresses);
        return {
          context: { slot: 1n },
          value: addresses.map((a) => {
            const account = accounts[a];
            return (
              account && {
                data: [account.data, "base64"],
                owner: account.owner,
                lamports: BigInt(account.lamports),
                executable: account.executable,
                space: BigInt(Buffer.from(account.data, "base64").length),
              }
            );
          }),
        };
      },
    }),
  };
  return { rpc: rpc as never, requested };
};

describe("integration venue states", () => {
  it("fetches each bank's venue state into the metadata map", async () => {
    const { rpc } = mockRpc();
    const metadata = await fetchBankIntegrationMetadata(rpc, [kaminoBank, driftBank, jupLendBank]);

    const kamino = metadata[kaminoBank.address].kaminoStates;
    const drift = metadata[driftBank.address].driftStates;
    const jupLend = metadata[jupLendBank.address].jupLendStates;
    expect(kamino?.farmState).toBeDefined();
    expect(drift?.userRewards).toEqual([]);
    expect(jupLend?.jupRewardsRateModel).not.toBeNull();

    expect({
      kamino: getKaminoCTokenMultiplier(kamino!.reserveState).toString(),
      drift: getDriftCTokenMultiplier(drift!.spotMarketState).toString(),
      jupLend: getJupLendFTokenMultiplier(
        jupLend!.jupLendingState,
        jupLend!.jupTokenReserveState,
        jupLend!.jupRewardsRateModel,
        jupLend!.fTokenTotalSupply,
        1_790_000_000
      ).toString(),
    }).toMatchSnapshot();
  });

  it("serializes the states to the JSON wire format", async () => {
    const { rpc } = mockRpc();
    const kaminoIntegrationAccounts = kaminoBank.kaminoIntegrationAccounts!;
    const driftIntegrationAccounts = driftBank.driftIntegrationAccounts!;
    const jupLendIntegrationAccounts = jupLendBank.jupLendIntegrationAccounts!;

    expect({
      kamino: await getKaminoStatesDto(rpc, [
        {
          bankAddress: kaminoBank.address,
          reserve: kaminoIntegrationAccounts.kaminoReserve,
          obligation: kaminoIntegrationAccounts.kaminoObligation,
        },
      ]),
      drift: await getDriftStatesDto(rpc, [
        {
          bankAddress: driftBank.address,
          spotMarket: driftIntegrationAccounts.driftSpotMarket,
          user: driftIntegrationAccounts.driftUser,
          userStats: driftIntegrationAccounts.driftUserStats,
        },
      ]),
      jupLend: await getJupLendStatesDto(rpc, [
        {
          bankAddress: jupLendBank.address,
          lendingState: jupLendIntegrationAccounts.jupLendingState,
        },
      ]),
    }).toMatchSnapshot();
  });

  it("skips banks with default venue addresses without fetching them", async () => {
    const { rpc, requested } = mockRpc();

    const states = await getKaminoStatesDto(rpc, [
      { bankAddress: kaminoBank.address, reserve: DEFAULT_ADDRESS, obligation: DEFAULT_ADDRESS },
    ]);

    expect(states).toEqual({});
    expect(requested).toEqual([]);
  });
});
