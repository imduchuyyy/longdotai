/**
 * POST /api/auth/init
 *
 * Proxy to OKX: /priapi/v5/wallet/agentic/auth/init
 * Sends the user's email to trigger an OTP code.
 *
 * Request body: { email: string, locale?: string }
 * Response: { flowId: string }
 */

const OKX_BASE_URL = process.env.OKX_BASE_URL ?? "https://www.okx.com";
const API_PREFIX = "/priapi/v5/wallet/agentic";

export async function POST(req: Request) {
  const body = await req.json();
  const { email, locale } = body;

  if (!email || typeof email !== "string") {
    return Response.json({ error: "email is required" }, { status: 400 });
  }

  try {
    const url = `${OKX_BASE_URL}${API_PREFIX}/auth/init`;
    const payload: Record<string, string> = { email };
    if (locale) payload.locale = locale;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[api/auth/init] OKX error:", res.status, text);
      return Response.json(
        { error: `OKX API error: ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();

    // OKX envelope: { code: "0", msg: "", data: [{ flowId }] }
    if (String(data.code) !== "0") {
      return Response.json(
        { error: data.msg || "OKX auth/init failed" },
        { status: 400 },
      );
    }

    const flowId = data.data?.[0]?.flowId;
    if (!flowId) {
      return Response.json(
        { error: "No flowId returned from OKX" },
        { status: 500 },
      );
    }

    return Response.json({ flowId });
  } catch (err) {
    console.error("[api/auth/init] Error:", err);
    return Response.json(
      { error: "Failed to initiate auth" },
      { status: 500 },
    );
  }
}
