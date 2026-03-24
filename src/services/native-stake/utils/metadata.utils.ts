/**
 * @module metadata.utils
 *
 * Temporary hardcoded staked bank metadata.
 * This will be replaced by a dynamic API fetch once the backend endpoint is available.
 *
 * Source: https://storage.googleapis.com/mrgn-public/mrgn-staked-bank-metadata-cache.json
 *
 * TODO: Replace with dynamic fetch from API when available.
 */
import { STAKED_BANK_METADATA_JSON } from "./metadata.data";

// -- Types ----

/**
 * Metadata for a staked bank entry.
 * Sourced from hardcoded JSON — update via `metadata.data.ts` until dynamic fetching is implemented.
 */
export interface StakedBankMetadata {
  bankAddress: string;
  validatorVoteAccount: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
}

// -- Cached Maps ----

let _metadataMap: Map<string, StakedBankMetadata> | null = null;
let _voteAccountByBank: Record<string, string> | null = null;

// -- Public API ----

/**
 * Returns a Map of bankAddress → StakedBankMetadata (lazy-cached).
 *
 * @remarks Uses hardcoded data. TODO: Replace with dynamic API fetch.
 */
export function getStakedBankMetadataMap(): Map<string, StakedBankMetadata> {
  if (!_metadataMap) {
    _metadataMap = new Map();
    for (const entry of STAKED_BANK_METADATA_JSON) {
      _metadataMap.set(entry.bankAddress, entry);
    }
  }
  return _metadataMap;
}

/**
 * Returns a Record of bankAddress → validatorVoteAccount (lazy-cached).
 *
 * @remarks Uses hardcoded data. TODO: Replace with dynamic API fetch.
 */
export function getValidatorVoteAccountByBank(): Record<string, string> {
  if (!_voteAccountByBank) {
    _voteAccountByBank = {};
    for (const entry of STAKED_BANK_METADATA_JSON) {
      _voteAccountByBank[entry.bankAddress] = entry.validatorVoteAccount;
    }
  }
  return _voteAccountByBank;
}
