import {
  address,
  createNoopSigner,
  getAddressDecoder,
  isSignerRole,
  isWritableRole,
  type Instruction,
} from "@solana/kit";
import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { OperationalState, RiskTier } from "~/services/bank/types";
import {
  makeAddPermissionlessStakedBankIx,
  makePoolAddBankIx,
} from "~/services/group/group.service";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");

const serialize = (ix: Instruction) => ({
  programAddress: ix.programAddress,
  accounts: ix.accounts?.map((meta) => [
    meta.address,
    isSignerRole(meta.role),
    isWritableRole(meta.role),
  ]),
  data: Buffer.from(ix.data ?? []).toString("hex"),
});

// Wire format matches the v2.8.3 (Anchor) builders for the same inputs.
describe("group admin instructions", () => {
  it("adds a bank with a compact config (two-point curve padded to five)", async () => {
    const ix = await makePoolAddBankIx({
      programAddress,
      groupAddress: key(1),
      admin: createNoopSigner(key(5)),
      globalFeeWallet: key(6),
      feePayer: createNoopSigner(key(3)),
      bank: createNoopSigner(key(2)),
      bankMint: key(4),
      bankConfig: {
        assetWeightInit: new BigNumber(0.8),
        assetWeightMaint: new BigNumber(0.9),
        liabilityWeightInit: new BigNumber(1.2),
        liabilityWeightMaint: new BigNumber(1.1),
        depositLimit: new BigNumber(1000),
        borrowLimit: new BigNumber(500),
        operationalState: OperationalState.ReduceOnly,
        interestRateConfig: {
          insuranceFeeFixedApr: new BigNumber(0.01),
          insuranceIrFee: new BigNumber(0.02),
          protocolFixedFeeApr: new BigNumber(0.03),
          protocolIrFee: new BigNumber(0.04),
          protocolOriginationFee: new BigNumber(0.005),
          zeroUtilRate: 100,
          hundredUtilRate: 90000,
          points: [
            { util: 1000, rate: 2000 },
            { util: 3000, rate: 4000 },
          ],
        },
        riskTier: RiskTier.Isolated,
        assetTag: 3,
        totalAssetValueInitLimit: new BigNumber(12345),
        oracleMaxConfidence: 7,
        oracleMaxAge: 60,
      },
    });

    expect(serialize(ix)).toMatchSnapshot();
  });

  it("adds a permissionless staked bank for a validator's single pool", async () => {
    const ix = await makeAddPermissionlessStakedBankIx({
      programAddress,
      groupAddress: address("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8"),
      voteAccountAddress: address("48oxpSHQkM4sdXUY9NQ8KnEtebzZbyk8uUT7JRdVQNuf"),
      feePayer: createNoopSigner(key(8)),
      pythOracle: address("7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE"),
    });

    expect(serialize(ix)).toMatchSnapshot();
  });
});
