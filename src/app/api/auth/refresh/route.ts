/**
 * POST /api/auth/refresh
 *
 * Proxy to OKX: /priapi/v5/wallet/agentic/auth/refresh
 * Refreshes an expired access token using the refresh token.
 *
 * Request body: { refreshToken: string }
 * Response: { accessToken: string, refreshToken: string }
 */

const OKX_BASE_URL = process.env.OKX_BASE_URL ?? "https://www.okx.com";
const API_PREFIX = "/priapi/v5/wallet/agentic";

export async function POST(req: Request) {
  const body = await req.json();
  const { refreshToken } = body;

  if (!refreshToken || typeof refreshToken !== "string") {
    return Response.json(
      { error: "refreshToken is required" },
      { status: 400 },
    );
  }

  try {
    const url = `${OKX_BASE_URL}${API_PREFIX}/auth/refresh`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[api/auth/refresh] OKX error:", res.status, text);
      return Response.json(
        { error: `OKX API error: ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();

    if (String(data.code) !== "0") {
      return Response.json(
        { error: data.msg || "Token refresh failed" },
        { status: 400 },
      );
    }

    const result = data.data?.[0];
    if (!result) {
      return Response.json(
        { error: "No data returned from OKX refresh" },
        { status: 500 },
      );
    }

    return Response.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    console.error("[api/auth/refresh] Error:", err);
    return Response.json(
      { error: "Failed to refresh token" },
      { status: 500 },
    );
  }
}
