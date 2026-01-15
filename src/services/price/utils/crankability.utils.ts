import { Connection, PublicKey } from "@solana/web3.js";

import { BankType } from "~/services/bank";
import { decodeSwitchboardPullFeedData } from "~/vendor/switchboard_pull";

import { OraclePrice } from "../types";

/**
 * Result of checking if an oracle can be cranked
 */
export interface CrankabilityResult {
  oracle: PublicKey;
  crankable: boolean;
  reason?: string;
  error?: unknown;
}

/**
 * Payload structure from Crossbar simulate endpoint
 */
interface CrossbarFeedResponse {
  feedHash: string;
  results: (number | null)[];
}

type CrossbarSimulatePayload = CrossbarFeedResponse[];

/**
 * Checks if multiple Switchboard Pull oracles can be cranked by simulating feed updates
 *
 * @param feedHashes - Array of oracle feed hashes to check
 * @param crossbarUrl - Crossbar API endpoint (defaults to production)
 * @returns Promise resolving to map of feedHash to crankability result
 */
export async function checkBatchOracleCrankability(
  feedHashes: string[],
  crossbarUrl: string = "https://integrator-crossbar.prod.mrgn.app"
): Promise<Map<string, { crankable: boolean; reason?: string }>> {
  const results = new Map<string, { crankable: boolean; reason?: string }>();

  if (feedHashes.length === 0) {
    return results;
  }

  try {
    // Join feed hashes with commas for batch request
    const feedHashesString = feedHashes.join(",");

    const response = await fetch(
      `${crossbarUrl}/simulate/${feedHashesString}`,
      {
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!response.ok) {
      const reason = `HTTP ${response.status}: ${response.statusText}`;
      // Mark all as uncrankable if request fails
      feedHashes.forEach((hash) => {
        results.set(hash, { crankable: false, reason });
      });
      return results;
    }

    const payload = (await response.json()) as CrossbarSimulatePayload;

    // Check validity of each feed response
    payload.forEach((feed) => {
      const result = feed.results[0];
      const isValid =
        result !== null && result !== undefined && !isNaN(Number(result));

      results.set(feed.feedHash, {
        crankable: isValid,
        reason: isValid ? undefined : "Invalid feed response",
      });
    });

    // Mark any missing feeds as uncrankable
    feedHashes.forEach((hash) => {
      if (!results.has(hash)) {
        results.set(hash, {
          crankable: false,
          reason: "No response from Crossbar",
        });
      }
    });

    return results;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    // Mark all as uncrankable if request fails
    feedHashes.forEach((hash) => {
      results.set(hash, { crankable: false, reason });
    });
    return results;
  }
}

/**
 * Fetches feed hashes for banks by decoding their oracle account data
 */
async function fetchFeedHashes(
  banks: BankType[],
  connection: Connection
): Promise<Map<string, string>> {
  const feedHashMap = new Map<string, string>();

  if (banks.length === 0) {
    return feedHashMap;
  }

  try {
    // Fetch oracle account infos
    const oracleKeys = banks.map((bank) => bank.oracleKey);
    const oracleAis = await connection.getMultipleAccountsInfo(oracleKeys);

    // Process each oracle account
    oracleAis.forEach((oracleAi, idx) => {
      if (!oracleAi?.data || idx >= banks.length) return;

      const bank = banks[idx];
      if (!bank) return;

      try {
        const { feed_hash } = decodeSwitchboardPullFeedData(oracleAi.data);
        const feedHash = Buffer.from(feed_hash).toString("hex");
        feedHashMap.set(bank.oracleKey.toBase58(), feedHash);
      } catch (error) {
        console.error(
          `Failed to decode feed hash for bank ${bank.address.toBase58()}:`,
          error
        );
      }
    });
  } catch (error) {
    console.error("Failed to fetch feed hashes:", error);
  }

  return feedHashMap;
}

/**
 * Checks crankability for multiple oracles in parallel
 *
 * @param banks - Banks to check oracle crankability for
 * @param oraclePrices - Map of oracle prices (may contain feedHash)
 * @param connection - Solana connection for fetching missing feed hashes
 * @param crossbarUrl - Crossbar API endpoint
 * @returns Promise resolving to map of oracle address to crankability result
 */
export async function checkMultipleOraclesCrankability(
  banks: BankType[],
  oraclePrices: Map<string, OraclePrice>,
  connection?: Connection,
  crossbarUrl?: string
): Promise<Map<string, CrankabilityResult>> {
  const results = new Map<string, CrankabilityResult>();
  const feedHashMap = new Map<string, string>();
  const banksNeedingFetch: BankType[] = [];

  // Check which banks already have feedHash in oraclePrices
  banks.forEach((bank) => {
    const oracleKey = bank.oracleKey.toBase58();
    const bankAddress = bank.address.toBase58();
    const feedHash = oraclePrices.get(bankAddress)?.switchboardData?.feedHash;

    if (feedHash) {
      feedHashMap.set(oracleKey, feedHash);
    } else {
      banksNeedingFetch.push(bank);
    }
  });

  // Fetch missing feed hashes if we have a connection
  if (banksNeedingFetch.length > 0 && connection) {
    const fetchedHashes = await fetchFeedHashes(banksNeedingFetch, connection);
    fetchedHashes.forEach((hash, key) => feedHashMap.set(key, hash));
  }

  // Collect all feed hashes for batch request
  const feedHashesToCheck: string[] = [];
  const feedHashToBanks = new Map<string, BankType[]>();

  banks.forEach((bank) => {
    const oracleKey = bank.oracleKey.toBase58();
    const feedHash = feedHashMap.get(oracleKey);

    if (!feedHash) {
      results.set(oracleKey, {
        oracle: bank.oracleKey,
        crankable: false,
        reason: "Feed hash not available",
      });
    } else {
      if (!feedHashToBanks.has(feedHash)) {
        feedHashesToCheck.push(feedHash);
        feedHashToBanks.set(feedHash, []);
      }
      feedHashToBanks.get(feedHash)!.push(bank);
    }
  });

  // Batch check all feed hashes in a single request
  if (feedHashesToCheck.length > 0) {
    // If no crossbarUrl provided, assume all feeds are crankable (test mode)
    if (!crossbarUrl) {
      feedHashesToCheck.forEach((feedHash) => {
        const banksForFeed = feedHashToBanks.get(feedHash) || [];
        banksForFeed.forEach((bank) => {
          results.set(bank.oracleKey.toBase58(), {
            oracle: bank.oracleKey,
            crankable: true,
            reason: "Test mode - no crankability check",
          });
        });
      });
    } else {
      const crankabilityByFeedHash = await checkBatchOracleCrankability(
        feedHashesToCheck,
        crossbarUrl
      );

      // Map results back to banks
      crankabilityByFeedHash.forEach((result, feedHash) => {
        const banksForFeed = feedHashToBanks.get(feedHash) || [];
        banksForFeed.forEach((bank) => {
          results.set(bank.oracleKey.toBase58(), {
            oracle: bank.oracleKey,
            crankable: result.crankable,
            reason: result.reason,
          });
        });
      });
    }
  }

  return results;
}

/**
 * Filters banks into crankable and uncrankable sets
 */
export function partitionBanksByCrankability(
  banks: BankType[],
  crankabilityResults: Map<string, CrankabilityResult>
): {
  crankable: BankType[];
  uncrankable: Array<{ bank: BankType; reason: string }>;
} {
  const crankable: BankType[] = [];
  const uncrankable: Array<{ bank: BankType; reason: string }> = [];

  for (const bank of banks) {
    const result = crankabilityResults.get(bank.oracleKey.toBase58());

    if (!result) {
      // If no result, assume uncrankable to be safe
      uncrankable.push({
        bank,
        reason: "No crankability check result available",
      });
      continue;
    }

    if (result.crankable) {
      crankable.push(bank);
    } else {
      uncrankable.push({
        bank,
        reason: result.reason || "Unknown reason",
      });
    }
  }

  return { crankable, uncrankable };
}
