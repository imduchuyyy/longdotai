/**
 * OKX Auth Store — localStorage wrapper for OKX session credentials
 *
 * All OKX Agentic Wallet session data is stored client-side in localStorage.
 * This mirrors the wallet_store.rs pattern from the CLI:
 * - Session data (tokens, TEE info, keypair)
 * - Account data (email, addresses, project/account IDs)
 *
 * The store provides typed getters/setters and handles serialization.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletAddress {
  address: string;
  chainIndex: string;
  chainName: string;
  addressType?: string;
  chainPath?: string;
}

export interface OkxSession {
  /** User's email address */
  email: string;
  /** OKX access token (Bearer auth) */
  accessToken: string;
  /** OKX refresh token */
  refreshToken: string;
  /** TEE session certificate */
  sessionCert: string;
  /** Base64-encoded HPKE-encrypted Ed25519 signing key */
  encryptedSessionSk: string;
  /** Base64-encoded X25519 private key (used to decrypt encryptedSessionSk) */
  sessionKey: string;
  /** TEE ID */
  teeId: string;
  /** ISO timestamp when session key expires */
  sessionKeyExpireAt: string;
  /** OKX project ID */
  projectId: string;
  /** OKX account ID */
  accountId: string;
  /** Account name */
  accountName: string;
  /** Whether this is a new account (first login) */
  isNew: boolean;
  /** All chain addresses for this account */
  addresses: WalletAddress[];
}

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

const STORAGE_KEY = "okx_session";

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Save the full OKX session to localStorage.
 */
export function saveSession(session: OkxSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/**
 * Load the OKX session from localStorage.
 * Returns null if no session exists or if data is invalid.
 */
export function loadSession(): OkxSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as OkxSession;
    // Basic validation
    if (!session.email || !session.accessToken || !session.accountId) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Clear the OKX session from localStorage (logout).
 */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Check if there is a stored session.
 */
export function hasSession(): boolean {
  return loadSession() !== null;
}

/**
 * Check if the stored session's access token is likely expired.
 * Adds a 60-second buffer before actual expiry.
 */
export function isSessionExpired(session?: OkxSession | null): boolean {
  const s = session ?? loadSession();
  if (!s?.sessionKeyExpireAt) return true;
  const expiresAt = new Date(s.sessionKeyExpireAt).getTime();
  return Date.now() > expiresAt - 60_000;
}

/**
 * Update just the tokens in the stored session (after a refresh).
 */
export function updateTokens(accessToken: string, refreshToken: string): void {
  const session = loadSession();
  if (!session) return;
  session.accessToken = accessToken;
  session.refreshToken = refreshToken;
  saveSession(session);
}

/**
 * Get the primary address for a specific chain (defaults to X Layer = "196").
 */
export function getAddress(chainIndex: string = "196"): string | null {
  const session = loadSession();
  if (!session) return null;
  const addr = session.addresses.find((a) => a.chainIndex === chainIndex);
  return addr?.address ?? session.addresses[0]?.address ?? null;
}

/**
 * Get the user's email from the stored session.
 */
export function getEmail(): string | null {
  const session = loadSession();
  return session?.email ?? null;
}
