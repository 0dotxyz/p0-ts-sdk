import {
  assertAccountExists,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  getBase58Decoder,
  parseBase64RpcAccount,
  type Address,
  type Base58EncodedBytes,
  type EncodedAccount,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type GetProgramAccountsApi,
  type GetProgramAccountsMemcmpFilter,
  type Rpc,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { BalanceType, OrderType } from "../types";

import { decodeMarginfiAccount, parseOrderRaw } from "./deserialize.utils";

import {
  decodeFeeStateRaw,
  decodeOrderRaw,
  MARGINFI_ACCOUNT_DISCRIMINATOR,
  ORDER_DISCRIMINATOR,
} from "~/accounts";
import { MAX_BALANCES } from "~/constants";
import { deriveFeeState, deriveMarginfiAccount, wrappedI80F48toBigNumber } from "~/utils";

const DISCRIMINATOR_FILTER: GetProgramAccountsMemcmpFilter = {
  memcmp: {
    offset: 0n,
    bytes: getBase58Decoder().decode(MARGINFI_ACCOUNT_DISCRIMINATOR) as Base58EncodedBytes,
    encoding: "base58",
  },
};

export async function fetchMarginfiAccountAddresses(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
  authority: Address,
  group: Address
): Promise<Address[]> {
  const marginfiAccounts = (
    await rpc
      .getProgramAccounts(programAddress, {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
        filters: [
          DISCRIMINATOR_FILTER,
          {
            memcmp: {
              bytes: group,
              encoding: "base58",
              offset: 8n, // marginfiGroup is the first field in the account, so only offset is the discriminant
            },
          },
          {
            memcmp: {
              bytes: authority,
              encoding: "base58",
              offset: 8n + 32n, // authority is the second field in the account after the authority, so offset by the discriminant and a pubkey
            },
          },
        ],
      })
      .send()
  ).map((a) => a.pubkey);

  return marginfiAccounts;
}

// MarginfiAccount (bytemuck, repr(C)) byte layout — see src/idl/marginfi_0.1.11.json.
const GROUP_OFFSET = 8n; // after the 8-byte discriminator
const BALANCES_OFFSET = 72; // 8 discriminator + 32 group + 32 authority
const BALANCE_SIZE = 104; // one Balance struct (repr(C), align 8)
const BANK_PK_OFFSET_IN_BALANCE = 1; // active: u8 at +0, bankPk: pubkey at +1

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
async function scanBankSlots(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
  group: Address,
  bank: Address,
  options: {
    concurrency?: number;
    dataSlice?: { offset: number; length: number };
  }
): Promise<Map<Address, EncodedAccount>> {
  const slotOffsets = Array.from(
    { length: MAX_BALANCES },
    (_, n) => BALANCES_OFFSET + BANK_PK_OFFSET_IN_BALANCE + n * BALANCE_SIZE
  );

  const scanSlot = (offset: number) =>
    rpc
      .getProgramAccounts(programAddress, {
        encoding: "base64",
        dataSlice: options.dataSlice,
        filters: [
          DISCRIMINATOR_FILTER,
          { memcmp: { offset: GROUP_OFFSET, bytes: group, encoding: "base58" } },
          { memcmp: { offset: BigInt(offset), bytes: bank, encoding: "base58" } },
        ],
      })
      .send();

  const byAddress = new Map<Address, EncodedAccount>();
  const collect = (slotResults: Awaited<ReturnType<typeof scanSlot>>) => {
    for (const { pubkey, account } of slotResults) {
      byAddress.set(pubkey, parseBase64RpcAccount(pubkey, account));
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
}

/**
 * Fetches the addresses of every marginfi account in a group that holds a position in a
 * specific bank. Returns only addresses (uses `dataSlice` length 0 so no account data is
 * transferred or decoded) — important at the ~500k account scale of the group.
 *
 * @param rpc - Solana RPC client
 * @param programAddress - The marginfi program address
 * @param group - The marginfi group address
 * @param bank - The bank address to search for in account balances
 * @param options - Optional settings:
 *   - `concurrency`: max number of the 16 slot scans to run at once. Omit (or pass a value
 *     >= 16) to fire all 16 in parallel via `Promise.all`; pass a smaller value (e.g. 4) to
 *     batch them and avoid RPC rate limits.
 * @returns Deduplicated array of account addresses holding the bank
 */
export async function fetchMarginfiAccountAddressesHoldingBank(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
  group: Address,
  bank: Address,
  options?: { concurrency?: number }
): Promise<Address[]> {
  const byAddress = await scanBankSlots(rpc, programAddress, group, bank, {
    concurrency: options?.concurrency,
    dataSlice: { offset: 0, length: 0 },
  });
  return Array.from(byAddress.keys());
}

/** One account's active balance position in a specific bank. */
export type AccountActiveBalanceForBank = {
  accountAddress: Address;
  authority: Address;
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
 * @param rpc - Solana RPC client
 * @param programAddress - The marginfi program address
 * @param group - The marginfi group address
 * @param bank - The bank address to search for in account balances
 * @param options - Optional settings:
 *   - `concurrency`: max number of the 16 slot scans to run at once (see above).
 * @returns One entry per account holding the bank, with authority and the matching balance
 */
export async function fetchMarginfiAccountActiveBalancesForBank(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
  group: Address,
  bank: Address,
  options?: { concurrency?: number }
): Promise<AccountActiveBalanceForBank[]> {
  // Omit dataSlice so we get full account data to decode authority + balance shares.
  const byAddress = await scanBankSlots(rpc, programAddress, group, bank, {
    concurrency: options?.concurrency,
  });

  const results: AccountActiveBalanceForBank[] = [];
  for (const [accountAddress, account] of byAddress) {
    const parsed = decodeMarginfiAccount(accountAddress, account.data);
    const balance = parsed.balances.find((b) => b.active && b.bankPk === bank);
    // Defensive: the memcmp matched this bank, so an active balance should exist. Skip if the
    // slot was deactivated between the scan and decode.
    if (!balance) continue;
    results.push({ accountAddress, authority: parsed.authority, balance });
  }

  return results;
}

function randomDistinctIndices(count: number, maxExclusive: number): number[] {
  const chosen = new Set<number>();
  while (chosen.size < count) {
    chosen.add(Math.floor(Math.random() * maxExclusive));
  }
  return [...chosen];
}

/**
 * Picks a random account index below 255 whose marginfi account PDA (`group`, `authority`, index,
 * `thirdPartyId`) doesn't exist yet, checking 16 candidates per RPC call.
 * @throws Error if 8 batches of candidates are all taken
 */
export async function findRandomAvailableAccountIndex(
  rpc: Rpc<GetMultipleAccountsApi>,
  programAddress: Address,
  group: Address,
  authority: Address,
  thirdPartyId: number = 0
): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const indices = randomDistinctIndices(16, 255);
    const pdas = await Promise.all(
      indices.map(
        async (index) =>
          (await deriveMarginfiAccount(programAddress, group, authority, index, thirdPartyId))[0]
      )
    );
    const accounts = await fetchEncodedAccounts(rpc, pdas);
    const freeIndex = indices.find((_, i) => !accounts[i].exists);
    if (freeIndex !== undefined) return freeIndex;
  }

  throw new Error("Unable to find free index after many attempts");
}

/**
 * Fetches all orders for a marginfi account, including orphaned ones.
 *
 * @param rpc - Solana RPC client
 * @param programAddress - The marginfi program address
 * @param marginfiAccount - The marginfi account address
 */
export async function fetchOrdersForAccount(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
  marginfiAccount: Address
): Promise<OrderType[]> {
  const orders = await rpc
    .getProgramAccounts(programAddress, {
      encoding: "base64",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: getBase58Decoder().decode(ORDER_DISCRIMINATOR) as Base58EncodedBytes,
            encoding: "base58",
          },
        },
        // marginfiAccount is the first field after the discriminator
        { memcmp: { offset: 8n, bytes: marginfiAccount, encoding: "base58" } },
      ],
    })
    .send();

  return orders.map(({ pubkey, account }) =>
    parseOrderRaw(pubkey, decodeOrderRaw(parseBase64RpcAccount(pubkey, account).data))
  );
}

