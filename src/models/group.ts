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

import { decodeMarginfiGroup } from "../accounts";
import {
  AddBankConfig,
  BankConfigOptRaw,
  BankRateLimiterType,
  fetchMultipleBanks,
  makeAddPermissionlessStakedBankIx,
  makePoolAddBankIx,
  makePoolConfigureBankIx,
  MarginfiGroupRaw,
  MarginfiGroupType,
  parseBankRateLimiterRaw,
} from "../services";

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
    const bankDatas = await fetchMultipleBanks(rpc, programAddress, {
      groupAddress: this.address,
    });

    return bankDatas.map((bankData) => Bank.fromAccountParsed(bankData.address, bankData.data));
  }

  // ----------------------------------------------------------------------------
  // Factories
  // ----------------------------------------------------------------------------

  static fromAccountParsed(address: Address, accountData: MarginfiGroupRaw): MarginfiGroup {
    return new MarginfiGroup(
      accountData.admin,
      address,
      parseBankRateLimiterRaw(accountData.rateLimiter)
    );
  }

  static fromBuffer(address: Address, rawData: ReadonlyUint8Array) {
    return MarginfiGroup.fromAccountParsed(address, decodeMarginfiGroup(rawData));
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
    bankConfigOpt: BankConfigOptRaw
  ): Promise<Instruction> {
    return makePoolConfigureBankIx({
      programAddress,
      groupAddress: this.address,
      admin,
      bankAddress,
      bankConfigOpt,
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
    admin: TransactionSigner,
    globalFeeWallet: Address,
    bank: TransactionSigner,
    bankMint: Address,
    bankConfig: AddBankConfig,
    feePayer?: TransactionSigner
  ): Promise<Instruction> {
    return makePoolAddBankIx({
      programAddress,
      groupAddress: this.address,
      admin,
      globalFeeWallet,
      feePayer: feePayer ?? admin,
      bank,
      bankMint,
      bankConfig,
    });
  }
}

export { MarginfiGroup };
