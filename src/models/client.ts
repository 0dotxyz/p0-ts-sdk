import {
  fetchAddressesForLookupTables,
  type Address,
  type AddressesByLookupTableAddress,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { MarginfiAccount } from "./account";
import { MarginfiAccountWrapper } from "./account-wrapper";
import { Balance } from "./balance";
import { Bank } from "./bank";
import { MarginfiGroup } from "./group";

import {
  ADDRESS_LOOKUP_TABLE_FOR_GROUP,
  ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE,
} from "~/constants";
import {
  computeLowestEmodeWeights,
  fetchMarginfiAccountActiveBalancesForBank,
  fetchMarginfiAccountAddresses,
  fetchMarginfiAccountAddressesHoldingBank,
  findRandomAvailableAccountIndex,
  getEmodePairs,
  makeCreateAccountIxWithProjection,
  makeCreateAccountTx,
} from "~/services/account";
import {
  AssetTag,
  EmodePair,
  fetchBankIntegrationMetadata,
  withKaminoReserveEmergency,
} from "~/services/bank";
import { fetchProgramForMints } from "~/services/misc";
import { computeStakedBankMultipliers } from "~/services/native-stake";
import { fetchOracleData, OraclePrice } from "~/services/price";
import { BankIntegrationMetadataMap, MintData, Project0Config } from "~/types";
import { getDriftCTokenMultiplier } from "~/vendor/drift";
import { getJupLendFTokenMultiplier } from "~/vendor/jup-lend";
import { getKaminoCTokenMultiplier } from "~/vendor/klend";

/**
 * An authority's active balance in a specific bank for a queried mint. One row per
 * (account, bank): a single account can appear multiple times if it holds the mint across
 * several banks (e.g. a DEFAULT and a Kamino bank for the same mint). Amounts are in UI units
 * (token decimals + share multiplier applied).
 */
export type MintAuthorityBalance = {
  authority: Address;
  accountAddress: Address;
  bank: Address;
  assets: BigNumber;
  liabilities: BigNumber;
};

/**
 * A marginfi group loaded for use: its banks, venue state, share multipliers, oracle prices, mint
 * data, lookup tables and emode pairs, plus the RPC they were read with.
 */
export class Project0Client {
  constructor(
    public readonly rpc: Rpc<SolanaRpcApi>,
    /** RPC endpoint supporting `simulateBundle`, for health-cache simulation. */
    public readonly rpcEndpoint: string,
    public readonly programAddress: Address,
    public readonly group: MarginfiGroup,
    public readonly bankMap: Map<string, Bank>,
    public readonly bankIntegrationMap: BankIntegrationMetadataMap,
    public readonly assetShareValueMultiplierByBank: Map<string, BigNumber>,
    public readonly oraclePriceByBank: Map<string, OraclePrice>,
    public readonly mintDataByBank: Map<string, MintData>,
    /**
     * The group's lookup tables, general before native-stake; the builders pick the subset each
     * transaction needs.
     */
    public readonly addressLookupTables: AddressesByLookupTableAddress,
    public readonly emodePairs: EmodePair[]
  ) {}

  get banks(): Bank[] {
    return Array.from(this.bankMap.values());
  }

  getBank(address: Address): Bank | undefined {
    return this.bankMap.get(address);
  }

  /** The banks for `mint`, optionally only those with `assetTag`. */
  getBanksByMint(mint: Address, assetTag?: AssetTag): Bank[] {
    return this.banks.filter(
      (b) => b.mint === mint && (assetTag === undefined || b.config.assetTag === assetTag)
    );
  }

  /**
   * Transaction creating a marginfi account for `authority` (signs and pays) in this group; a
   * random free `accountIndex` is picked when omitted.
   * @throws Error if `accountIndex` is omitted and no free index is found
   */
  async createMarginfiAccountTx(
    authority: TransactionSigner,
    accountIndex?: number,
    thirdPartyId?: number
  ) {
    return makeCreateAccountTx({
      rpc: this.rpc,
      programAddress: this.programAddress,
      authority,
      group: this.group.address,
      txFormat: { version: 0, luts: this.addressLookupTables },
      accountIndex,
      thirdPartyId,
    });
  }

  /**
   * Instruction creating a marginfi account for `authority`, plus that account wrapped (signed by
   * `authority`) to build further actions before it exists. A random free `accountIndex` is picked
   * when omitted.
   * @throws Error if `accountIndex` is omitted and no free index is found
   */
  async createMarginfiAccountWithProjection(
    authority: TransactionSigner,
    accountIndex?: number,
    thirdPartyId?: number
  ) {
    const { account, ix } = await makeCreateAccountIxWithProjection({
      programAddress: this.programAddress,
      authority,
      group: this.group.address,
      accountIndex:
        accountIndex ??
        (await findRandomAvailableAccountIndex(
          this.rpc,
          this.programAddress,
          this.group.address,
          authority.address,
          thirdPartyId
        )),
      thirdPartyId,
    });

    return {
      wrappedAccount: new MarginfiAccountWrapper(
        MarginfiAccount.fromAccountType(account),
        this,
        authority
      ),
      ix,
    };
  }

  /** Addresses of `authority`'s marginfi accounts in this group. */
  async getAccountAddresses(authority: Address): Promise<Address[]> {
    return fetchMarginfiAccountAddresses(
      this.rpc,
      this.programAddress,
      authority,
      this.group.address
    );
  }

  /**
   * Addresses of the group's accounts holding a position in `bank`. Scans all 16 balance slots
   * with filtered `getProgramAccounts` calls (addresses only); `concurrency` caps the parallel
   * scans to avoid RPC rate limits.
   */
  async getAccountAddressesHoldingBank(
    bank: Address,
    options?: { concurrency?: number }
  ): Promise<Address[]> {
    return fetchMarginfiAccountAddressesHoldingBank(
      this.rpc,
      this.programAddress,
      this.group.address,
      bank,
      options
    );
  }

  /**
   * Every account's active balance in the banks for `mint` (optionally only those with
   * `assetTag`): one row per (account, bank), amounts in UI units with the bank's share
   * multiplier applied. `concurrency` caps the parallel slot scans per bank.
   */
  async getAuthorityBalancesForMint(
    mint: Address,
    options?: { assetTag?: AssetTag; concurrency?: number }
  ): Promise<MintAuthorityBalance[]> {
    const rows: MintAuthorityBalance[] = [];
    for (const bank of this.getBanksByMint(mint, options?.assetTag)) {
      const multiplier = this.assetShareValueMultiplierByBank.get(bank.address);
      const balances = await fetchMarginfiAccountActiveBalancesForBank(
        this.rpc,
        this.programAddress,
        this.group.address,
        bank.address,
        { concurrency: options?.concurrency }
      );

      for (const { accountAddress, authority, balance } of balances) {
        const { assets, liabilities } = Balance.fromBalanceType(balance).computeQuantityUi(
          bank,
          multiplier
        );
        rows.push({ authority, accountAddress, bank: bank.address, assets, liabilities });
      }
    }
    return rows;
  }

  /**
   * Fetches the marginfi account at `accountAddress`, refreshes its health cache by simulation
   * unless `skipHealthCache`, and wraps it; `signer` defaults to a noop signer for its authority.
   * @throws if the account doesn't exist or isn't a marginfi account
   */
  async fetchAccount(
    accountAddress: Address,
    skipHealthCache?: boolean,
    signer?: TransactionSigner
  ): Promise<MarginfiAccountWrapper> {
    let account = await MarginfiAccount.fetch(accountAddress, this.rpc);

    if (!skipHealthCache) {
      ({ account } = await account.simulateHealthCache({
        rpc: this.rpc,
        rpcEndpoint: this.rpcEndpoint,
        programAddress: this.programAddress,
        banksMap: this.bankMap,
        oraclePricesByBank: this.oraclePriceByBank,
        bankIntegrationMap: this.bankIntegrationMap,
        assetShareValueMultiplierByBank: this.assetShareValueMultiplierByBank,
        activeEmodeWeightsByBank: computeLowestEmodeWeights(
          account.computeActiveEmodePairs(this.emodePairs)
        ),
      }));
    }
    return new MarginfiAccountWrapper(account, this, signer);
  }

  /**
   * Loads `config`'s group: banks, oracle prices, mint token programs, lookup tables, venue state
   * and share multipliers. `rpcEndpoint` must support `simulateBundle` (health-cache simulation).
   * @throws if the group, a bank or a configured lookup table can't be fetched
   */
  static async initialize(
    { rpc, rpcEndpoint }: { rpc: Rpc<SolanaRpcApi>; rpcEndpoint: string },
    config: Project0Config
  ): Promise<Project0Client> {
    const { groupPk, programId } = config;

    const group = await MarginfiGroup.fetch(groupPk, rpc);
    const banks = await group.fetchBanks(rpc, programId);
    const bankMap = new Map(banks.map((b) => [b.address as string, b]));

    const { bankOraclePriceMap } = await fetchOracleData(banks, {
      pythOpts: { mode: "on-chain", rpc },
      scopeOpts: { mode: "on-chain", rpc },
      oracleMultiplierOpts: { mode: "on-chain", rpc },
      isolatedBanksOpts: { fetchPrices: true },
    });

    const mintPrograms = await fetchProgramForMints(rpc, [...new Set(banks.map((b) => b.mint))]);
    const mintDataByBank = new Map<string, MintData>();
    for (const bank of banks) {
      const mintData = mintPrograms.find((m) => m.mint === bank.mint);
      if (mintData) {
        mintDataByBank.set(bank.address, { mint: mintData.mint, tokenProgram: mintData.program });
      }
    }

    // General before native-stake, so shared keys resolve through a general table.
    const addressLookupTables = {
      ...(await fetchAddressesForLookupTables(ADDRESS_LOOKUP_TABLE_FOR_GROUP[groupPk] ?? [], rpc)),
      ...(await fetchAddressesForLookupTables(
        ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE[groupPk] ?? [],
        rpc
      )),
    };

    const bankIntegrationMap = await fetchBankIntegrationMetadata(rpc, banks);

    const assetShareMultiplierByBank = new Map<string, BigNumber>();
    for (const bank of banks) {
      const states = bankIntegrationMap[bank.address];
      switch (bank.config.assetTag) {
        case AssetTag.KAMINO: {
          const reserve = states?.kaminoStates?.reserveState;
          if (!reserve) console.error(`No Kamino reserve found for bank ${bank.address}`);
          assetShareMultiplierByBank.set(
            bank.address,
            reserve ? getKaminoCTokenMultiplier(reserve) : new BigNumber(1)
          );
          if (reserve) {
            bankMap.set(bank.address, Bank.fromBankType(withKaminoReserveEmergency(bank, reserve)));
          }
          break;
        }
        case AssetTag.DRIFT: {
          const spotMarket = states?.driftStates?.spotMarketState;
          if (!spotMarket) console.error(`No Drift spot market found for bank ${bank.address}`);
          assetShareMultiplierByBank.set(
            bank.address,
            spotMarket ? getDriftCTokenMultiplier(spotMarket) : new BigNumber(1)
          );
          break;
        }
        case AssetTag.JUPLEND: {
          const jupLend = states?.jupLendStates;
          if (!jupLend) console.error(`No JupLend state found for bank ${bank.address}`);
          assetShareMultiplierByBank.set(
            bank.address,
            jupLend
              ? getJupLendFTokenMultiplier(
                  jupLend.lendingState,
                  jupLend.tokenReserveState,
                  jupLend.rewardsRateModel,
                  jupLend.fTokenTotalSupply,
                  Math.floor(Date.now() / 1000)
                )
              : new BigNumber(1)
          );
          break;
        }
        case AssetTag.STAKED:
          break;
        default:
          assetShareMultiplierByBank.set(bank.address, new BigNumber(1));
      }
    }
    const stakedMultipliers = await computeStakedBankMultipliers(
      rpc,
      banks.filter((b) => b.config.assetTag === AssetTag.STAKED)
    );
    stakedMultipliers.forEach((multiplier, bank) =>
      assetShareMultiplierByBank.set(bank, multiplier)
    );

    return new Project0Client(
      rpc,
      rpcEndpoint,
      programId,
      group,
      bankMap,
      bankIntegrationMap,
      assetShareMultiplierByBank,
      bankOraclePriceMap,
      mintDataByBank,
      addressLookupTables,
      getEmodePairs(banks)
    );
  }
}
