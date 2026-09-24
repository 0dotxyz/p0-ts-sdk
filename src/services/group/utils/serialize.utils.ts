import { MarginfiGroupTypeDto, MarginfiGroupType } from "../types";

import { toBankRateLimiterDto } from "~/services/bank/utils/serialize.utils";

export function groupToDto(group: MarginfiGroupType): MarginfiGroupTypeDto {
  return {
    admin: group.admin,
    address: group.address,
    rateLimiter: group.rateLimiter ? toBankRateLimiterDto(group.rateLimiter) : undefined,
  };
}
