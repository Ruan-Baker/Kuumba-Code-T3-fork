/**
 * E2E crypto polyfill for non-secure contexts (HTTP).
 * Uses @noble/curves for ECDH and @noble/hashes for AES-GCM equivalent.
 * Output format is compatible with @t3tools/shared/e2e-crypto.
 *
 * When crypto.subtle IS available (HTTPS / Capacitor), delegates to the
 * real implementation. Falls back to noble only on HTTP dev.
 */
import { p256 } from "@noble/curves/nist.js";
import { gcm } from "@noble/ciphers/aes.js";

export interface E2EKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface EncryptedEnvelope {
  iv: string;
  data: string;
}

function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const isSecureContext =
  typeof globalThis.crypto !== "undefined" &&
  typeof globalThis.crypto.subtle !== "undefined" &&
  typeof globalThis.crypto.subtle.generateKey === "function";

// --- Web Crypto (secure context) ---

async function webGenerateKeyPair(): Promise<E2EKeyPair> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  return {
    publicKey: bufferToBase64(pub),
    privateKey: bufferToBase64(priv),
  };
}

async function webDeriveSharedKey(
  myPrivateKeyBase64: string,
  theirPublicKeyBase64: string,
): Promise<CryptoKey> {
  const privBuf = base64ToBuffer(myPrivateKeyBase64);
  const pubBuf = base64ToBuffer(theirPublicKeyBase64);
  const priv = await crypto.subtle.importKey(
    "pkcs8",
    privBuf.buffer as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"],
  );
  const pub = await crypto.subtle.importKey(
    "raw",
    pubBuf.buffer as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: pub },
    priv,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function webEncrypt(key: CryptoKey, plaintext: string): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  ));
  return { iv: bufferToBase64(iv), data: bufferToBase64(ct) };
}

async function webDecrypt(key: CryptoKey, envelope: EncryptedEnvelope): Promise<string> {
  const ivBuf = base64ToBuffer(envelope.iv);
  const ctBuf = base64ToBuffer(envelope.data);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuf.buffer as ArrayBuffer },
    key,
    ctBuf.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(pt);
}

// --- Noble fallback (HTTP / insecure context) ---

/** Noble uses raw private key bytes (32), not PKCS8. We store as base64. */
function nobleGenerateKeyPair(): E2EKeyPair {
  const privBytes = p256.utils.randomSecretKey();
  const pubPoint = p256.getPublicKey(privBytes, false); // uncompressed 65 bytes
  return {
    publicKey: bufferToBase64(pubPoint),
    privateKey: bufferToBase64(privBytes),
  };
}

/**
 * Noble shared key: ECDH shared secret → take X coordinate (32 bytes) as AES key.
 * This matches Web Crypto's deriveKey behavior for ECDH → AES-GCM.
 */
function nobleDeriveRawKey(myPrivBase64: string, theirPubBase64: string): Uint8Array {
  const priv = base64ToBuffer(myPrivBase64);
  const pub = base64ToBuffer(theirPubBase64);
  const shared = p256.getSharedSecret(priv, pub, false); // 65 bytes: 0x04 || X (32) || Y (32)
  // Web Crypto deriveKey for ECDH uses the raw X coordinate as the shared secret
  // and then derives AES key via a KDF. However, the @t3tools/shared/e2e-crypto
  // uses deriveKey directly which internally uses the ECDH shared bits.
  // The X coordinate (bytes 1-33) is what Web Crypto uses as input.
  return shared.slice(1, 33);
}

function nobleEncrypt(rawKey: Uint8Array, plaintext: string): EncryptedEnvelope {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const aes = gcm(rawKey, iv);
  const ct = aes.encrypt(new TextEncoder().encode(plaintext));
  return { iv: bufferToBase64(iv), data: bufferToBase64(ct) };
}

function nobleDecrypt(rawKey: Uint8Array, envelope: EncryptedEnvelope): string {
  const iv = base64ToBuffer(envelope.iv);
  const ct = base64ToBuffer(envelope.data);
  const aes = gcm(rawKey, iv);
  const pt = aes.decrypt(ct);
  return new TextDecoder().decode(pt);
}

// --- Unified interface ---

/**
 * Key handle — wraps either a CryptoKey (Web Crypto) or raw bytes (Noble).
 * Only used internally; the relay transport treats it as opaque.
 */
export type SharedKey = CryptoKey | { __noble: true; raw: Uint8Array };

function isNobleKey(key: SharedKey): key is { __noble: true; raw: Uint8Array } {
  return typeof key === "object" && key !== null && "__noble" in key;
}

export async function generateKeyPair(): Promise<E2EKeyPair> {
  if (isSecureContext) return webGenerateKeyPair();
  return nobleGenerateKeyPair();
}

export async function deriveSharedKey(
  myPrivateKeyBase64: string,
  theirPublicKeyBase64: string,
): Promise<SharedKey> {
  if (isSecureContext) {
    return webDeriveSharedKey(myPrivateKeyBase64, theirPublicKeyBase64);
  }
  const raw = nobleDeriveRawKey(myPrivateKeyBase64, theirPublicKeyBase64);
  return { __noble: true, raw } as SharedKey;
}

export async function encrypt(
  key: SharedKey,
  plaintext: string,
): Promise<EncryptedEnvelope> {
  if (isNobleKey(key)) return nobleEncrypt(key.raw, plaintext);
  return webEncrypt(key as CryptoKey, plaintext);
}

export async function decrypt(
  key: SharedKey,
  envelope: EncryptedEnvelope,
): Promise<string> {
  if (isNobleKey(key)) return nobleDecrypt(key.raw, envelope);
  return webDecrypt(key as CryptoKey, envelope);
}
