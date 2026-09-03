import { PublicKey } from "@solana/web3.js";

import { MarginfiGroupTypeDto, MarginfiGroupType } from "../types";

import { dtoToBankRateLimiter } from "~/services/bank";

export function dtoToGroup(groupDto: MarginfiGroupTypeDto): MarginfiGroupType {
  return {
    admin: new PublicKey(groupDto.admin),
    address: new PublicKey(groupDto.address),
    rateLimiter: groupDto.rateLimiter ? dtoToBankRateLimiter(groupDto.rateLimiter) : undefined,
  };
}