/**
 * Fetches the global fee wallet from the program's `FeeState` (order placement fees go there).
 *
 * @param rpc - Solana RPC client
 * @param programAddress - The marginfi program address
 * @throws if the program's fee state account doesn't exist
 */
export async function fetchGlobalFeeWallet(
  rpc: Rpc<GetAccountInfoApi>,
  programAddress: Address
): Promise<Address> {
  const [feeStateAddress] = await deriveFeeState(programAddress);
  const feeStateAccount = await fetchEncodedAccount(rpc, feeStateAddress);
  assertAccountExists(feeStateAccount);
  return decodeFeeStateRaw(feeStateAccount.data).globalFeeWallet;
}

/**
 * Fetches the order fees from the program's global `FeeState`.
 *
 * - `placementFeeLamports`: flat SOL fee charged by `place_order` (and again on every update).
 * - `executionMaxFee`: the share of the pair's net value a keeper may keep on a take-profit.
 *
 * @param rpc - Solana RPC client
 * @param programAddress - The marginfi program address
 * @throws if the program's fee state account doesn't exist
 */
export async function fetchOrderFees(
  rpc: Rpc<GetAccountInfoApi>,
  programAddress: Address
): Promise<{ placementFeeLamports: number; executionMaxFee: BigNumber }> {
  const [feeStateAddress] = await deriveFeeState(programAddress);
  const feeStateAccount = await fetchEncodedAccount(rpc, feeStateAddress);
  assertAccountExists(feeStateAccount);
  const feeState = decodeFeeStateRaw(feeStateAccount.data);
  return {
    placementFeeLamports: feeState.orderInitFlatSolFee,
    executionMaxFee: wrappedI80F48toBigNumber(feeState.orderExecutionMaxFee),
  };
}
