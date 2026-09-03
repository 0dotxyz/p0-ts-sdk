import {
  AccountInfo,
  Connection,
  GetProgramAccountsFilter,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";


import { simulateAccountHealthCache } from "../services";
import {
  BalanceType,
  HealthCacheSimulationError,
  MarginfiAccountRaw,
  MarginfiAccountType,
} from "../types";

import { parseMarginfiAccountRaw } from "./deserialize.utils";

import { BankType } from "~/services/bank";
import { AccountType, BankIntegrationMetadataMap, MarginfiProgram } from "~/types";
import { deriveMarginfiAccount } from "~/utils";

export const fetchMarginfiAccountAddresses = async (
  program: MarginfiProgram,
  authority: PublicKey,
  group: PublicKey
): Promise<PublicKey[]> => {
  const marginfiAccounts = (
    await program.account.marginfiAccount.all([
      {
        memcmp: {
          bytes: group.toBase58(),
          offset: 8, // marginfiGroup is the first field in the account, so only offset is the discriminant
        },
      },
      {
        memcmp: {
          bytes: authority.toBase58(),
          offset: 8 + 32, // authority is the second field in the account after the authority, so offset by the discriminant and a pubkey
        },
      },
    ])
  ).map((a) => a.publicKey);

  return marginfiAccounts;
};

// MarginfiAccount (bytemuck, repr(C)) byte layout — see src/idl/marginfi_0.1.11.json.
const MARGINFI_ACCOUNT_DISCRIMINATOR = Buffer.from([67, 178, 130, 109, 126, 114, 28, 42]);
const GROUP_OFFSET = 8; // after the 8-byte discriminator
const BALANCES_OFFSET = 72; // 8 discriminator + 32 group + 32 authority
const BALANCE_SIZE = 104; // one Balance struct (repr(C), align 8)
const BANK_PK_OFFSET_IN_BALANCE = 1; // active: u8 at +0, bankPk: pubkey at +1
const MAX_BALANCES = 16; // LendingAccount holds a fixed [Balance; 16]

/**
 * Scans the group for every marginfi account holding `bank` in one of its 16 balance slots.
 *
 * A marginfi account stores up to 16 balance slots, sorted descending by `bankPk`, so the
 * target bank can sit at any slot (each at a different byte offset). memcmp filters are AND-ed,
 * so we can't OR across slots in one call — instead we issue one filtered `getProgramAccounts`
 * per balance slot and union the results. Inactive slots have a zeroed `bankPk`, so matching a
 * real bank pubkey only ever hits active holdings.
 *
 * Pass `dataSlice: { offset: 0, length: 0 }` when you only need addresses (no data transferred);
 * omit it to get full account data for decoding. Results are deduped by address (a bank appears
 * in at most one slot per account, but we dedupe for safety).
 */
const scanBankSlots = async (
  program: MarginfiProgram,
  group: PublicKey,
  bank: PublicKey,
  options: {
    concurrency?: number;
    dataSlice?: { offset: number; length: number };
  }
): Promise<Map<string, AccountInfo<Buffer>>> => {
  const connection = program.provider.connection;
  const programId = program.programId;

  const discriminatorBytes = bs58.encode(MARGINFI_ACCOUNT_DISCRIMINATOR);
  const groupBytes = group.toBase58();
  const bankBytes = bank.toBase58();

  const slotOffsets = Array.from(
    { length: MAX_BALANCES },
    (_, n) => BALANCES_OFFSET + BANK_PK_OFFSET_IN_BALANCE + n * BALANCE_SIZE
  );

  const scanSlot = (offset: number) => {
    const filters: GetProgramAccountsFilter[] = [
      { memcmp: { offset: 0, bytes: discriminatorBytes } },
      { memcmp: { offset: GROUP_OFFSET, bytes: groupBytes } },
      { memcmp: { offset, bytes: bankBytes } },
    ];
    return connection.getProgramAccounts(programId, {
      filters,
      dataSlice: options.dataSlice,
    });
  };

  const byAddress = new Map<string, AccountInfo<Buffer>>();
  const collect = (slotResults: Awaited<ReturnType<typeof scanSlot>>) => {
    for (const { pubkey, account } of slotResults) {
      byAddress.set(pubkey.toBase58(), account);
    }
  };

  const concurrency = options.concurrency;
  if (concurrency === undefined || concurrency >= slotOffsets.length) {
    // Fire all slot scans at once.
    (await Promise.all(slotOffsets.map(scanSlot))).forEach(collect);
  } else {
    // Batch the slot scans to stay under the concurrency limit.
    const batchSize = Math.max(1, Math.floor(concurrency));
    for (let i = 0; i < slotOffsets.length; i += batchSize) {
      const batch = slotOffsets.slice(i, i + batchSize);
      (await Promise.all(batch.map(scanSlot))).forEach(collect);
    }
  }

  return byAddress;
};

/**
 * Fetches the addresses of every marginfi account in a group that holds a position in a
 * specific bank. Returns only addresses (uses `dataSlice` length 0 so no account data is
 * transferred or decoded) — important at the ~500k account scale of the group.
 *
 * @param program - The marginfi Anchor program (connection is taken from its provider)
 * @param group - The marginfi group public key
 * @param bank - The bank public key to search for in account balances
 * @param options - Optional settings:
 *   - `concurrency`: max number of the 16 slot scans to run at once. Omit (or pass a value
 *     >= 16) to fire all 16 in parallel via `Promise.all`; pass a smaller value (e.g. 4) to
 *     batch them and avoid RPC rate limits.
 * @returns Deduplicated array of account addresses holding the bank
 */
export const fetchMarginfiAccountAddressesHoldingBank = async (
  program: MarginfiProgram,
  group: PublicKey,
  bank: PublicKey,
  options?: { concurrency?: number }
): Promise<PublicKey[]> => {
  const byAddress = await scanBankSlots(program, group, bank, {
    concurrency: options?.concurrency,
    dataSlice: { offset: 0, length: 0 },
  });
  return Array.from(byAddress.keys(), (a) => new PublicKey(a));
};

/** One account's active balance position in a specific bank. */
export type AccountActiveBalanceForBank = {
  accountAddress: PublicKey;
  authority: PublicKey;
  balance: BalanceType;
};

/**
 * Fetches every marginfi account in a group that holds `bank`, along with its authority and the
 * active balance (shares) it holds in that bank.
 *
 * Unlike {@link fetchMarginfiAccountAddressesHoldingBank}, this fetches full account data so it
 * can decode the authority and balance shares — heavier, but a single round trip (no separate
 * hydration). The returned `balance` holds raw asset/liability shares; convert to token amounts
 * with the bank's share multiplier (e.g. `Balance.computeQuantityUi(bank, multiplier)`).
 *
 * @param program - The marginfi Anchor program (connection is taken from its provider)
 * @param group - The marginfi group public key
 * @param bank - The bank public key to search for in account balances
 * @param options - Optional settings:
 *   - `concurrency`: max number of the 16 slot scans to run at once (see above).
 * @returns One entry per account holding the bank, with authority and the matching balance
 */
export const fetchMarginfiAccountActiveBalancesForBank = async (
  program: MarginfiProgram,
  group: PublicKey,
  bank: PublicKey,
  options?: { concurrency?: number }
): Promise<AccountActiveBalanceForBank[]> => {
  // Omit dataSlice so we get full account data to decode authority + balance shares.
  const byAddress = await scanBankSlots(program, group, bank, {
    concurrency: options?.concurrency,
  });

  const results: AccountActiveBalanceForBank[] = [];
  for (const [address, account] of byAddress) {
    const accountAddress = new PublicKey(address);
    const raw = program.coder.accounts.decode<MarginfiAccountRaw>(
      AccountType.MarginfiAccount,
      account.data
    );
    const parsed = parseMarginfiAccountRaw(accountAddress, raw);
    const balance = parsed.balances.find((b) => b.active && b.bankPk.equals(bank));
    // Defensive: the memcmp matched this bank, so an active balance should exist. Skip if the
    // slot was deactivated between the scan and decode.
    if (!balance) continue;
    results.push({ accountAddress, authority: parsed.authority, balance });
  }

  return results;
};

export const fetchMarginfiAccountData = async (
  program: MarginfiProgram,
  marginfiAccountPk: PublicKey,
  banksMap: Map<string, BankType>,
  bankIntegrationMap?: BankIntegrationMetadataMap
): Promise<{
  marginfiAccount: MarginfiAccountType;
  error?: HealthCacheSimulationError;
}> => {
  const marginfiAccountRaw: MarginfiAccountRaw = await program.account.marginfiAccount.fetch(
    marginfiAccountPk,
    "confirmed"
  );
  const marginfiAccount = parseMarginfiAccountRaw(marginfiAccountPk, marginfiAccountRaw);

  try {
    const simulatedAccount = await simulateAccountHealthCache({
      program,
      banksMap,
      marginfiAccount,
      bankIntegrationMap,
    });

    const marginfiAccountWithCache = parseMarginfiAccountRaw(marginfiAccountPk, simulatedAccount);

    return { marginfiAccount: marginfiAccountWithCache };
  } catch (e) {
    console.error("Error simulating account health cache", e);
    if (e instanceof HealthCacheSimulationError) {
      return { marginfiAccount, error: e };
    }
    return { marginfiAccount };
  }
};

function randomDistinctIndices(count: number, maxExclusive: number): number[] {
  const chosen = new Set<number>();
  while (chosen.size < count) {
    chosen.add(Math.floor(Math.random() * maxExclusive));
  }
  return [...chosen];
}

/**
 * Generates a random available account index that doesn't collide with existing accounts.
 * Account indices are 0-255 (u8 range).
 *
 * @param connection - Solana connection
 * @param programId - MarginFi program ID
 * @param group - MarginFi group public key
 * @param authority - User's wallet public key
 * @param thirdPartyId - Third party ID (default 0)
 * @returns A random available account index (0-255)
 */
export async function findRandomAvailableAccountIndex(
  connection: Connection,
  programId: PublicKey,
  group: PublicKey,
  authority: PublicKey,
  thirdPartyId: number = 0
): Promise<number> {
  const MAX_INDEX = 255; // u8 range: 0-255
  const BATCH_SIZE = 16; // 16 or 32 is fine
  const MAX_ATTEMPTS = 8; // realisticly all accounts will be found in the first attempt

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. Pick a random batch of distinct indices in [0, 255]
    const indices = randomDistinctIndices(Math.min(BATCH_SIZE, MAX_INDEX), MAX_INDEX);

    // 2. Derive PDAs for these indices
    const pdas = indices.map(
      (i) => deriveMarginfiAccount(programId, group, authority, i, thirdPartyId)[0]
    );

    // 3. Check which PDAs exist on-chain
    const accountInfos = await connection.getMultipleAccountsInfo(pdas);

    // 4. Find the first index whose PDA doesn't exist yet
    for (let i = 0; i < indices.length; i++) {
      const indice = indices[i];
      if (accountInfos[i] === null && indice !== undefined) {
        // This index is free right now
        return indice;
      }
    }
  }

  // If we get here, indices are taken, (create custom error)
  throw new Error("Unable to find free index after many attempts");
}
