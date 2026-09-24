import { address } from "@solana/kit";

import { MarginfiGroupTypeDto, MarginfiGroupType } from "../types";

import { dtoToBankRateLimiter } from "~/services/bank/utils/deserialize.utils";

export function dtoToGroup(groupDto: MarginfiGroupTypeDto): MarginfiGroupType {
  return {
    admin: address(groupDto.admin),
    address: address(groupDto.address),
    rateLimiter: groupDto.rateLimiter ? dtoToBankRateLimiter(groupDto.rateLimiter) : undefined,
  };
}
