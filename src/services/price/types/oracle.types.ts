export type SwbOracleAiDataByKey = Record<
  string,
  {
    queue: string;
    feedHash: string;
    maxVariance: string;
    minResponses: number;
    rawPrice: string;
    stdev: string;
  }
>;
