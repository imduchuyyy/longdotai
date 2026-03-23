/**
 * POST /api/auth/verify
 *
 * Proxy to OKX: /priapi/v5/wallet/agentic/auth/verify
 * Verifies the OTP code and returns the full session data.
 *
 * Request body: { email: string, flowId: string, otp: string, tempPubKey: string }
 * Response: Full VerifyResponse from OKX (tokens, TEE session, addresses)
 */

const OKX_BASE_URL = process.env.OKX_BASE_URL ?? "https://www.okx.com";
const API_PREFIX = "/priapi/v5/wallet/agentic";

export async function POST(req: Request) {
  const body = await req.json();
  const { email, flowId, otp, tempPubKey } = body;

  if (!email || !flowId || !otp || !tempPubKey) {
    return Response.json(
      { error: "email, flowId, otp, and tempPubKey are required" },
      { status: 400 },
    );
  }

  try {
    const url = `${OKX_BASE_URL}${API_PREFIX}/auth/verify`;
    const payload = { email, flowId, otp, tempPubKey };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[api/auth/verify] OKX error:", res.status, text);
      return Response.json(
        { error: `OKX API error: ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();

    // OKX envelope: { code: "0", msg: "", data: [VerifyResponse] }
    if (String(data.code) !== "0") {
      return Response.json(
        { error: data.msg || "OKX auth/verify failed" },
        { status: 400 },
      );
    }

    const session = data.data?.[0];
    if (!session) {
      return Response.json(
        { error: "No session data returned from OKX" },
        { status: 500 },
      );
    }

    // Return the full session data to the client
    // The client will store it in localStorage
    return Response.json({
      refreshToken: session.refreshToken,
      accessToken: session.accessToken,
      teeId: session.teeId,
      sessionCert: session.sessionCert,
      encryptedSessionSk: session.encryptedSessionSk,
      sessionKeyExpireAt: session.sessionKeyExpireAt,
      projectId: session.projectId,
      accountId: session.accountId,
      accountName: session.accountName,
      isNew: session.isNew,
      addressList: session.addressList ?? [],
    });
  } catch (err) {
    console.error("[api/auth/verify] Error:", err);
    return Response.json(
      { error: "Failed to verify OTP" },
      { status: 500 },
    );
  }
}
