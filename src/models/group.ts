import {
  fetchEncodedAccount,
  type Address,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type GetProgramAccountsApi,
  type Instruction,
  type ReadonlyUint8Array,
  type Rpc,
  type TransactionSigner,
} from "@solana/kit";

import { decodeMarginfiGroupRaw } from "../accounts";
import {
  AddBankConfig,
  BankRateLimiterType,
  fetchMultipleBanks,
  makeAddPermissionlessStakedBankIx,
  makePoolAddBankIx,
  makePoolConfigureBankIx,
  makePoolConfigureBankGovIx,
  BankConfigFastOpt,
  BankConfigGovOpt,
  MarginfiGroupType,
} from "../services";
import { parseBankRateLimiterRaw } from "../services/bank/utils/deserialize.utils";

import { Bank } from "./bank";

// ----------------------------------------------------------------------------
// Client types
// ----------------------------------------------------------------------------

class MarginfiGroup implements MarginfiGroupType {
  public address: Address;
  public admin: Address;
  /** Group-level net-outflow rate limiter (USD windows); see isGroupRateLimiterEnabled */
  public rateLimiter?: BankRateLimiterType;

  constructor(admin: Address, address: Address, rateLimiter?: BankRateLimiterType) {
    this.admin = admin;
    this.address = address;
    this.rateLimiter = rateLimiter;
  }

  static async fetch(address: Address, rpc: Rpc<GetAccountInfoApi>): Promise<MarginfiGroup> {
    const account = await fetchEncodedAccount(rpc, address);

    if (!account.exists) {
      throw new Error(`Group ${address} not found`);
    }

    return MarginfiGroup.fromBuffer(address, account.data);
  }

  /**
   * Fetch all banks belonging to this group
   *
   * @param rpc - Solana RPC client
   * @param programAddress - The marginfi program address
   * @returns Array of Bank instances for this group
   */
  async fetchBanks(
    rpc: Rpc<GetMultipleAccountsApi & GetProgramAccountsApi>,
    programAddress: Address
  ): Promise<Bank[]> {
    const banks = await fetchMultipleBanks(rpc, programAddress, {
      groupAddress: this.address,
    });

    return banks.map((bank) => Bank.fromBankType(bank));
  }

  // ----------------------------------------------------------------------------
  // Factories
  // ----------------------------------------------------------------------------

  static fromBuffer(address: Address, rawData: ReadonlyUint8Array): MarginfiGroup {
    const accountData = decodeMarginfiGroupRaw(rawData);
    return new MarginfiGroup(
      accountData.admin,
      address,
      parseBankRateLimiterRaw(accountData.rateLimiter)
    );
  }

  // ----------------------------------------------------------------------------
  // Admin actions
  // ----------------------------------------------------------------------------

  // ------------------------------------------------------------------------
  // (TODO: move to Bank class)
  // ------------------------------------------------------------------------
  public async makePoolConfigureBankIx(
    programAddress: Address,
    admin: TransactionSigner,
    bankAddress: Address,
    bankConfig: BankConfigFastOpt
  ): Promise<Instruction> {
    return makePoolConfigureBankIx({
      programAddress,
      groupAddress: this.address,
      admin,
      bankAddress,
      bankConfig,
    });
  }

  public async makePoolConfigureBankGovIx(
    programAddress: Address,
    governanceAdmin: TransactionSigner,
    bankAddress: Address,
    bankConfig: BankConfigGovOpt
  ): Promise<Instruction> {
    return makePoolConfigureBankGovIx({
      programAddress,
      groupAddress: this.address,
      governanceAdmin,
      bankAddress,
      bankConfig,
    });
  }

  public async makeAddPermissionlessStakedBankIx(
    programAddress: Address,
    voteAccountAddress: Address,
    feePayer: TransactionSigner,
    pythOracle: Address // wSOL oracle
  ): Promise<Instruction> {
    return makeAddPermissionlessStakedBankIx({
      programAddress,
      groupAddress: this.address,
      voteAccountAddress,
      feePayer,
      pythOracle,
    });
  }

  public async makePoolAddBankIx(
    programAddress: Address,
    governanceAdmin: TransactionSigner,
    globalFeeWallet: Address,
    bank: TransactionSigner,
    bankMint: Address,
    bankConfig: AddBankConfig,
    feePayer?: TransactionSigner
  ): Promise<Instruction> {
    return makePoolAddBankIx({
      programAddress,
      groupAddress: this.address,
      governanceAdmin,
      globalFeeWallet,
      feePayer: feePayer ?? governanceAdmin,
      bank,
      bankMint,
      bankConfig,
    });
  }
}

export { MarginfiGroup };
