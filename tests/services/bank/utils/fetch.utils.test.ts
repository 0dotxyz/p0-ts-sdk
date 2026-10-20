import { address, getAddressEncoder, getBase64Encoder, type Address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import bankFixtures from "../../../fixtures/mainnet-banks.json";
import fixture from "../../../fixtures/mainnet-integration.json";
import { addr } from "../../../helpers/addresses";
import { fakeRpc } from "../../../helpers/rpc";

import { DEFAULT_ADDRESS, MARGINFI_PROGRAM } from "~/constants";
import { AssetTag } from "~/services/bank";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import {
  fetchBank,
  fetchBankIntegrationMetadata,
  fetchMultipleBanks,
} from "~/services/bank/utils/fetch.utils";
import { fetchDriftStatesDto, getDriftCTokenMultiplier } from "~/vendor/drift";
import { fetchJupLendStatesDto, getJupLendFTokenMultiplier } from "~/vendor/jup-lend";
import { fetchKaminoStatesDto, getKaminoCTokenMultiplier } from "~/vendor/klend";

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

describe("bank integration metadata", () => {
  it("fetches each bank's venue state into the metadata map", async () => {
    const { rpc } = mockRpc();
    const metadata = await fetchBankIntegrationMetadata(rpc, [kaminoBank, driftBank, jupLendBank]);

    const kamino = metadata[kaminoBank.address].kaminoStates;
    const drift = metadata[driftBank.address].driftStates;
    const jupLend = metadata[jupLendBank.address].jupLendStates;
    expect(kamino?.farmState).toBeDefined();
    expect(drift?.userRewards).toEqual([]);
    expect(jupLend?.rewardsRateModel).not.toBeNull();

    expect({
      kamino: getKaminoCTokenMultiplier(kamino!.reserveState).toString(),
      drift: getDriftCTokenMultiplier(drift!.spotMarketState).toString(),
      jupLend: getJupLendFTokenMultiplier(
        jupLend!.lendingState,
        jupLend!.tokenReserveState,
        jupLend!.rewardsRateModel,
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
      kamino: await fetchKaminoStatesDto(rpc, [
        {
          bankAddress: kaminoBank.address,
          reserve: kaminoIntegrationAccounts.kaminoReserve,
          obligation: kaminoIntegrationAccounts.kaminoObligation,
        },
      ]),
      drift: await fetchDriftStatesDto(rpc, [
        {
          bankAddress: driftBank.address,
          spotMarket: driftIntegrationAccounts.driftSpotMarket,
          user: driftIntegrationAccounts.driftUser,
        },
      ]),
      jupLend: await fetchJupLendStatesDto(rpc, [
        {
          bankAddress: jupLendBank.address,
          lendingState: jupLendIntegrationAccounts.jupLendingState,
        },
      ]),
    }).toMatchSnapshot();
  });

  it("skips banks with default venue addresses without fetching them", async () => {
    const { rpc, requested } = mockRpc();

    const states = await fetchKaminoStatesDto(rpc, [
      { bankAddress: kaminoBank.address, reserve: DEFAULT_ADDRESS, obligation: DEFAULT_ADDRESS },
    ]);

    expect(states).toEqual({});
    expect(requested).toEqual([]);
  });
});

// The recorded mainnet banks, served by getProgramAccounts when the scan's group filter matches
// their data, and by getMultipleAccounts when they're asked for
function bankRpc() {
  const recorded = bankFixtures.map(({ address: bankAddress, data }) => ({
    pubkey: address(bankAddress),
    account: {
      data: [data, "base64"],
      executable: false,
      lamports: 1n,
      owner: MARGINFI_PROGRAM,
      space: BigInt(getBase64Encoder().encode(data).length),
    },
  }));
  const scans: { offset: bigint; bytes: string }[][] = [];
  const rpc = {
    getProgramAccounts: (
      _: Address,
      config: { filters: { memcmp: { offset: bigint; bytes: string } }[] }
    ) => ({
      send: async () => {
        scans.push(config.filters.map(({ memcmp }) => memcmp));
        const groupFilter = config.filters[1]?.memcmp;
        return recorded.filter(({ account }) => {
          if (!groupFilter) return true;
          const bytes = getBase64Encoder().encode(account.data[0]);
          const group = getAddressEncoder().encode(groupFilter.bytes as Address);
          return group.every((byte, i) => bytes[Number(groupFilter.offset) + i] === byte);
        });
      },
    }),
    getMultipleAccounts: (addresses: Address[]) => ({
      send: async () => ({
        context: { slot: 1n },
        value: addresses.map((a) => recorded.find(({ pubkey }) => pubkey === a)?.account ?? null),
      }),
    }),
  };
  return { rpc: rpc as never, scans };
}

describe("fetchBank", () => {
  it("throws when the bank doesn't exist", async () => {
    const missing = addr();
    await expect(fetchBank(fakeRpc({ accountsExist: false }), missing)).rejects.toThrow(
      `Bank ${missing} not found`
    );
  });
});

describe("fetchMultipleBanks", () => {
  it("scans for the group's banks, filtering at the group's offset in the bank data", async () => {
    const { rpc, scans } = bankRpc();
    const { group } = banks[0];

    const fetched = await fetchMultipleBanks(rpc, MARGINFI_PROGRAM, { groupAddress: group });

    expect(scans[0][1]).toEqual({ offset: 41n, bytes: group, encoding: "base58" });
    expect(fetched.map((bank) => bank.address)).toEqual(bankFixtures.map((b) => b.address));
  });

  it("fetches the given banks, leaving out those that don't exist", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc } = bankRpc();
    const [first] = bankFixtures;

    const fetched = await fetchMultipleBanks(rpc, MARGINFI_PROGRAM, {
      bankAddresses: [address(first.address), addr()],
    });

    expect(fetched.map((bank) => bank.address)).toEqual([first.address]);
  });
});
