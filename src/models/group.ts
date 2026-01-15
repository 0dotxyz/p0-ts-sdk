import { BorshCoder } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { MarginfiIdlType } from "../idl";
import { AccountType, MarginfiProgram } from "../types";
import {
  BankConfigOpt,
  BankConfigOptRaw,
  fetchMultipleBanks,
  InstructionsWrapper,
  makeAddPermissionlessStakedBankIx,
  makePoolAddBankIx,
  makePoolConfigureBankIx,
  MarginfiGroupRaw,
  MarginfiGroupType,
} from "../services";

import { Bank } from "./bank";

// ----------------------------------------------------------------------------
// Client types
// ----------------------------------------------------------------------------

class MarginfiGroup implements MarginfiGroupType {
  public address: PublicKey;
  public admin: PublicKey;

  constructor(admin: PublicKey, address: PublicKey) {
    this.admin = admin;
    this.address = address;
  }

  static async fetch(address: PublicKey, program: MarginfiProgram): Promise<MarginfiGroup> {
    const data: MarginfiGroupRaw = await program.account.marginfiGroup.fetch(address);
    return MarginfiGroup.fromAccountParsed(address, data);
  }

  /**
   * Fetch all banks belonging to this group
   *
   * @param program - The Marginfi program instance
   * @param feedIdMap - Optional Pyth feed ID map for oracle configuration
   * @returns Array of Bank instances for this group
   */
  async fetchBanks(program: MarginfiProgram): Promise<Bank[]> {
    const bankDatas = await fetchMultipleBanks(program, {
      groupAddress: this.address,
    });

    return bankDatas.map((bankData) => Bank.fromAccountParsed(bankData.address, bankData.data));
  }

  // ----------------------------------------------------------------------------
  // Factories
  // ----------------------------------------------------------------------------

  static fromAccountParsed(address: PublicKey, accountData: MarginfiGroupRaw): MarginfiGroup {
    const marginfiGroup = {
      admin: accountData.admin,
    };
    return new MarginfiGroup(marginfiGroup.admin, address);
  }

  static fromBuffer(address: PublicKey, rawData: Buffer, idl: MarginfiIdlType) {
    const data = MarginfiGroup.decode(rawData, idl);
    return MarginfiGroup.fromAccountParsed(address, data);
  }

  static decode(encoded: Buffer, idl: MarginfiIdlType): MarginfiGroupRaw {
    const coder = new BorshCoder(idl);
    return coder.accounts.decode(AccountType.MarginfiGroup, encoded);
  }

  static async encode(decoded: MarginfiGroupRaw, idl: MarginfiIdlType): Promise<Buffer> {
    const coder = new BorshCoder(idl);
    return await coder.accounts.encode(AccountType.MarginfiGroup, decoded);
  }

  // ----------------------------------------------------------------------------
  // Admin actions
  // ----------------------------------------------------------------------------

  // ------------------------------------------------------------------------
  // (TODO: move to Bank class)
  // ------------------------------------------------------------------------
  public async makePoolConfigureBankIx(
    program: MarginfiProgram,
    bank: PublicKey,
    args: BankConfigOptRaw
  ): Promise<InstructionsWrapper> {
    return makePoolConfigureBankIx(program, bank, args);
  }

  public async makeAddPermissionlessStakedBankIx(
    program: MarginfiProgram,
    voteAccountAddress: PublicKey,
    feePayer: PublicKey,
    pythOracle: PublicKey // wSOL oracle
  ): Promise<InstructionsWrapper> {
    return makeAddPermissionlessStakedBankIx(
      program,
      this.address,
      voteAccountAddress,
      feePayer,
      pythOracle
    );
  }

  public async makePoolAddBankIx(
    program: MarginfiProgram,
    bankPubkey: PublicKey,
    bankMint: PublicKey,
    bankConfig: BankConfigOpt,
    feePayer?: PublicKey
  ): Promise<InstructionsWrapper> {
    return makePoolAddBankIx(
      program,
      this.address,
      bankPubkey,
      feePayer ?? this.admin,
      bankMint,
      bankConfig
    );
  }
}

export { MarginfiGroup };
