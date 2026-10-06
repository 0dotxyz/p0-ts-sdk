import { PublicKey } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import { MarginfiGroupTypeDto, MarginfiGroupType } from "../types";

import { dtoToBankRateLimiter } from "~/services/bank";

export function dtoToGroup(groupDto: MarginfiGroupTypeDto): MarginfiGroupType {
  return {
    admin: new PublicKey(groupDto.admin),
    address: new PublicKey(groupDto.address),
    premiumEntries: (groupDto.premiumEntries ?? []).map((entry) => ({
      ...entry,
      rate: new BigNumber(entry.rate),
    })),
    rateLimiter: groupDto.rateLimiter ? dtoToBankRateLimiter(groupDto.rateLimiter) : undefined,
  };
}
