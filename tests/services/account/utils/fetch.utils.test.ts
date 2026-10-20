import { address, getAddressEncoder, getBase64Encoder, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import accountFixtures from "../../../fixtures/mainnet-accounts.json";
import { addr } from "../../../helpers/addresses";
import { fakeRpc } from "../../../helpers/rpc";

import { MARGINFI_PROGRAM, MAX_BALANCES } from "~/constants";
import { TransactionBuildingErrorCode } from "~/errors";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import {
  fetchGlobalFeeWallet,
  fetchMarginfiAccountActiveBalancesForBank,
  fetchMarginfiAccountAddresses,
  fetchMarginfiAccountAddressesHoldingBank,
} from "~/services/account/utils/fetch.utils";

const { address: accountAddress, data: accountData } = accountFixtures[1];
const account = decodeMarginfiAccount(
  address(accountAddress),
  getBase64Encoder().encode(accountData)
);
const group = account.group;

type Filters = { memcmp: { offset: bigint; bytes: string } }[];

// Answers getProgramAccounts with the recorded account for every scan whose bank filter matches
// one of its balance slots, and records each call's filters
function programAccountsRpc(opts: { delayMs?: number } = {}) {
  const calls: Filters[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const rpc = {
    getProgramAccounts: (_program: Address, config: { filters: Filters }) => ({
      send: async () => {
        calls.push(config.filters);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 0));
        inFlight--;
        const [, , slotFilter] = config.filters;
        const bytes = getBase64Encoder().encode(accountData);
        const key = getAddressEncoder().encode(slotFilter.memcmp.bytes as Address);
        const offset = Number(slotFilter.memcmp.offset);
        const matches = key.every((byte, i) => bytes[offset + i] === byte);
        return matches
          ? [
              {
                pubkey: address(accountAddress),
                account: {
                  data: [accountData, "base64"],
                  executable: false,
                  lamports: 1n,
                  owner: MARGINFI_PROGRAM,
                  space: BigInt(bytes.length),
                },
              },
            ]
          : [];
      },
    }),
  };
  return { rpc: rpc as never, calls, maxInFlight: () => maxInFlight };
}

const [{ bankPk: heldBank }] = account.balances.filter((balance) => balance.active);

describe("fetchMarginfiAccountAddressesHoldingBank", () => {
  it("scans each balance slot at its bank key's offset in the account data", async () => {
    const { rpc, calls } = programAccountsRpc();

    const addresses = await fetchMarginfiAccountAddressesHoldingBank(
      rpc,
      MARGINFI_PROGRAM,
      group,
      heldBank
    );

    expect(calls).toHaveLength(MAX_BALANCES);
    expect(calls.map(([, groupFilter]) => groupFilter.memcmp.offset)).toEqual(
      Array(MAX_BALANCES).fill(8n)
    );
    expect(calls.map(([, , slotFilter]) => slotFilter.memcmp.offset)).toEqual(
      Array.from({ length: MAX_BALANCES }, (_, n) => BigInt(73 + n * 104))
    );
    expect(addresses).toEqual([address(accountAddress)]);
  });

  it("runs at most `concurrency` slot scans at a time", async () => {
    const { rpc, calls, maxInFlight } = programAccountsRpc({ delayMs: 1 });

    await fetchMarginfiAccountAddressesHoldingBank(rpc, MARGINFI_PROGRAM, group, heldBank, {
      concurrency: 4,
    });

    expect(calls).toHaveLength(MAX_BALANCES);
    expect(maxInFlight()).toBe(4);
  });
});

describe("fetchMarginfiAccountActiveBalancesForBank", () => {
  it("returns each holder's authority and its balance in the bank", async () => {
    const { rpc } = programAccountsRpc();

    const holders = await fetchMarginfiAccountActiveBalancesForBank(
      rpc,
      MARGINFI_PROGRAM,
      group,
      heldBank
    );

    expect(holders).toHaveLength(1);
    expect(holders[0].accountAddress).toBe(address(accountAddress));
    expect(holders[0].authority).toBe(account.authority);
    expect(holders[0].balance.bankPk).toBe(heldBank);
    expect(holders[0].balance.active).toBe(true);
  });

  it("finds nothing for a bank no account holds", async () => {
    const { rpc } = programAccountsRpc();
    expect(
      await fetchMarginfiAccountActiveBalancesForBank(rpc, MARGINFI_PROGRAM, group, addr())
    ).toEqual([]);
  });
});

describe("fetchMarginfiAccountAddresses", () => {
  it("filters by the group after the discriminator and the authority after the group", async () => {
    const { rpc, calls } = programAccountsRpc();
    const authority = addr();

    await fetchMarginfiAccountAddresses(rpc, MARGINFI_PROGRAM, authority, group);

    const [, groupFilter, authorityFilter] = calls[0];
    expect(groupFilter.memcmp).toMatchObject({ offset: 8n, bytes: group });
    expect(authorityFilter.memcmp).toMatchObject({ offset: 40n, bytes: authority });
  });
});

describe("fetchGlobalFeeWallet", () => {
  it("throws FEE_STATE_NOT_FOUND when the program has no fee state", async () => {
    await expect(
      fetchGlobalFeeWallet(fakeRpc({ accountsExist: false }), MARGINFI_PROGRAM)
    ).rejects.toMatchObject({ code: TransactionBuildingErrorCode.FEE_STATE_NOT_FOUND });
  });
});
