import { AnchorProvider, BorshCoder, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { account } from "../../helpers/marginfi";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import { HealthCacheStatus, simulateAccountHealthCacheWithFallback } from "~/services/account";
import { simulateBundle } from "~/services/transaction";
import { AccountType, type MarginfiProgram } from "~/types";

vi.mock("~/services/transaction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/services/transaction")>()),
  simulateBundle: vi.fn(),
}));

const program = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(
    {
      rpcEndpoint: "http://simulate.test",
      getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58() }),
    } as unknown as Connection,
    {} as Wallet,
    {}
  )
) as unknown as MarginfiProgram;

// A post-simulation account with an empty health cache and no errors
const simulatedAccountData = (() => {
  const coder = new BorshCoder(program.idl);
  const idlAccount = program.idl.accounts.find((a) => a.name === AccountType.MarginfiAccount);
  const data = Buffer.alloc(coder.accounts.size(AccountType.MarginfiAccount));
  Buffer.from(idlAccount?.discriminator ?? []).copy(data);
  return data.toString("base64");
})();

describe("simulateAccountHealthCacheWithFallback", () => {
  it("marks a simulated health cache as on-chain", async () => {
    vi.mocked(simulateBundle).mockResolvedValue([
      { logs: [], postExecutionAccounts: [] },
      { logs: [], postExecutionAccounts: [{ data: [simulatedAccountData, "base64"] }] },
    ]);

    const result = await simulateAccountHealthCacheWithFallback({
      program,
      banksMap: new Map(),
      oraclePricesByBank: new Map(),
      marginfiAccount: account([]),
      bankIntegrationMap: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.marginfiAccount.healthCache.simulationStatus).toBe(HealthCacheStatus.ONCHAIN);
  });
});
