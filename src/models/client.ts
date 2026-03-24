import { AddressLookupTableAccount, Connection, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";

import {
  Project0Config,
  MintData,
  MarginfiProgram,
  BankIntegrationMetadataMap,
  Wallet,
} from "~/types";
import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import { ADDRESS_LOOKUP_TABLE_FOR_GROUP } from "~/constants";
import { fetchOracleData, OraclePrice } from "~/services/price";
import { fetchProgramForMints } from "~/services/misc";
import {
  fetchBankIntegrationMetadata,
  getKaminoCTokenMultiplier,
  getJupLendFTokenMultiplier,
} from "~/services/integration";
import {
  makeCreateMarginfiAccountTx,
  makeCreateAccountIxWithProjection,
  fetchMarginfiAccountAddresses,
  MarginfiAccountRaw,
  getEmodePairs,
  computeLowestEmodeWeights,
} from "~/services/account";
import { EmodePair } from "~/services/bank";

import { MarginfiGroup } from "./group";
import { Bank } from "./bank";
import { MarginfiAccount } from "./account";
import { MarginfiAccountWrapper } from "./account-wrapper";
import { AssetTag } from "../services";
import { getDriftCTokenMultiplier } from "~/services/integration/drift";
import { getStakedBankMetadataMap, getValidatorVoteAccountByBank } from "~/services/native-stake";
import {
  findPoolAddress,
  findPoolStakeAddress,
  findPoolMintAddress,
} from "~/vendor/single-spl-pool";
import { chunkedGetRawMultipleAccountInfoOrdered } from "~/services/misc";

export class Project0Client {
  constructor(
    public readonly program: MarginfiProgram,
    public readonly group: MarginfiGroup,
    public readonly bankMap: Map<string, Bank>,
    public readonly bankIntegrationMap: BankIntegrationMetadataMap,
    public readonly assetShareValueMultiplierByBank: Map<string, BigNumber>,
    public readonly oraclePriceByBank: Map<string, OraclePrice>,
    public readonly mintDataByBank: Map<string, MintData>,
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

    // fetch address lookup tables
    const lutKeys = ADDRESS_LOOKUP_TABLE_FOR_GROUP[groupPk.toBase58()];
    let addressLookupTables: AddressLookupTableAccount[] = [];
    if (lutKeys) {
      addressLookupTables = (
        await Promise.all(lutKeys.map((lut) => connection.getAddressLookupTable(lut)))
      )
        .map((response) => response?.value ?? null)
        .filter((table) => table !== null);
    }

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
    const stakedBanks = banksArray.filter((b) => b.config.assetTag === AssetTag.STAKED);
    if (stakedBanks.length > 0) {
      const metadataMap = getStakedBankMetadataMap();

      // Derive pool stake addresses and LST mint addresses for each staked bank
      const stakedBankAddresses: string[] = [];
      const poolStakeAddresses: PublicKey[] = [];
      const lstMintAddresses: PublicKey[] = [];

      for (const bank of stakedBanks) {
        const metadata = metadataMap.get(bank.address.toBase58());
        if (!metadata) {
          assetShareMultiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
          continue;
        }
        const pool = findPoolAddress(new PublicKey(metadata.validatorVoteAccount));
        stakedBankAddresses.push(bank.address.toBase58());
        poolStakeAddresses.push(findPoolStakeAddress(pool));
        lstMintAddresses.push(findPoolMintAddress(pool));
      }

      if (stakedBankAddresses.length > 0) {
        // Batch-fetch pool stake accounts and LST mint supplies
        const allAddresses = [
          ...poolStakeAddresses.map((a) => a.toBase58()),
          ...lstMintAddresses.map((a) => a.toBase58()),
        ];
        const accountInfos = await chunkedGetRawMultipleAccountInfoOrdered(
          connection,
          allAddresses
        );
        const poolStakeInfos = accountInfos.slice(0, poolStakeAddresses.length);
        const lstMintInfos = accountInfos.slice(poolStakeAddresses.length);

        for (let i = 0; i < stakedBankAddresses.length; i++) {
          const bankAddr = stakedBankAddresses[i];
          const poolStakeInfo = poolStakeInfos[i];
          const lstMintInfo = lstMintInfos[i];

          if (!poolStakeInfo || !lstMintInfo) {
            assetShareMultiplierByBank.set(bankAddr, new BigNumber(1));
            continue;
          }

          const stakeLamports = poolStakeInfo.lamports;
          // LST mint supply is stored at offset 36, as a little-endian u64
          const supplyBuffer = lstMintInfo.data.slice(36, 44);
          const lstMintSupply = Number(Buffer.from(supplyBuffer).readBigUInt64LE(0));

          if (lstMintSupply === 0) {
            assetShareMultiplierByBank.set(bankAddr, new BigNumber(1));
            continue;
          }

          // multiplier = (stakeInPool - LAMPORTS_PER_SOL) / lstMintSupply
          const LAMPORTS_PER_SOL = 1_000_000_000;
          const adjustedStake = Math.max(stakeLamports - LAMPORTS_PER_SOL, 0);
          const multiplier = new BigNumber(adjustedStake).dividedBy(lstMintSupply);
          assetShareMultiplierByBank.set(bankAddr, multiplier);
        }
      }
    }

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
