import { Connection } from "@solana/web3.js";
import { Bank } from "~/models/bank";
import { BankIntegrationMetadataMap } from "~/types";
import { getKaminoMetadata, KaminoMetadata } from "./kamino";
import { getDriftMetadata, DriftMetadata } from "./drift";
import { getJupLendMetadata, JupLendMetadata } from "./juplend";

export type IntegrationType = "kamino" | "drift" | "juplend";

export interface FetchBankIntegrationMetadataOptions {
  connection: Connection;
  banks: Bank[];
  integrations?: IntegrationType[];
}

/**
 * Fetch metadata from all enabled integrations and merge into single map
 *
 * This orchestrator:
 * 1. Fetches data from all specified integrations in parallel
 * 2. Merges results into a single BankIntegrationMetadataMap
 * 3. Each bank can have metadata from multiple integrations
 *
 * @param options - Connection, banks, and optional integration filter
 * @returns Combined metadata map keyed by bank address
 *
 * @example
 * ```typescript
 * const metadata = await fetchBankIntegrationMetadata({
 *   connection,
 *   banks: allBanks,
 *   integrations: ["kamino"], // Optional, defaults to all
 * });
 *
 * // Access Kamino data for a specific bank
 * const kaminoData = metadata[bankAddress]?.kaminoStates;
 * ```
 */
export async function fetchBankIntegrationMetadata(
  options: FetchBankIntegrationMetadataOptions
): Promise<BankIntegrationMetadataMap> {
  const { connection, banks, integrations = ["kamino", "drift", "juplend"] } = options;
  const bankIntegrationMap: BankIntegrationMetadataMap = {};

  // Fetch from each integration in parallel
  const fetchPromises: Promise<{
    type: IntegrationType;
    data: Map<string, KaminoMetadata | DriftMetadata | JupLendMetadata>;
  }>[] = [];

  if (integrations.includes("kamino")) {
    fetchPromises.push(
      getKaminoMetadata({ connection, banks }).then((kaminoMap: Map<string, KaminoMetadata>) => ({
        type: "kamino" as const,
        data: kaminoMap,
      }))
    );
  }

  if (integrations.includes("drift")) {
    fetchPromises.push(
      getDriftMetadata({ connection, banks }).then((driftMap: Map<string, DriftMetadata>) => ({
        type: "drift" as const,
        data: driftMap,
      }))
    );
  }

  if (integrations.includes("juplend")) {
    fetchPromises.push(
      getJupLendMetadata({ connection, banks }).then(
        (jupLendMap: Map<string, JupLendMetadata>) => ({
          type: "juplend" as const,
          data: jupLendMap,
        })
      )
    );
  }

  const results = await Promise.all(fetchPromises);

  // Merge all results into single map
  for (const result of results) {
    for (const [bankAddress, metadata] of result.data.entries()) {
      if (!bankIntegrationMap[bankAddress]) {
        bankIntegrationMap[bankAddress] = {};
      }

      // Merge integration-specific metadata
      Object.assign(bankIntegrationMap[bankAddress], metadata);
    }
  }

  return bankIntegrationMap;
}
