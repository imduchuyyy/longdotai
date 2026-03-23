/**
 * OKX Agentic Wallet — Browser-side Crypto
 *
 * Implements the cryptographic primitives needed for the email OTP auth flow:
 * 1. X25519 keypair generation (for HPKE key exchange with OKX TEE)
 * 2. HPKE decryption of the encrypted session signing key
 * 3. Ed25519 signing of transaction hashes
 *
 * Uses @noble/curves for X25519/Ed25519, and hpke-js for HPKE decryption.
 * All operations run in the browser — no server-side crypto needed.
 *
 * References:
 * - okx/onchainos-skills/cli/src/crypto.rs
 * - HPKE Suite: DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM
 * - Info string: b"okx-tee-sign"
 */

import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { CipherSuite, Kem, Kdf, Aead } from "hpke-js";

// ---------------------------------------------------------------------------
// X25519 Keypair Generation
// ---------------------------------------------------------------------------

export interface X25519KeyPair {
  /** Base64-encoded 32-byte public key (sent to OKX as tempPubKey) */
  publicKeyBase64: string;
  /** Base64-encoded 32-byte private key (stored in localStorage) */
  privateKeyBase64: string;
}

/**
 * Generate an X25519 keypair for the HPKE key exchange.
 * The public key is sent to OKX during auth/verify.
 * The private key is stored locally to decrypt the encryptedSessionSk later.
 */
export function generateX25519KeyPair(): X25519KeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(secretKey);

  return {
    publicKeyBase64: uint8ToBase64(publicKey),
    privateKeyBase64: uint8ToBase64(secretKey),
  };
}

// ---------------------------------------------------------------------------
// HPKE Decryption — Decrypt the Ed25519 Session Signing Key
// ---------------------------------------------------------------------------

/**
 * Decrypt the encryptedSessionSk from OKX to recover the Ed25519 signing seed.
 *
 * The encrypted payload format (from crypto.rs):
 *   enc (32 bytes) || ciphertext (plaintext_len + 16 bytes AES-GCM tag)
 *
 * HPKE Suite: DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM
 * Info: b"okx-tee-sign"
 *
 * @param encryptedSessionSkBase64 - Base64-encoded encrypted session key from OKX
 * @param x25519PrivateKeyBase64 - Base64-encoded X25519 private key (our session key)
 * @returns Base64-encoded 32-byte Ed25519 signing seed
 */
export async function decryptSessionKey(
  encryptedSessionSkBase64: string,
  x25519PrivateKeyBase64: string
): Promise<string> {
  const encryptedBytes = base64ToUint8(encryptedSessionSkBase64);
  const secretKeyBytes = base64ToUint8(x25519PrivateKeyBase64);

  // Split: first 32 bytes = enc (ephemeral public key), rest = ciphertext
  const enc = encryptedBytes.slice(0, 32);
  const ciphertext = encryptedBytes.slice(32);

  // Derive the public key from our secret key
  const publicKeyBytes = x25519.getPublicKey(secretKeyBytes);

  // Set up the HPKE suite: DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM
  const suite = new CipherSuite({
    kem: Kem.DhkemX25519HkdfSha256,
    kdf: Kdf.HkdfSha256,
    aead: Aead.Aes256Gcm,
  });

  // Import our keypair as the recipient
  // hpke-js importKey expects ArrayBuffer
  const privateKey = await suite.importKey(
    "raw",
    secretKeyBytes.buffer as ArrayBuffer,
    false,
  );
  const publicKey = await suite.importKey(
    "raw",
    publicKeyBytes.buffer as ArrayBuffer,
    true,
  );

  const info = new TextEncoder().encode("okx-tee-sign");

  // Open (decrypt) in base mode
  const recipient = await suite.createRecipientContext({
    recipientKey: { privateKey, publicKey },
    enc: enc.buffer as ArrayBuffer,
    info,
  });

  const plaintext = await recipient.open(ciphertext);
  return uint8ToBase64(new Uint8Array(plaintext));
}

// ---------------------------------------------------------------------------
// Ed25519 Signing
// ---------------------------------------------------------------------------

/**
 * Sign a message (typically an unsigned transaction hash) with the Ed25519 signing key.
 *
 * @param messageHex - Hex-encoded message to sign (e.g. unsignedTxHash, without 0x prefix)
 * @param signingKeyBase64 - Base64-encoded 32-byte Ed25519 seed (from decryptSessionKey)
 * @returns Hex-encoded 64-byte Ed25519 signature
 */
export function signWithEd25519(
  messageHex: string,
  signingKeyBase64: string
): string {
  const seed = base64ToUint8(signingKeyBase64);
  const message = hexToUint8(messageHex);

  // ed25519.sign expects the 32-byte seed (private key)
  const signature = ed25519.sign(message, seed);
  return uint8ToHex(signature);
}

// ---------------------------------------------------------------------------
// Encoding Utilities
// ---------------------------------------------------------------------------

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}
