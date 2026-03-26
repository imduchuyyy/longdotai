/**
 * POST /api/defi
 *
 * Server-side proxy for OKX DeFi API endpoints.
 * Uses HMAC-SHA256 auth (same pattern as /api/balances and /api/swap).
 *
 * Supports multiple actions via `action` field in the request body:
 *   - "authorization"  → POST /api/v5/defi/transaction/authorization
 *   - "subscription"   → POST /api/v5/defi/transaction/subscription
 *   - "redemption"     → POST /api/v5/defi/transaction/redemption
 *   - "product-detail" → GET  /api/v5/defi/explore/product/detail
 *   - "product-list"   → POST /api/v5/defi/explore/product/list
 *
 * The OKX DeFi API uses POST with JSON body for transaction endpoints
 * and GET with query params for explore endpoints. Both require HMAC headers.
 */

import { createHmac } from "node:crypto";

const OKX_API_BASE = "https://web3.okx.com";

const OKX_ACCESS_KEY = process.env.OKX_ACCESS_KEY ?? "";
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY ?? "";
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE ?? "";

function getOkxHeaders(
  method: string,
  requestPath: string,
  body: string = "",
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const preSign = timestamp + method.toUpperCase() + requestPath + body;
  const sign = createHmac("sha256", OKX_SECRET_KEY)
    .update(preSign)
    .digest("base64");

  return {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": OKX_ACCESS_KEY,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
    "OK-ACCESS-TIMESTAMP": timestamp,
  };
}

type DefiAction =
  | "authorization"
  | "subscription"
  | "redemption"
  | "product-detail"
  | "product-list";

interface DefiRequest {
  action: DefiAction;
  /** Body for POST endpoints (authorization, subscription, redemption, product-list) */
  body?: Record<string, unknown>;
  /** Params for GET endpoints (product-detail) */
  params?: Record<string, string>;
}

const POST_ENDPOINTS: Record<string, string> = {
  authorization: "/api/v5/defi/transaction/authorization",
  subscription: "/api/v5/defi/transaction/subscription",
  redemption: "/api/v5/defi/transaction/redemption",
  "product-list": "/api/v5/defi/explore/product/list",
};

const GET_ENDPOINTS: Record<string, string> = {
  "product-detail": "/api/v5/defi/explore/product/detail",
};

export async function POST(req: Request) {
  const { action, body: reqBody, params } = (await req.json()) as DefiRequest;

  if (!action) {
    return Response.json({ error: "Missing action" }, { status: 400 });
  }

  if (!OKX_ACCESS_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
    return Response.json(
      { error: "OKX API keys not configured" },
      { status: 500 },
    );
  }

  try {
    // GET endpoints
    if (GET_ENDPOINTS[action]) {
      const queryString = new URLSearchParams(params ?? {}).toString();
      const requestPath = queryString
        ? `${GET_ENDPOINTS[action]}?${queryString}`
        : GET_ENDPOINTS[action];

      const headers = getOkxHeaders("GET", requestPath);

      const res = await fetch(`${OKX_API_BASE}${requestPath}`, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[api/defi] OKX HTTP error (${action}):`, res.status, text);
        return Response.json(
          { error: `OKX API HTTP ${res.status}`, detail: text },
          { status: 502 },
        );
      }

      const data = await res.json();
      return Response.json(data);
    }

    // POST endpoints
    if (POST_ENDPOINTS[action]) {
      const requestPath = POST_ENDPOINTS[action];
      const bodyStr = JSON.stringify(reqBody ?? {});
      const headers = getOkxHeaders("POST", requestPath, bodyStr);

      const res = await fetch(`${OKX_API_BASE}${requestPath}`, {
        method: "POST",
        headers,
        body: bodyStr,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[api/defi] OKX HTTP error (${action}):`, res.status, text);
        return Response.json(
          { error: `OKX API HTTP ${res.status}`, detail: text },
          { status: 502 },
        );
      }

      const data = await res.json();
      return Response.json(data);
    }

    return Response.json(
      { error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (err) {
    console.error(`[api/defi] Error (${action}):`, err);
    return Response.json(
      { error: "Failed to call OKX DeFi API" },
      { status: 500 },
    );
  }
}
