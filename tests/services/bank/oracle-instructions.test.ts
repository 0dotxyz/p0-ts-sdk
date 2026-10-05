import { AnchorProvider, BorshCoder, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";
import { describe, expect, it, vi } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import instructions from "~/instructions";
import {
  addOracleToBanksIx,
  configureScopeOracleIx,
  freezeBankConfigIx,
  OracleSetup,
  setOraclePriceIx,
} from "~/services/bank";
import type { MarginfiProgram } from "~/types";

const publicKey = (fill: number) => new PublicKey(new Uint8Array(32).fill(fill));

const camelProgram = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
) as unknown as MarginfiProgram;
const coder = new BorshCoder(camelProgram.idl);

describe("Scope oracle configuration instruction", () => {
  it("encodes the 0.1.12 accounts, with the Kamino reserve after the Scope feed", async () => {
    const group = publicKey(2);
    const governanceAdmin = publicKey(3);
    const bank = publicKey(4);
    const oracle = publicKey(5);
    const reserve = publicKey(6);

    const ix = await instructions.makeLendingPoolConfigureBankOracleScopeIx(
      camelProgram,
      { bank, group, governanceAdmin },
      { oracle, entryIndex: 511, integrationAccount: reserve }
    );

    expect(ix.keys).toEqual([
      { pubkey: group, isSigner: false, isWritable: false },
      { pubkey: governanceAdmin, isSigner: true, isWritable: false },
      { pubkey: bank, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: oracle, isSigner: false, isWritable: false },
      { pubkey: reserve, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(Buffer.from([134, 228, 127, 3, 117, 132, 85, 146]));
    expect(ix.data.subarray(8, 40)).toEqual(oracle.toBuffer());
    expect(ix.data.readUInt16LE(40)).toBe(511);
  });

  it("exposes the typed Anchor builder through the bank service", async () => {
    const bank = publicKey(4);
    const group = publicKey(2);
    const admin = publicKey(3);
    const oracle = publicKey(5);
    const expectedIx = new TransactionInstruction({
      programId: publicKey(1),
      keys: [],
      data: Buffer.alloc(0),
    });
    const instruction = vi.fn().mockResolvedValue(expectedIx);
    const remainingAccounts = vi.fn().mockReturnValue({ instruction });
    const accountsPartial = vi.fn().mockReturnValue({ remainingAccounts });
    const accounts = vi.fn().mockReturnValue({ accountsPartial });
    const lendingPoolConfigureBankOracleScope = vi.fn().mockReturnValue({ accounts });
    const program = {
      methods: { lendingPoolConfigureBankOracleScope },
    } as unknown as MarginfiProgram;

    const wrapper = await configureScopeOracleIx({
      program,
      bankAddress: bank,
      oracle,
      entryIndex: 37,
      groupAddress: group,
      governanceAdminAddress: admin,
    });

    expect(lendingPoolConfigureBankOracleScope).toHaveBeenCalledWith(oracle, 37);
    expect(accounts).toHaveBeenCalledWith({ bank });
    expect(accountsPartial).toHaveBeenCalledWith({ group, governanceAdmin: admin });
    expect(remainingAccounts).toHaveBeenCalledWith([
      { pubkey: oracle, isSigner: false, isWritable: false },
    ]);
    expect(wrapper).toEqual({ instructions: [expectedIx], keys: [] });
  });

  it("routes every Scope setup away from configure-bank-oracle", async () => {
    const program = { methods: {} } as unknown as MarginfiProgram;

    for (const setup of [OracleSetup.Scope, OracleSetup.ScopeKamino, OracleSetup.ScopeJuplend]) {
      await expect(
        addOracleToBanksIx({ program, bankAddress: publicKey(4), feedId: publicKey(5), setup })
      ).rejects.toThrow("configureScopeOracleIx");
    }
  });

  it("forwards every validation account required by multiplier setups", async () => {
    const bank = publicKey(4);
    const feedId = publicKey(5);
    const marinadeState = publicKey(7);
    const expectedIx = new TransactionInstruction({
      programId: publicKey(1),
      keys: [],
      data: Buffer.alloc(0),
    });
    const instruction = vi.fn().mockResolvedValue(expectedIx);
    const remainingAccounts = vi.fn().mockReturnValue({ instruction });
    const accountsPartial = vi.fn().mockReturnValue({ remainingAccounts });
    const accounts = vi.fn().mockReturnValue({ accountsPartial });
    const lendingPoolConfigureBankOracle = vi.fn().mockReturnValue({ accounts });
    const program = {
      methods: { lendingPoolConfigureBankOracle },
    } as unknown as MarginfiProgram;

    await addOracleToBanksIx({
      program,
      bankAddress: bank,
      feedId,
      setup: OracleSetup.PythMSOL,
      oracleAccounts: [feedId, marinadeState],
    });

    expect(lendingPoolConfigureBankOracle).toHaveBeenCalledWith(19, feedId);
    expect(remainingAccounts).toHaveBeenCalledWith([
      { pubkey: feedId, isSigner: false, isWritable: false },
      { pubkey: marinadeState, isSigner: false, isWritable: false },
    ]);
  });

  it("rejects multiplier setups whose first oracle account is not the primary feed", async () => {
    const program = { methods: {} } as unknown as MarginfiProgram;

    await expect(
      addOracleToBanksIx({
        program,
        bankAddress: publicKey(4),
        feedId: publicKey(5),
        setup: OracleSetup.PythMSOL,
        oracleAccounts: [publicKey(6), publicKey(7)],
      })
    ).rejects.toThrow("oracleAccounts[0]");
  });

  it("routes every fixed setup away from configure-bank-oracle", async () => {
    const program = { methods: {} } as unknown as MarginfiProgram;

    for (const setup of [
      OracleSetup.Fixed,
      OracleSetup.FixedKamino,
      OracleSetup.FixedDrift,
      OracleSetup.FixedJuplend,
    ]) {
      await expect(
        addOracleToBanksIx({
          program,
          bankAddress: publicKey(4),
          feedId: publicKey(5),
          setup,
        })
      ).rejects.toThrow("setOraclePriceIx");
    }
  });

  it("routes PT setup through the set-oracle-price instruction", async () => {
    const bank = publicKey(4);
    const pyth = publicKey(6);
    const vault = publicKey(7);
    const expectedIx = new TransactionInstruction({
      programId: publicKey(1),
      keys: [],
      data: Buffer.alloc(0),
    });
    const instruction = vi.fn().mockResolvedValue(expectedIx);
    const remainingAccounts = vi.fn().mockReturnValue({ instruction });
    const accountsPartial = vi.fn().mockReturnValue({ remainingAccounts });
    const accounts = vi.fn().mockReturnValue({ accountsPartial });
    const lendingPoolSetOraclePrice = vi.fn().mockReturnValue({ accounts });
    const program = {
      methods: { lendingPoolSetOraclePrice },
    } as unknown as MarginfiProgram;

    await setOraclePriceIx({
      program,
      bankAddress: bank,
      price: new BigNumber(0.8),
      setup: OracleSetup.PTPyth,
      oracleAccounts: [pyth, vault],
    });

    expect(lendingPoolSetOraclePrice).toHaveBeenCalledWith(expect.anything(), 25);
    expect(remainingAccounts).toHaveBeenCalledWith([
      { pubkey: pyth, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
    ]);

    await expect(
      setOraclePriceIx({
        program,
        bankAddress: bank,
        price: new BigNumber(0.8),
        setup: OracleSetup.PTFixed,
        oracleAccounts: [],
      })
    ).rejects.toThrow("PTFixed requires 1 ordered oracle accounts");
  });
});

describe("Bank configuration instructions", () => {
  const group = publicKey(2);
  const signer = publicKey(3);
  const bank = publicKey(4);

  it("sends the admin's settings through configure_bank (BankConfigFast)", async () => {
    const ix = await instructions.makePoolConfigureBankIx(
      camelProgram,
      { bank, group, admin: signer },
      {
        bankConfigOpt: {
          depositLimit: new BN(1_000),
          borrowLimit: null,
          operationalState: null,
          interestRateConfig: null,
          totalAssetValueInitLimit: null,
          permissionlessBadDebtSettlement: null,
          liquidationLiquidatorFee: null,
          liquidationInsuranceFee: null,
          circuitBreakerEnabled: null,
          cbDeviationBpsTiers: null,
          cbTierDurationsSeconds: null,
          cbEscalationWindowMult: null,
          cbEmaAlphaBps: null,
          cbWindowSeconds: null,
          cbWindowMaxUpBps: null,
          cbWindowMaxDownBps: null,
        },
      }
    );

    const decoded = coder.instruction.decode(ix.data) as {
      name: string;
      data: { bankConfigOpt: { depositLimit: BN } };
    };
    expect(decoded.name).toBe("lendingPoolConfigureBank");
    expect(decoded.data.bankConfigOpt.depositLimit.toNumber()).toBe(1_000);
    expect(ix.keys[1]).toEqual({ pubkey: signer, isSigner: true, isWritable: false });
  });

  it("freezes a bank through configure_bank_gov, signed by the governance admin", async () => {
    const instruction = vi
      .fn()
      .mockResolvedValue(
        new TransactionInstruction({ programId: publicKey(1), keys: [], data: Buffer.alloc(0) })
      );
    const accountsPartial = vi.fn().mockReturnValue({ instruction });
    const accounts = vi.fn().mockReturnValue({ accountsPartial });
    const lendingPoolConfigureBankGov = vi.fn().mockReturnValue({ accounts });
    const program = { methods: { lendingPoolConfigureBankGov } } as unknown as MarginfiProgram;

    await freezeBankConfigIx(program, bank);

    expect(lendingPoolConfigureBankGov).toHaveBeenCalledWith({
      assetWeightInit: null,
      assetWeightMaint: null,
      liabilityWeightInit: null,
      liabilityWeightMaint: null,
      operationalState: null,
      riskTier: null,
      assetTag: null,
      oracleMaxConfidence: null,
      oracleMaxAge: null,
      tokenlessRepaymentsAllowed: null,
      freezeSettings: true,
    });
    expect(accounts).toHaveBeenCalledWith({ bank });
  });

  it("encodes configure_bank_gov with the governance admin as signer", async () => {
    const ix = await instructions.makePoolConfigureBankGovIx(
      camelProgram,
      { bank, group, governanceAdmin: signer },
      {
        bankConfigOpt: {
          assetWeightInit: null,
          assetWeightMaint: null,
          liabilityWeightInit: null,
          liabilityWeightMaint: null,
          operationalState: null,
          riskTier: null,
          assetTag: null,
          oracleMaxConfidence: null,
          oracleMaxAge: 60,
          tokenlessRepaymentsAllowed: null,
          freezeSettings: null,
        },
      }
    );

    const decoded = coder.instruction.decode(ix.data) as {
      name: string;
      data: { bankConfigOpt: { oracleMaxAge: number } };
    };
    expect(decoded.name).toBe("lendingPoolConfigureBankGov");
    expect(decoded.data.bankConfigOpt.oracleMaxAge).toBe(60);
    expect(ix.keys.map((key) => key.pubkey)).toEqual([
      group,
      signer,
      bank,
      SYSVAR_INSTRUCTIONS_PUBKEY,
    ]);
  });
});
