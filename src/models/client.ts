import { AddressLookupTableAccount, Connection, PublicKey } from "@solana/web3.js";
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
import { fetchBankIntegrationMetadata } from "~/services/integration";

import { MarginfiGroup } from "./group";
import { Bank } from "./bank";
import { AssetTag } from "../services";

export class Project0Client {
  constructor(
    public readonly program: MarginfiProgram,
    public readonly group: MarginfiGroup,
    public readonly bankMap: Map<string, Bank>,
    public readonly bankIntegrationMap: BankIntegrationMetadataMap,
    public readonly oraclePriceByBank: Map<string, OraclePrice>,
    public readonly mintDataByBank: Map<string, MintData>,
    public readonly addressLookupTables: AddressLookupTableAccount[]
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

    return new Project0Client(
      program,
      group,
      bankMap,
      bankIntegrationMap,
      bankOraclePriceMap,
      mintDataByBank,
      addressLookupTables
    );
  }
}
