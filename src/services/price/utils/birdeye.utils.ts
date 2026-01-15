interface BirdeyeTokenPriceResponse {
  success: boolean;
  data: Record<
    string,
    { value: number; updateUnixTime: number; updateHumanTime: string }
  >;
}

/**
 * Fetches Birdeye prices for specific mint addresses using the existing /api/tokens/multi endpoint.
 *
 * @param mintAddresses - Array of mint addresses to fetch prices for
 * @param apiEndpoint - Base API endpoint URL (without query parameters)
 * @param opts - Optional configuration object
 * @param opts.queryKey - Query parameter name for mint list (defaults to "mintList")
 * @returns Promise resolving to a record mapping mint addresses to their price values
 */
export async function getBirdeyePricesForMints(
  mintAddresses: string[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<Record<string, number>> {
  const queryKey = opts?.queryKey ?? "mintList";
  try {
    const url = `${apiEndpoint}?${queryKey}=${mintAddresses.join(",")}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Response is not ok");
    }

    const data = (await response.json()) as BirdeyeTokenPriceResponse;
    if (!data.success) {
      throw new Error("Success field is false");
    }
    const rawPrices = data.data || {};

    const extractedPrices: Record<string, number> = {};
    Object.entries(rawPrices).forEach(([mint, priceData]) => {
      extractedPrices[mint] = priceData.value;
    });

    return extractedPrices;
  } catch (error) {
    // TODO: add sentry logging
    console.warn("Error fetching Birdeye prices for static feeds:", error);
    return {};
  }
}

/**
 * Fetches Birdeye fallback prices and maps them by feed ID
 * @param feedMint - Array of objects containing feedId and mintAddress pairs
 * @returns Promise resolving to record of prices indexed by feed ID
 */
export const getBirdeyeFallbackPricesByFeedId = async (
  feedMint: {
    feedId: string;
    mintAddress: string;
  }[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<Record<string, number>> => {
  const mintAddresses = feedMint.map((feedMint) => feedMint.mintAddress);
  const prices = await getBirdeyePricesForMints(
    mintAddresses,
    apiEndpoint,
    opts
  );

  const priceByFeedId: Record<string, number> = {};
  feedMint.forEach((feedMint) => {
    const feedId = feedMint.feedId;
    const mintAddress = feedMint.mintAddress;
    const price = prices[mintAddress];

    if (price) {
      priceByFeedId[feedId] = price;
    }
  });

  return priceByFeedId;
};
