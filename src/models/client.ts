import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { AddressLookupTableAccount, Connection, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";


import { Balance } from "./balance";
import { Bank } from "./bank";
import { MarginfiGroup } from "./group";
import { MarginfiAccount } from "./account";
import { MarginfiAccountWrapper } from "./account-wrapper";

import { AssetTag } from "../services";

import {
  ADDRESS_LOOKUP_TABLE_FOR_GROUP,
  ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE,
} from "~/constants";
import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import {
  makeCreateMarginfiAccountTx,
  makeCreateAccountIxWithProjection,
  fetchMarginfiAccountAddresses,
  fetchMarginfiAccountAddressesHoldingBank,
  fetchMarginfiAccountActiveBalancesForBank,
  MarginfiAccountRaw,
  getEmodePairs,
  computeLowestEmodeWeights,
} from "~/services/account";
import { EmodePair } from "~/services/bank";
import {
  fetchBankIntegrationMetadata,
  getKaminoCTokenMultiplier,
  getJupLendFTokenMultiplier,
} from "~/services/integration";
import { getDriftCTokenMultiplier } from "~/services/integration/drift";
import { fetchProgramForMints } from "~/services/misc";
import { computeStakedBankMultipliers } from "~/services/native-stake";
import { fetchOracleData, OraclePrice } from "~/services/price";
import {
  Project0Config,
  MintData,
  MarginfiProgram,
  BankIntegrationMetadataMap,
  Wallet,
} from "~/types";

/**
 * An authority's active balance in a specific bank for a queried mint. One row per
 * (account, bank): a single account can appear multiple times if it holds the mint across
 * several banks (e.g. a DEFAULT and a Kamino bank for the same mint). Amounts are in UI units
 * (token decimals + share multiplier applied).
 */
export type MintAuthorityBalance = {
  authority: PublicKey;
  accountAddress: PublicKey;
  bank: PublicKey;
  assets: BigNumber;
  liabilities: BigNumber;
};

export class Project0Client {
  constructor(
    public readonly program: MarginfiProgram,
    public readonly group: MarginfiGroup,
    public readonly bankMap: Map<string, Bank>,
    public readonly bankIntegrationMap: BankIntegrationMetadataMap,
    public readonly assetShareValueMultiplierByBank: Map<string, BigNumber>,
    public readonly oraclePriceByBank: Map<string, OraclePrice>,
    public readonly mintDataByBank: Map<string, MintData>,
    /**
     * Combined LUT set (general group followed by native-stake group). The functional
     * action builders partition this and embed the right subset per transaction via
     * `selectLutsForBanks`, so consumers only ever pass this one array.
     */
    public readonly addressLookupTables: AddressLookupTableAccount[],
    public readonly emodePairs: EmodePair[]
  ) {}

  /**
   * Gets all banks as an array.
   * Useful when you need to iterate over all banks.
   */
  get banks(): Bank[] {
    return Array.from(this.bankMap.values());
  }

  /**
   * Gets a bank by its address.
   */
  getBank(address: PublicKey): Bank | undefined {
    return this.bankMap.get(address.toBase58());
  }

  /**
   * Gets all banks matching the mint address.
   *
   * @param mint - The mint address to search for
   * @param assetTag - Optional asset tag to filter by (e.g., AssetTag.DEFAULT, AssetTag.KAMINO)
   * @returns Array of all matching banks (empty array if none found)
   *
   * @example
   * // Get all SOL banks
   * const allSolBanks = client.getBanksByMint(MINTS.SOL);
   *
   * // Get all Kamino SOL banks (may be multiple)
   * const kaminoBanks = client.getBanksByMint(MINTS.SOL, AssetTag.KAMINO);
   * console.log(`Found ${kaminoBanks.length} Kamino SOL banks`);
   *
   * // Iterate through all matching banks
   * kaminoBanks.forEach((bank) => {
   *   console.log(`Bank: ${bank.address.toBase58()}`);
   * });
   */
  getBanksByMint(mint: PublicKey, assetTag?: AssetTag): Bank[] {
    return this.banks.filter((b) => {
      const mintMatches = b.mint.equals(mint);
      if (assetTag !== undefined) {
        return mintMatches && b.config.assetTag === assetTag;
      }
      return mintMatches;
    });
  }

  /**
   * Creates a transaction to initialize a new marginfi account.
   *
   * @param authority - The authority public key for the new account
   * @param accountIndex - The account index (default: 0)
   * @param thirdPartyId - Optional third party identifier
   * @returns A transaction ready to be signed and sent
   */
  async createMarginfiAccountTx(
    authority: PublicKey,
    accountIndex: number = 0,
    thirdPartyId?: number
  ) {
    return makeCreateMarginfiAccountTx(
      this.program,
      authority,
      this.group.address,
      this.addressLookupTables,
      accountIndex,
      thirdPartyId
    );
  }

  /**
   * Creates a marginfi account instruction with a projected account wrapper.
   *
   * Returns a wrapped account instance that can be used for building transactions
   * before the account actually exists on-chain. Useful for composing multiple
   * operations including account creation in a single flow.
   *
   * @param authority - The authority public key for the new account
   * @param accountIndex - The account index (default: 0)
   * @param thirdPartyId - Optional third party identifier
   * @returns Object containing the wrapped account and creation instruction
   */
  async createMarginfiAccountWithProjection(
    authority: PublicKey,
    accountIndex: number = 0,
    thirdPartyId?: number
  ) {
    const { account, ix } = await makeCreateAccountIxWithProjection({
      program: this.program,
      authority,
      group: this.group.address,
      accountIndex,
      thirdPartyId,
    });

    const marginfiAccount = MarginfiAccount.fromAccountType(account);
    const wrappedAccount = new MarginfiAccountWrapper(marginfiAccount, this);

    return {
      wrappedAccount,
      ix,
    };
  }

  /**
   * Fetches all marginfi account addresses for a given authority (wallet).
   *
   * This is useful for account discovery - finding all accounts that belong to a wallet.
   *
   * @param authority - The wallet public key to search for
   * @returns Array of account addresses owned by the authority
   */
  async getAccountAddresses(authority: PublicKey): Promise<PublicKey[]> {
    return fetchMarginfiAccountAddresses(this.program, authority, this.group.address);
  }

  /**
   * Fetches the addresses of all marginfi accounts in the group that hold a position in a
   * specific bank.
   *
   * Because a marginfi account holds up to 16 balance slots (sorted descending by bank, so the
   * target can be at any slot), this scans all 16 slots in parallel via filtered
   * `getProgramAccounts` calls. It returns only addresses (no account data is transferred),
   * which keeps it viable across the group's ~500k accounts. Hydrate any address you care about
   * with `fetchAccount`.
   *
   * @param bank - The bank public key to search for in account balances
   * @param options - Optional settings:
   *   - `concurrency`: max number of the 16 slot scans to run at once. Omit to fire all 16 in
   *     parallel; pass a smaller value (e.g. 4) to batch them and avoid RPC rate limits.
   * @returns Deduplicated array of account addresses holding the bank
   */
  async getAccountAddressesHoldingBank(
    bank: PublicKey,
    options?: { concurrency?: number }
  ): Promise<PublicKey[]> {
    return fetchMarginfiAccountAddressesHoldingBank(
      this.program,
      this.group.address,
      bank,
      options
    );
  }

  /**
   * Fetches every account's active balance for a given mint, with its authority, account
   * address, and the deposited/borrowed amounts in UI units.
   *
   * A mint can map to multiple banks (e.g. DEFAULT + Kamino), so this resolves all matching
   * banks via {@link getBanksByMint}, scans each for accounts holding it, and emits one row per
   * (account, bank). An account that holds the mint in several banks yields several rows.
   *
   * Amounts are computed with each bank's share multiplier (`assetShareValueMultiplierByBank`)
   * and the bank's mint decimals, matching `Balance.computeQuantityUi`.
   *
   * @param mint - The mint to search account balances for
   * @param options - Optional settings:
   *   - `assetTag`: restrict to banks with this asset tag (e.g. only Kamino banks for the mint)
   *   - `concurrency`: max number of the 16 slot scans to run at once per bank (see
   *     {@link getAccountAddressesHoldingBank})
   * @returns One row per (account, bank) holding the mint
   */
  async getAuthorityBalancesForMint(
    mint: PublicKey,
    options?: { assetTag?: AssetTag; concurrency?: number }
  ): Promise<MintAuthorityBalance[]> {
    const banks = this.getBanksByMint(mint, options?.assetTag);

    const rows: MintAuthorityBalance[] = [];
    for (const bank of banks) {
      const multiplier = this.assetShareValueMultiplierByBank.get(bank.address.toBase58());
      const balances = await fetchMarginfiAccountActiveBalancesForBank(
        this.program,
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
   * Fetches and wraps a marginfi account in one call.
   *
   * This is a convenience method that combines fetching the account data
   * and wrapping it for easier use. Equivalent to:
   * ```typescript
   * const account = await MarginfiAccount.fetch(address, client.program);
   * const wrapped = new MarginfiAccountWrapper(account, client);
   * ```
   *
   * @param accountAddress - The public key of the marginfi account
   * @returns A wrapped account ready to use
   */
  async fetchAccount(
    accountAddress: PublicKey,
    skipHealthCache?: boolean
  ): Promise<MarginfiAccountWrapper> {
    const marginfiAccountRaw: MarginfiAccountRaw =
      await this.program.account.marginfiAccount.fetch(accountAddress);
    let marginfiAccountParsed = MarginfiAccount.fromAccountParsed(
      accountAddress,
      marginfiAccountRaw
    );

    if (!skipHealthCache) {
      const bankMap = new Map(this.banks.map((b) => [b.address.toBase58(), b]));

      // Compute active emode weights for this account
      const activePairs = marginfiAccountParsed.computeActiveEmodePairs(this.emodePairs);
      const activeEmodeWeightsByBank = computeLowestEmodeWeights(activePairs);

      const { account: simulatedAccount } = await marginfiAccountParsed.simulateHealthCache({
        program: this.program,
        banksMap: bankMap,
        oraclePricesByBank: this.oraclePriceByBank,
        bankIntegrationMap: this.bankIntegrationMap,
        assetShareValueMultiplierByBank: this.assetShareValueMultiplierByBank,
        activeEmodeWeightsByBank,
      });
      marginfiAccountParsed = simulatedAccount;
    }
    return new MarginfiAccountWrapper(marginfiAccountParsed, this);
  }

  static async initialize(connection: Connection, config: Project0Config) {
    const { groupPk, programId } = config;

    const idl: MarginfiIdlType = {
      ...MARGINFI_IDL,
      address: programId.toBase58(),
    };

    const provider = new AnchorProvider(connection, {} as Wallet, {
      ...AnchorProvider.defaultOptions(),
      commitment: connection.commitment ?? AnchorProvider.defaultOptions().commitment,
    });

    const program: MarginfiProgram = new Program<MarginfiIdlType>(
      idl,
      provider
    ) as unknown as MarginfiProgram;

    // fetch group data
    const group = await MarginfiGroup.fetch(groupPk, program);

    // fetch bank data
    const banksArray = await group.fetchBanks(program);
    const bankMap = new Map(banksArray.map((b) => [b.address.toBase58(), b]));

    // fetch oracle prices
    const { bankOraclePriceMap, mintOraclePriceMap } = await fetchOracleData(banksArray, {
      pythOpts: {
        mode: "on-chain",
        connection,
      },
      swbOpts: {
        mode: "on-chain",
        connection,
      },
      scopeOpts: {
        mode: "on-chain",
        connection,
      },
      oracleMultiplierOpts: {
        mode: "on-chain",
        connection,
      },
      isolatedBanksOpts: {
        fetchPrices: true,
      },
    });

    // fetch mint data (keyed by bank address for consistency)
    const uniqueMints = Array.from(new Set(banksArray.map((b) => b.mint)));
    const mintProgramData = await fetchProgramForMints(connection, uniqueMints);

    const mintDataByBank = new Map<string, MintData>();
    banksArray.forEach((bank) => {
      const mintData = mintProgramData.find((m) => m.mint.equals(bank.mint));
      if (mintData) {
        mintDataByBank.set(bank.address.toBase58(), {
          mint: mintData.mint,
          tokenProgram: mintData.program,
        });
      }
    });

    // fetch address lookup tables (general + native-stake sets)
    const fetchLuts = async (
      keys?: PublicKey[]
    ): Promise<AddressLookupTableAccount[]> => {
      if (!keys || keys.length === 0) return [];
      return (
        await Promise.all(keys.map((lut) => connection.getAddressLookupTable(lut)))
      )
        .map((response) => response?.value ?? null)
        .filter((table): table is AddressLookupTableAccount => table !== null);
    };

    const [generalLuts, nativeStakeLuts] = await Promise.all([
      fetchLuts(ADDRESS_LOOKUP_TABLE_FOR_GROUP[groupPk.toBase58()]),
      fetchLuts(ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE[groupPk.toBase58()]),
    ]);

    // General first so that general transactions never reference a native-stake LUT
    // for shared keys (the builders partition this combined array per transaction).
    const addressLookupTables = [...generalLuts, ...nativeStakeLuts];

    // fetch bank integration metadata (Kamino reserves/obligations, etc.)
    const bankIntegrationMap = await fetchBankIntegrationMetadata({
      connection,
      banks: banksArray,
    });

    // fetch asset share multipliers
    const assetShareMultiplierByBank = new Map<string, BigNumber>();
    banksArray.forEach((bank) => {
      switch (bank.config.assetTag) {
        case AssetTag.KAMINO:
          const reserve = bankIntegrationMap[bank.address.toBase58()]?.kaminoStates?.reserveState;
          if (!reserve) {
            console.error(`No Kamino reserve found for bank ${bank.address.toBase58()}`);
            assetShareMultiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
            break;
          }
          assetShareMultiplierByBank.set(
            bank.address.toBase58(),
            getKaminoCTokenMultiplier(reserve)
          );
          break;

        case AssetTag.DRIFT:
          const spotMarket =
            bankIntegrationMap[bank.address.toBase58()]?.driftStates?.spotMarketState;
          if (!spotMarket) {
            console.error(`No Drift spot market found for bank ${bank.address.toBase58()}`);
            assetShareMultiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
            break;
          }
          assetShareMultiplierByBank.set(
            bank.address.toBase58(),
            getDriftCTokenMultiplier(spotMarket)
          );
          break;

        case AssetTag.JUPLEND:
          const jupLendStates = bankIntegrationMap[bank.address.toBase58()]?.jupLendStates;
          if (!jupLendStates) {
            console.error(`No JupLend state found for bank ${bank.address.toBase58()}`);
            assetShareMultiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
            break;
          }
          assetShareMultiplierByBank.set(
            bank.address.toBase58(),
            getJupLendFTokenMultiplier(
              jupLendStates.jupLendingState,
              jupLendStates.jupTokenReserveState,
              jupLendStates.jupRewardsRateModel,
              jupLendStates.fTokenTotalSupply,
              Math.floor(Date.now() / 1000)
            )
          );
          break;

        case AssetTag.SOLEND:
          // SOLEND integration not yet implemented, use default multiplier
          assetShareMultiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
          break;

        case AssetTag.STAKED:
          // Multiplier computed below after all banks are iterated
          break;

        case AssetTag.DEFAULT:
        case AssetTag.SOL:
        default:
          // Standard assets use 1:1 share multiplier
          assetShareMultiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
          break;
      }
    });

    // Compute asset share multipliers for staked banks (LST→SOL ratio)
    const stakedMultipliers = await computeStakedBankMultipliers(
      banksArray.filter((b) => b.config.assetTag === AssetTag.STAKED),
      connection
    );
    stakedMultipliers.forEach((v, k) => assetShareMultiplierByBank.set(k, v));

    // Generate emode pairs from bank configurations
    const emodePairs = getEmodePairs(banksArray);

    return new Project0Client(
      program,
      group,
      bankMap,
      bankIntegrationMap,
      assetShareMultiplierByBank,
      bankOraclePriceMap,
      mintDataByBank,
      addressLookupTables,
      emodePairs
    );
  }
}
