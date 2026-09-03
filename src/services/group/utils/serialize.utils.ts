import { MarginfiGroupTypeDto, MarginfiGroupType } from "../types";

import { toBankRateLimiterDto } from "~/services/bank";

export function groupToDto(group: MarginfiGroupType): MarginfiGroupTypeDto {
  return {
    admin: group.admin.toBase58(),
    address: group.address.toBase58(),
    rateLimiter: group.rateLimiter ? toBankRateLimiterDto(group.rateLimiter) : undefined,
  };
}
