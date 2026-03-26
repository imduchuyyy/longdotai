/**
 * GET /api/positions?address=0x...
 *
 * Returns all Uniswap V3 LP positions for the given address on X Layer.
 * Calls getDetailedPositions() from src/lib/uniswap.ts which reads directly
 * from the NonfungiblePositionManager contract on-chain.
 *
 * Response shape:
 * {
 *   positions: DetailedPositionInfo[]   // serialized with tokenId as string
 * }
 *
 * BigInt fields (tokenId, liquidity) are converted to strings for JSON.
 */

import { getDetailedPositions } from "@/lib/uniswap";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json(
      { error: "Valid EVM address is required (query param: address)" },
      { status: 400 },
    );
  }

  try {
    const positions = await getDetailedPositions(address);

    // Serialize BigInt fields to strings for JSON
    const serialized = positions.map((p) => ({
      ...p,
      tokenId: p.tokenId.toString(),
      liquidity: p.liquidity.toString(),
    }));

    return Response.json({ positions: serialized });
  } catch (err) {
    console.error("[api/positions] Error fetching positions:", err);
    return Response.json(
      { error: "Failed to fetch positions from chain" },
      { status: 500 },
    );
  }
}
