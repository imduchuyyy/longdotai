/**
 * OKX Agentic Wallet — Server-side signing & broadcasting
 *
 * This module provides the same signAndBroadcast functionality as okx-api.ts
 * but runs on the server side. The session data is passed from the client
 * in the chat request body.
 *
 * Uses the OKX Agentic Wallet API directly (not through our proxy routes).
 */

import {
  decryptSessionKey,
  signEncoded,
  signEip191,
  base64ToUint8,
} from "@/lib/okx-crypto";
import type { OkxSession } from "@/lib/okx-auth-store";

const OKX_AGENTIC_BASE = "https://web3.okx.com/priapi/v5/wallet/agentic";
const XLAYER_CHAIN_INDEX = "196";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class OkxApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "OkxApiError";
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OkxApiError(
      `OKX HTTP ${res.status}: ${text || res.statusText}`,
      String(res.status),
    );
  }

  const json = await res.json();
  const codeOk =
    json.code === "0" || json.code === 0 || String(json.code) === "0";

  if (!codeOk) {
    throw new OkxApiError(
      json.msg || `OKX API error (code ${json.code})`,
      String(json.code),
    );
  }

  const item = json.data?.[0];
  if (!item) {
    throw new OkxApiError("No data returned from OKX");
  }

  return item as T;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

function jwtExpTimestamp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isJwtExpired(token: string): boolean {
  const exp = jwtExpTimestamp(token);
  if (exp === null) return true;
  return Date.now() / 1000 >= exp - 60;
}

interface AuthRefreshResponse {
  accessToken: string;
  refreshToken: string;
}

async function authRefresh(refreshToken: string): Promise<AuthRefreshResponse> {
  const res = await fetch(`${OKX_AGENTIC_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  return unwrap<AuthRefreshResponse>(res);
}

async function ensureFreshSession(session: OkxSession): Promise<OkxSession> {
  if (!isJwtExpired(session.accessToken)) {
    return session;
  }

  if (!session.refreshToken || isJwtExpired(session.refreshToken)) {
    throw new OkxApiError("Session expired — please sign in again", "SESSION_EXPIRED");
  }

  const refreshed = await authRefresh(session.refreshToken);
  return {
    ...session,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
  };
}

// ---------------------------------------------------------------------------
// Prepare transaction
// ---------------------------------------------------------------------------

interface UnsignedInfoResponse {
  unsignedTxHash: string;
  unsignHash: string;
  unsignedTx: string;
  uopHash: string;
  hash: string;
  authHashFor7702: string;
  executeErrorMsg: string;
  executeResult: unknown;
  extraData: Record<string, unknown> | null;
  signType: string;
  encoding: string;
  jitoUnsignedTx: string;
}

async function prepareTx(params: {
  accessToken: string;
  chainIndex: number;
  fromAddr: string;
  toAddr: string;
  value: string;
  sessionCert: string;
  chainPath?: string;
  contractAddr?: string;
  inputData?: string;
  gasLimit?: string;
}): Promise<UnsignedInfoResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    chainIndex: params.chainIndex,
    fromAddr: params.fromAddr,
    toAddr: params.toAddr,
    value: params.value,
    sessionCert: params.sessionCert,
  };
  if (params.chainPath) payload.chainPath = params.chainPath;
  if (params.contractAddr) payload.contractAddr = params.contractAddr;
  if (params.inputData) payload.inputData = params.inputData;
  if (params.gasLimit) payload.gasLimit = params.gasLimit;

  const res = await fetch(`${OKX_AGENTIC_BASE}/pre-transaction/unsignedInfo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  return unwrap<UnsignedInfoResponse>(res);
}

// ---------------------------------------------------------------------------
// Broadcast transaction
// ---------------------------------------------------------------------------

interface BroadcastTransactionResponse {
  pkgId: string;
  orderId: string;
  orderType: string;
  txHash: string;
}

async function broadcastTx(params: {
  accessToken: string;
  accountId: string;
  address: string;
  chainIndex: string;
  extraData: string;
}): Promise<BroadcastTransactionResponse> {
  const res = await fetch(
    `${OKX_AGENTIC_BASE}/pre-transaction/broadcast-transaction`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        accountId: params.accountId,
        address: params.address,
        chainIndex: params.chainIndex,
        extraData: params.extraData,
      }),
    },
  );

  return unwrap<BroadcastTransactionResponse>(res);
}

