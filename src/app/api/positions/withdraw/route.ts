/**
 * POST /api/positions/withdraw
 *
 * Removes liquidity from a Uniswap V3 LP position and collects the tokens.
 *
 * Body: {
 *   session: OkxSession,       // the OKX agentic wallet session
 *   tokenId: string,           // the NFT position ID
 *   percentToRemove?: number,  // 1-100, default 100 (full withdrawal)
 * }
 *
 * This performs two on-chain transactions:
 *   1. decreaseLiquidity — burns the LP liquidity
 *   2. collect — claims the tokens (including any uncollected fees)
 *
 * Returns: { decreaseTxHash, collectTxHash, tokenId, percentRemoved }
 */

import { serverSignAndBroadcast, getWalletAddress } from "@/lib/okx-server";
import type { OkxSession } from "@/lib/okx-auth-store";
import {
  getPositions,
  encodeDecreaseLiquidity,
  encodeCollect,
  waitForTx,
  UNISWAP_V3,
} from "@/lib/uniswap";

export const maxDuration = 120;

export async function POST(req: Request) {
  let body: {
    session?: OkxSession;
    tokenId?: string;
    percentToRemove?: number;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { session, tokenId, percentToRemove } = body;

  if (!session) {
    return Response.json(
      { error: "Session is required. Please sign in first." },
      { status: 401 },
    );
  }

  if (!tokenId) {
    return Response.json(
      { error: "tokenId is required." },
      { status: 400 },
    );
  }

  const wallet = getWalletAddress(session);
  if (!wallet) {
    return Response.json(
      { error: "No wallet address found in session." },
      { status: 400 },
    );
  }

  try {
    const targetTokenId = BigInt(tokenId);

    // Look up position to get its current liquidity
    const positions = await getPositions(wallet);
    const pos = positions.find((p) => p.tokenId === targetTokenId);

    if (!pos) {
      return Response.json(
        { error: `Position #${tokenId} not found or has no liquidity.` },
        { status: 404 },
      );
    }

    const pct = Math.min(Math.max(percentToRemove ?? 100, 1), 100);
    const liquidityToRemove = (pos.liquidity * BigInt(pct)) / 100n;

    // Step 1: Decrease liquidity
    const decreaseData = encodeDecreaseLiquidity({
      tokenId: targetTokenId,
      liquidity: liquidityToRemove,
      amount0Min: 0n,
      amount1Min: 0n,
    });

    const decreaseTx = await serverSignAndBroadcast({
      session,
      toAddr: UNISWAP_V3.positionManager,
      value: "0",
      contractAddr: UNISWAP_V3.positionManager,
      inputData: decreaseData,
      isContractCall: true,
    });

    await waitForTx(decreaseTx.txHash);

    // Step 2: Collect tokens (including any uncollected fees)
    const collectData = encodeCollect(targetTokenId, wallet);

    const collectTx = await serverSignAndBroadcast({
      session: decreaseTx.session, // use potentially refreshed session
      toAddr: UNISWAP_V3.positionManager,
      value: "0",
      contractAddr: UNISWAP_V3.positionManager,
      inputData: collectData,
      isContractCall: true,
    });

    return Response.json({
      tokenId,
      percentRemoved: pct,
      decreaseTxHash: decreaseTx.txHash,
      collectTxHash: collectTx.txHash,
      explorerUrl: `https://www.okx.com/explorer/xlayer/tx/${collectTx.txHash}`,
    });
  } catch (err) {
    console.error("[api/positions/withdraw] Error:", err);
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to withdraw position",
      },
      { status: 500 },
    );
  }
}
