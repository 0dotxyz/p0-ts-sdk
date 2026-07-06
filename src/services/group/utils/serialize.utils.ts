import { toBankRateLimiterDto } from "~/services/bank";

import { MarginfiGroupTypeDto, MarginfiGroupType } from "../types";

export function groupToDto(group: MarginfiGroupType): MarginfiGroupTypeDto {
  return {
    admin: group.admin.toBase58(),
    address: group.address.toBase58(),
    rateLimiter: group.rateLimiter ? toBankRateLimiterDto(group.rateLimiter) : undefined,
  };
}
