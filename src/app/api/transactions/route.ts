/**
 * POST /api/transactions
 *
 * Proxies transaction requests to OKX Agentic Wallet API.
 * Client sends auth tokens (accessToken, accountId, sessionCert) from localStorage session.
 *
 * Actions:
 * - action: "prepare"   — get unsigned tx info
 * - action: "broadcast"  — broadcast a signed tx
 */

const OKX_BASE_URL = process.env.OKX_BASE_URL ?? "https://www.okx.com";
const API_PREFIX = "/priapi/v5/wallet/agentic";
const XLAYER_CHAIN_INDEX = "196";

export async function POST(req: Request) {
  const body = await req.json();
  const { action, accessToken, accountId, sessionCert } = body;

  if (!accessToken || !accountId) {
    return Response.json(
      { error: "accessToken and accountId are required" },
      { status: 400 },
    );
  }

  // -----------------------------------------------------------------------
  // Prepare unsigned transaction
  // -----------------------------------------------------------------------
  if (action === "prepare") {
    const { toAddress, value, data: txData } = body;
    if (!toAddress || !value) {
      return Response.json(
        { error: "toAddress and value are required" },
        { status: 400 },
      );
    }

    if (!sessionCert) {
      return Response.json(
        { error: "sessionCert is required for prepare" },
        { status: 400 },
      );
    }

    try {
      const payload: Record<string, unknown> = {
        accountId,
        sessionCert,
        chainIndex: XLAYER_CHAIN_INDEX,
        toAddr: toAddress,
        value,
      };
      if (txData) {
        payload.inputData = txData;
      }

      const res = await fetch(
        `${OKX_BASE_URL}${API_PREFIX}/pre-transaction/unsignedInfo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        console.error("[api/transactions] OKX prepare HTTP error:", res.status, text);
        return Response.json(
          { error: "Failed to prepare transaction" },
          { status: 502 },
        );
      }

      const data = await res.json();
      const code = typeof data.code === "string" ? data.code : String(data.code);

      if (code !== "0") {
        console.error("[api/transactions] OKX prepare API error:", data.code, data.msg);
        return Response.json(
          { error: `OKX API error: ${data.msg}` },
          { status: 502 },
        );
      }

      const txInfo = data.data?.[0];
      if (!txInfo) {
        return Response.json(
          { error: "No transaction data returned" },
          { status: 502 },
        );
      }

      return Response.json({
        unsignedTxHash: txInfo.unsignedTxHash,
        unsignedTx: txInfo.unsignedTx,
        extraData: txInfo.extraData,
      });
    } catch (err) {
      console.error("[api/transactions] prepare error:", err);
      return Response.json(
        { error: "Failed to prepare transaction" },
        { status: 500 },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Broadcast signed transaction
  // -----------------------------------------------------------------------
  if (action === "broadcast") {
    const { unsignedTxHash, signedTx, chainIndex } = body;
    if (!unsignedTxHash || !signedTx) {
      return Response.json(
        { error: "unsignedTxHash and signedTx are required" },
        { status: 400 },
      );
    }

    try {
      const res = await fetch(
        `${OKX_BASE_URL}${API_PREFIX}/pre-transaction/broadcast-transaction`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            accountId,
            chainIndex: chainIndex ?? XLAYER_CHAIN_INDEX,
            unsignedTxHash,
            signedTx,
          }),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        console.error("[api/transactions] OKX broadcast HTTP error:", res.status, text);
        return Response.json(
          { error: "Failed to broadcast transaction" },
          { status: 502 },
        );
      }

      const data = await res.json();
      const code = typeof data.code === "string" ? data.code : String(data.code);

      if (code !== "0") {
        console.error("[api/transactions] OKX broadcast API error:", data.code, data.msg);
        return Response.json(
          { error: `OKX API error: ${data.msg}` },
          { status: 502 },
        );
      }

      const result = data.data?.[0];
      if (!result) {
        return Response.json(
          { error: "No broadcast result returned" },
          { status: 502 },
        );
      }

      return Response.json({
        txHash: result.txHash,
        status: result.status,
      });
    } catch (err) {
      console.error("[api/transactions] broadcast error:", err);
      return Response.json(
        { error: "Failed to broadcast transaction" },
        { status: 500 },
      );
    }
  }

  return Response.json(
    { error: 'Invalid action. Use "prepare" or "broadcast".' },
    { status: 400 },
  );
}