// ---------------------------------------------------------------------------
// High-level: sign + broadcast (server-side)
// ---------------------------------------------------------------------------

export async function serverSignAndBroadcast(params: {
  session: OkxSession;
  toAddr: string;
  value: string;
  contractAddr?: string;
  inputData?: string;
  isContractCall?: boolean;
}): Promise<{ txHash: string; session: OkxSession }> {
  const session = await ensureFreshSession(params.session);
  const chainIndex = parseInt(XLAYER_CHAIN_INDEX, 10);
  const chainIndexStr = XLAYER_CHAIN_INDEX;

  const addrInfo =
    session.addresses.find((a) => a.chainIndex === chainIndexStr) ??
    session.addresses[0];

  if (!addrInfo) {
    throw new OkxApiError("No wallet address found for X Layer");
  }

  const fromAddr = addrInfo.address;
  const chainPath = addrInfo.chainPath ?? "";

  // Step 1: Prepare unsigned transaction
  const unsigned = await prepareTx({
    accessToken: session.accessToken,
    chainIndex,
    fromAddr,
    toAddr: params.toAddr,
    value: params.value,
    sessionCert: session.sessionCert,
    chainPath,
    contractAddr: params.contractAddr,
    inputData: params.inputData,
  });

  if (unsigned.executeResult === false) {
    const errMsg = unsigned.executeErrorMsg || "transaction simulation failed";
    throw new OkxApiError(`Transaction simulation failed: ${errMsg}`);
  }

  // Step 2: Decrypt the Ed25519 signing seed
  const signingKeyB64 = await decryptSessionKey(
    session.encryptedSessionSk,
    session.sessionKey,
  );
  const signingSeedBytes = base64ToUint8(signingKeyB64);

  // Step 3: Build msgForSign
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgForSign: Record<string, any> = {};

  if (unsigned.hash) {
    msgForSign.signature = signEip191(unsigned.hash, signingSeedBytes);
  }

  if (unsigned.authHashFor7702) {
    msgForSign.authSignatureFor7702 = signEncoded(
      unsigned.authHashFor7702,
      signingKeyB64,
      "hex",
    );
  }

  if (unsigned.unsignedTxHash) {
    const encoding = unsigned.encoding || "hex";
    const sig = signEncoded(unsigned.unsignedTxHash, signingKeyB64, encoding);
    msgForSign.unsignedTxHash = unsigned.unsignedTxHash;
    msgForSign.sessionSignature = sig;
  }

  if (unsigned.unsignedTx) {
    msgForSign.unsignedTx = unsigned.unsignedTx;
  }

  if (unsigned.jitoUnsignedTx) {
    const encoding = unsigned.encoding || "hex";
    const jitoSig = signEncoded(unsigned.jitoUnsignedTx, signingKeyB64, encoding);
    msgForSign.jitoUnsignedTx = unsigned.jitoUnsignedTx;
    msgForSign.jitoSessionSignature = jitoSig;
  }

  if (session.sessionCert) {
    msgForSign.sessionCert = session.sessionCert;
  }

  // Step 4: Build extraData
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extraDataObj: Record<string, any> = {
    ...(unsigned.extraData ?? {}),
    checkBalance: true,
    uopHash: unsigned.uopHash ?? "",
    encoding: unsigned.encoding ?? "",
    signType: unsigned.signType ?? "",
    msgForSign,
  };

  if (!params.isContractCall) {
    extraDataObj.txType = 2;
  }

  const extraDataStr = JSON.stringify(extraDataObj);

  // Step 5: Broadcast
  const broadcastResult = await broadcastTx({
    accessToken: session.accessToken,
    accountId: session.accountId,
    address: fromAddr,
    chainIndex: chainIndexStr,
    extraData: extraDataStr,
  });

  return { txHash: broadcastResult.txHash, session };
}

/**
 * Get the wallet address from a session for X Layer.
 */
export function getWalletAddress(session: OkxSession): string | null {
  const addr = session.addresses.find((a) => a.chainIndex === XLAYER_CHAIN_INDEX);
  return addr?.address ?? session.addresses[0]?.address ?? null;
}
