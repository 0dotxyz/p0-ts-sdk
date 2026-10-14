import { describe, expect, it, vi } from "vitest";

import { addr } from "../../../helpers/addresses";
import { makeBank } from "../../../helpers/factories";
import { fakeRpc } from "../../../helpers/rpc";

import { OracleSetup } from "~/services/bank";
import { fetchOracleMultipliers } from "~/services/price";

const endpoint = "http://multipliers.test";

const lstBank = (stakePool = addr()) =>
  makeBank({ config: { oracleSetup: OracleSetup.PythLST, oracleKeys: [addr(), stakePool] } });

// Serves a stake pool exchange rate for every requested account, read at the pool's update epoch
function stubMultiplierApi(exchangeRate: string) {
  const fetch = vi.fn(async (url: string) => {
    const accounts = new URL(url).searchParams.get("multiplierAccounts")?.split(",") ?? [];
    const states = Object.fromEntries(
      accounts.map((account) => [account, { kind: "stakePool", exchangeRate, lastUpdateEpoch: 7 }])
    );
    return new Response(JSON.stringify({ data: { states, currentEpoch: 7 } }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("fetchOracleMultipliers", () => {
  it("fetches nothing for banks that aren't multiplier-priced", async () => {
    const fetch = stubMultiplierApi("1.2");
    const pyth = makeBank();

    expect(
      await fetchOracleMultipliers([pyth], { mode: "api", multiplierData: { endpoint } })
    ).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prices nothing, with a warning, without options", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await fetchOracleMultipliers([lstBank()])).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads each multiplier account once through the API", async () => {
    const fetch = stubMultiplierApi("1.2");
    const stakePool = addr();
    const [a, b] = [lstBank(stakePool), lstBank(stakePool)];

    const multipliers = await fetchOracleMultipliers([a, b], {
      mode: "api",
      multiplierData: { endpoint },
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(`${endpoint}?multiplierAccounts=${stakePool}`);
    expect(multipliers).toEqual({ [a.address]: 1.2, [b.address]: 1.2 });
  });

  it("leaves out a bank whose multiplier account is missing on chain", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const multipliers = await fetchOracleMultipliers([lstBank()], {
      mode: "on-chain",
      rpc: fakeRpc({ accountsExist: false }),
    });

    expect(multipliers).toEqual({});
  });
});
