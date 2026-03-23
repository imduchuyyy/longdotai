/**
 * POST /api/balances
 *
 * Proxies balance requests to OKX Agentic Wallet API.
 * Client sends { accessToken, accountId } from localStorage session.
 */

const OKX_BASE_URL = process.env.OKX_BASE_URL ?? "https://www.okx.com";
const XLAYER_CHAIN_INDEX = "196";

export async function POST(req: Request) {
  const body = await req.json();
  const { accessToken, accountId } = body;

  if (!accessToken || !accountId) {
    return Response.json(
      { error: "accessToken and accountId are required" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `${OKX_BASE_URL}/priapi/v5/wallet/agentic/asset/wallet-all-token-balances`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          accountId,
          chainIndexList: [XLAYER_CHAIN_INDEX],
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[api/balances] OKX HTTP error:", res.status, text);
      return Response.json(
        { error: "Failed to fetch balances from OKX" },
        { status: 502 },
      );
    }

    const data = await res.json();
    const code = typeof data.code === "string" ? data.code : String(data.code);

    if (code !== "0") {
      console.error("[api/balances] OKX API error:", data.code, data.msg);
      return Response.json(
        { error: `OKX API error: ${data.msg}` },
        { status: 502 },
      );
    }

    // data.data is an array of token balance objects
    const balances = (data.data ?? []).map(
      (b: {
        chainIndex: string;
        tokenAddress: string;
        symbol: string;
        balance: string;
        tokenPrice: string;
        tokenType: string;
        isRiskToken: boolean;
      }) => ({
        chainIndex: b.chainIndex,
        tokenAddress: b.tokenAddress,
        symbol: b.symbol,
        balance: b.balance,
        tokenPrice: b.tokenPrice,
        tokenType: b.tokenType,
        isRiskToken: b.isRiskToken,
      }),
    );

    return Response.json({ balances });
  } catch (err) {
    console.error("[api/balances] Error:", err);
    return Response.json(
      { error: "Failed to fetch balances" },
      { status: 500 },
    );
  }
}
