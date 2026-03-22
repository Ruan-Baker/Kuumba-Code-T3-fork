/**
 * Simple encryption for storing API keys in localStorage.
 * Uses Web Crypto API with a device-derived AES-GCM key.
 */

const SALT = "kuumba-mobile-key-v1";
const KEY_NAME = "kuumba-openrouter-key";

async function deriveKey(): Promise<CryptoKey> {
  // Use a stable device fingerprint as the passphrase
  const passphrase = `${SALT}-${navigator.userAgent}-${screen.width}x${screen.height}`;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(SALT), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptAndStore(apiKey: string): Promise<void> {
  if (!apiKey) {
    localStorage.removeItem(KEY_NAME);
    return;
  }
  const key = await deriveKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(apiKey),
  );
  // Store iv + ciphertext as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  localStorage.setItem(KEY_NAME, btoa(String.fromCharCode(...combined)));
}

export async function loadStoredKey(): Promise<string | null> {
  const stored = localStorage.getItem(KEY_NAME);
  if (!stored) return null;

  try {
    const key = await deriveKey();
    const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export function hasStoredKey(): boolean {
  return localStorage.getItem(KEY_NAME) !== null;
}
