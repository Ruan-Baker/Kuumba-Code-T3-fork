// packages/shared/src/e2e-crypto.ts
const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

export interface E2EKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface EncryptedEnvelope {
  iv: string;
  data: string;
}

const cryptoImpl = globalThis.crypto;

export async function generateKeyPair(): Promise<E2EKeyPair> {
  const keyPair = await cryptoImpl.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
  ]);
  const publicKeyRaw = await cryptoImpl.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyPkcs8 = await cryptoImpl.subtle.exportKey("pkcs8", keyPair.privateKey);
  return {
    publicKey: bufferToBase64(publicKeyRaw),
    privateKey: bufferToBase64(privateKeyPkcs8),
  };
}

export async function deriveSharedKey(
  myPrivateKeyBase64: string,
  theirPublicKeyBase64: string,
): Promise<CryptoKey> {
  const privateKey = await cryptoImpl.subtle.importKey(
    "pkcs8",
    base64ToBuffer(myPrivateKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"],
  );
  const publicKey = await cryptoImpl.subtle.importKey(
    "raw",
    base64ToBuffer(theirPublicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  return cryptoImpl.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(sharedKey: CryptoKey, plaintext: string): Promise<EncryptedEnvelope> {
  const iv = cryptoImpl.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await cryptoImpl.subtle.encrypt({ name: ALGO, iv }, sharedKey, encoded);
  return {
    iv: bufferToBase64(iv.buffer),
    data: bufferToBase64(ciphertext),
  };
}

export async function decrypt(sharedKey: CryptoKey, envelope: EncryptedEnvelope): Promise<string> {
  const iv = base64ToBuffer(envelope.iv);
  const ciphertext = base64ToBuffer(envelope.data);
  const plaintext = await cryptoImpl.subtle.decrypt({ name: ALGO, iv }, sharedKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
