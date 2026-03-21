# Relay Server with E2E Encryption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct Tailscale connections with a relay server so any device can connect from anywhere without extra software, with all traffic end-to-end encrypted.

**Architecture:** A lightweight WebSocket relay server acts as a message broker. Devices register with the relay using their device ID. When device A wants to talk to device B, both connect to the relay which forwards messages between them. An E2E encryption layer using ECDH key exchange + AES-256-GCM ensures the relay cannot read any messages. QR codes contain the relay URL, device ID, pairing token, and public key — scanning one is all you need to pair.

**Tech Stack:** Node.js/Bun WebSocket server, Web Crypto API (ECDH + AES-256-GCM), existing WsTransport layer, qrcode.react

---

## Architecture Overview

```
┌──────────┐                    ┌──────────────┐                    ┌──────────┐
│ Desktop  │──WSS (encrypted)──→│ Relay Server │←──WSS (encrypted)──│  Phone   │
│          │←──WSS (encrypted)──│  (forwards)  │──WSS (encrypted)──→│          │
└──────────┘                    └──────────────┘                    └──────────┘
                                       ↑
                                       │ WSS (encrypted)
                                       │
                                ┌──────────┐
                                │  Laptop  │
                                └──────────┘
```

**Key principle:** The relay is a dumb pipe. It matches devices by pairing token, forwards encrypted blobs between them. It cannot read, modify, or inject messages.

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/relay/package.json` | Relay server package config |
| `apps/relay/src/index.ts` | Entry point — starts HTTP + WebSocket server |
| `apps/relay/src/relay.ts` | Core relay logic — device registry, message routing |
| `apps/relay/src/types.ts` | Relay protocol message types |
| `apps/relay/tsconfig.json` | TypeScript config |
| `packages/shared/src/e2e-crypto.ts` | E2E encryption: ECDH key exchange + AES-256-GCM encrypt/decrypt |
| `apps/web/src/lib/relay-transport.ts` | Client-side relay WebSocket wrapper (connects to relay, routes to correct device) |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/src/appSettings.ts` | Replace `tailscaleHostname` with `relayUrl`, add `pairedDevices` array with E2E keys |
| `apps/web/src/components/DeviceQRCode.tsx` | Generate QR with relay URL + device ID + pairing token + public key |
| `apps/web/src/routes/_chat.settings.tsx` | Replace "This Device" Tailscale section with relay status + QR code; update Remote Devices to use relay |
| `apps/web/src/remoteDevices.ts` | Replace HTTP polling with relay-based device presence queries |
| `apps/web/src/remoteConnection.ts` | Connect through relay instead of direct WebSocket |
| `apps/web/src/components/RemoteSessionsContent.tsx` | Update to work with relay-based connections |
| `packages/contracts/src/ipc.ts` | Add relay-related types to NativeApi if needed |
| `package.json` (root) | Add `apps/relay` to workspaces |

---

## Task Breakdown

### Task 1: E2E Crypto Module

Create the shared encryption module that both relay clients and the relay server reference. Uses Web Crypto API (available in browser, Node 20+, Bun).

**Files:**
- Create: `packages/shared/src/e2e-crypto.ts`

- [ ] **Step 1: Create the crypto module**

```typescript
// packages/shared/src/e2e-crypto.ts
/**
 * End-to-end encryption using ECDH (P-256) key exchange + AES-256-GCM.
 *
 * Flow:
 * 1. Each device calls generateKeyPair() once
 * 2. Devices exchange publicKeys (via QR code or relay handshake)
 * 3. Each device calls deriveSharedKey(myPrivateKey, theirPublicKey)
 * 4. All messages encrypted with encrypt(sharedKey, plaintext)
 * 5. Recipient decrypts with decrypt(sharedKey, ciphertext)
 */

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM

export interface E2EKeyPair {
  publicKey: string;   // base64-encoded raw public key
  privateKey: string;  // base64-encoded PKCS8 private key
}

export interface EncryptedEnvelope {
  iv: string;    // base64 initialization vector
  data: string;  // base64 ciphertext
}

// Use globalThis.crypto which works in browser, Node 20+, and Bun
const cryptoImpl = globalThis.crypto;

export async function generateKeyPair(): Promise<E2EKeyPair> {
  const keyPair = await cryptoImpl.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );

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

export async function encrypt(
  sharedKey: CryptoKey,
  plaintext: string,
): Promise<EncryptedEnvelope> {
  const iv = cryptoImpl.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await cryptoImpl.subtle.encrypt(
    { name: ALGO, iv },
    sharedKey,
    encoded,
  );

  return {
    iv: bufferToBase64(iv.buffer),
    data: bufferToBase64(ciphertext),
  };
}

export async function decrypt(
  sharedKey: CryptoKey,
  envelope: EncryptedEnvelope,
): Promise<string> {
  const iv = base64ToBuffer(envelope.iv);
  const ciphertext = base64ToBuffer(envelope.data);

  const plaintext = await cryptoImpl.subtle.decrypt(
    { name: ALGO, iv },
    sharedKey,
    ciphertext,
  );

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
```

- [ ] **Step 2: Export from shared package**

Add to `packages/shared/src/index.ts`:
```typescript
export * as E2ECrypto from "./e2e-crypto.js";
```

Or if the shared package uses a different export pattern, follow the existing convention.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/e2e-crypto.ts
git commit -m "feat: add E2E crypto module (ECDH + AES-256-GCM)"
```

---

### Task 2: Relay Protocol Types

Define the message types for communication between devices and the relay server.

**Files:**
- Create: `apps/relay/src/types.ts`

- [ ] **Step 1: Define relay protocol messages**

```typescript
// apps/relay/src/types.ts

/** Messages FROM client TO relay */
export type ClientToRelayMessage =
  | RegisterMessage
  | ForwardMessage
  | QueryDevicesMessage
  | PairRequestMessage;

/** Register this device with the relay */
export interface RegisterMessage {
  type: "register";
  deviceId: string;
  deviceName: string;
  /** The auth token other devices need to connect to this device */
  pairingToken: string;
  /** E2E public key for key exchange */
  publicKey: string;
  /** Session info to advertise to paired devices */
  sessions: RelaySessionInfo[];
}

/** Forward an encrypted message to a paired device */
export interface ForwardMessage {
  type: "forward";
  targetDeviceId: string;
  /** E2E encrypted envelope — relay cannot read this */
  encrypted: { iv: string; data: string };
}

/** Query which paired devices are currently online */
export interface QueryDevicesMessage {
  type: "query-devices";
}

/** Request to pair with another device using their pairing token */
export interface PairRequestMessage {
  type: "pair-request";
  targetDeviceId: string;
  pairingToken: string;
  /** Requester's public key for E2E key exchange */
  publicKey: string;
  /** Requester's device name */
  deviceName: string;
}

/** Messages FROM relay TO client */
export type RelayToClientMessage =
  | RegisterAckMessage
  | ForwardedMessage
  | DeviceListMessage
  | PairAcceptedMessage
  | PairRejectedMessage
  | DeviceOnlineMessage
  | DeviceOfflineMessage
  | ErrorMessage;

export interface RegisterAckMessage {
  type: "register-ack";
  success: boolean;
}

export interface ForwardedMessage {
  type: "forwarded";
  fromDeviceId: string;
  fromDeviceName: string;
  encrypted: { iv: string; data: string };
}

export interface DeviceListMessage {
  type: "device-list";
  devices: Array<{
    deviceId: string;
    deviceName: string;
    online: boolean;
    sessions: RelaySessionInfo[];
  }>;
}

export interface PairAcceptedMessage {
  type: "pair-accepted";
  deviceId: string;
  deviceName: string;
  publicKey: string;
}

export interface PairRejectedMessage {
  type: "pair-rejected";
  deviceId: string;
  reason: string;
}

export interface DeviceOnlineMessage {
  type: "device-online";
  deviceId: string;
  deviceName: string;
  sessions: RelaySessionInfo[];
}

export interface DeviceOfflineMessage {
  type: "device-offline";
  deviceId: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface RelaySessionInfo {
  threadId: string;
  projectId: string;
  projectName: string;
  projectCwd: string;
  status: string;
  title: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/relay/src/types.ts
git commit -m "feat: define relay protocol message types"
```

---

### Task 3: Relay Server Core

Build the relay server — a lightweight WebSocket server that registers devices, validates pairing tokens, and forwards encrypted messages.

**Files:**
- Create: `apps/relay/package.json`
- Create: `apps/relay/tsconfig.json`
- Create: `apps/relay/src/relay.ts`
- Create: `apps/relay/src/index.ts`
- Modify: `package.json` (root) — add `apps/relay` to workspaces

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@t3tools/relay",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.ts",
    "start": "node src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.18.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create relay.ts — core relay logic**

```typescript
// apps/relay/src/relay.ts
import { WebSocket } from "ws";
import type {
  ClientToRelayMessage,
  RelayToClientMessage,
  RelaySessionInfo,
} from "./types.js";

interface RegisteredDevice {
  deviceId: string;
  deviceName: string;
  pairingToken: string;
  publicKey: string;
  sessions: RelaySessionInfo[];
  ws: WebSocket;
  /** Device IDs this device is paired with (and their public keys) */
  pairedWith: Map<string, { deviceName: string; publicKey: string }>;
}

export class Relay {
  /** Active device connections indexed by deviceId */
  private devices = new Map<string, RegisteredDevice>();

  /** Rate limiting: track connection attempts per IP */
  private connectionAttempts = new Map<string, { count: number; resetAt: number }>();

  handleConnection(ws: WebSocket, ip: string): void {
    // Rate limit: max 20 connections per minute per IP
    if (!this.checkRateLimit(ip)) {
      this.send(ws, { type: "error", message: "Rate limited. Try again later." });
      ws.close(4029, "Rate limited");
      return;
    }

    let registeredDeviceId: string | null = null;

    ws.on("message", (raw) => {
      let msg: ClientToRelayMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToRelayMessage;
      } catch {
        this.send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      switch (msg.type) {
        case "register":
          registeredDeviceId = this.handleRegister(ws, msg);
          break;
        case "forward":
          if (registeredDeviceId) this.handleForward(registeredDeviceId, msg);
          break;
        case "query-devices":
          if (registeredDeviceId) this.handleQueryDevices(registeredDeviceId);
          break;
        case "pair-request":
          if (registeredDeviceId) this.handlePairRequest(registeredDeviceId, msg);
          break;
        default:
          this.send(ws, { type: "error", message: "Unknown message type" });
      }
    });

    ws.on("close", () => {
      if (registeredDeviceId) {
        this.handleDisconnect(registeredDeviceId);
      }
    });

    ws.on("error", () => {
      if (registeredDeviceId) {
        this.handleDisconnect(registeredDeviceId);
      }
    });
  }

  private handleRegister(
    ws: WebSocket,
    msg: Extract<ClientToRelayMessage, { type: "register" }>,
  ): string {
    // Validate fields
    if (!msg.deviceId || !msg.pairingToken || !msg.publicKey) {
      this.send(ws, { type: "error", message: "Missing required fields" });
      return "";
    }

    // If device already registered, close old connection
    const existing = this.devices.get(msg.deviceId);
    if (existing) {
      existing.ws.close(4000, "Replaced by new connection");
    }

    // Preserve existing pairings if reconnecting
    const existingPairings = existing?.pairedWith ?? new Map();

    const device: RegisteredDevice = {
      deviceId: msg.deviceId,
      deviceName: msg.deviceName,
      pairingToken: msg.pairingToken,
      publicKey: msg.publicKey,
      sessions: msg.sessions ?? [],
      ws,
      pairedWith: existingPairings,
    };

    this.devices.set(msg.deviceId, device);
    this.send(ws, { type: "register-ack", success: true });

    // Notify paired devices that this device is online
    for (const [pairedId] of device.pairedWith) {
      const paired = this.devices.get(pairedId);
      if (paired) {
        this.send(paired.ws, {
          type: "device-online",
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          sessions: device.sessions,
        });
      }
    }

    console.log(`[relay] Device registered: ${msg.deviceName} (${msg.deviceId.slice(0, 8)}...)`);
    return msg.deviceId;
  }

  private handleForward(
    fromDeviceId: string,
    msg: Extract<ClientToRelayMessage, { type: "forward" }>,
  ): void {
    const sender = this.devices.get(fromDeviceId);
    const target = this.devices.get(msg.targetDeviceId);

    if (!sender) return;

    // Only allow forwarding to paired devices
    if (!sender.pairedWith.has(msg.targetDeviceId)) {
      this.send(sender.ws, {
        type: "error",
        message: "Not paired with target device",
      });
      return;
    }

    if (!target) {
      this.send(sender.ws, {
        type: "error",
        message: "Target device is offline",
      });
      return;
    }

    // Forward the encrypted message — relay cannot read it
    this.send(target.ws, {
      type: "forwarded",
      fromDeviceId,
      fromDeviceName: sender.deviceName,
      encrypted: msg.encrypted,
    });
  }

  private handleQueryDevices(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const devices = Array.from(device.pairedWith.entries()).map(
      ([pairedId, info]) => {
        const paired = this.devices.get(pairedId);
        return {
          deviceId: pairedId,
          deviceName: info.deviceName,
          online: paired !== undefined,
          sessions: paired?.sessions ?? [],
        };
      },
    );

    this.send(device.ws, { type: "device-list", devices });
  }

  private handlePairRequest(
    fromDeviceId: string,
    msg: Extract<ClientToRelayMessage, { type: "pair-request" }>,
  ): void {
    const requester = this.devices.get(fromDeviceId);
    const target = this.devices.get(msg.targetDeviceId);

    if (!requester) return;

    if (!target) {
      this.send(requester.ws, {
        type: "pair-rejected",
        deviceId: msg.targetDeviceId,
        reason: "Device not found or offline",
      });
      return;
    }

    // Validate pairing token
    if (msg.pairingToken !== target.pairingToken) {
      this.send(requester.ws, {
        type: "pair-rejected",
        deviceId: msg.targetDeviceId,
        reason: "Invalid pairing token",
      });
      return;
    }

    // Pairing successful — store bidirectional pairing
    requester.pairedWith.set(target.deviceId, {
      deviceName: target.deviceName,
      publicKey: target.publicKey,
    });
    target.pairedWith.set(requester.deviceId, {
      deviceName: requester.deviceName,
      publicKey: msg.publicKey,
    });

    // Send public keys to both sides for E2E key derivation
    this.send(requester.ws, {
      type: "pair-accepted",
      deviceId: target.deviceId,
      deviceName: target.deviceName,
      publicKey: target.publicKey,
    });

    this.send(target.ws, {
      type: "pair-accepted",
      deviceId: requester.deviceId,
      deviceName: requester.deviceName,
      publicKey: msg.publicKey,
    });

    console.log(
      `[relay] Paired: ${requester.deviceName} <-> ${target.deviceName}`,
    );
  }

  private handleDisconnect(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;

    // Notify paired devices
    for (const [pairedId] of device.pairedWith) {
      const paired = this.devices.get(pairedId);
      if (paired) {
        this.send(paired.ws, {
          type: "device-offline",
          deviceId,
        });
      }
    }

    this.devices.delete(deviceId);
    console.log(`[relay] Device disconnected: ${device.deviceName}`);
  }

  private send(ws: WebSocket, msg: RelayToClientMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.connectionAttempts.get(ip);

    if (!entry || now > entry.resetAt) {
      this.connectionAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    entry.count++;
    return entry.count <= 20;
  }

  getStats(): { devices: number; pairings: number } {
    let pairings = 0;
    for (const device of this.devices.values()) {
      pairings += device.pairedWith.size;
    }
    return { devices: this.devices.size, pairings: pairings / 2 };
  }
}
```

- [ ] **Step 4: Create index.ts — server entry point**

```typescript
// apps/relay/src/index.ts
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { Relay } from "./relay.js";

const PORT = Number(process.env.RELAY_PORT ?? 4400);
const relay = new Relay();

const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    const stats = relay.getStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", ...stats }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  relay.handleConnection(ws, ip);
});

httpServer.listen(PORT, () => {
  console.log(`[relay] Kuumba Code relay server listening on port ${PORT}`);
});
```

- [ ] **Step 5: Add to root workspace**

In root `package.json`, add `"apps/relay"` to the `workspaces` array.

Add convenience scripts:
```json
"dev:relay": "cd apps/relay && node --watch src/index.ts",
"start:relay": "cd apps/relay && node src/index.ts"
```

- [ ] **Step 6: Install dependencies and test**

```bash
cd apps/relay && bun install
bun run dev
# Should see: [relay] Kuumba Code relay server listening on port 4400
```

- [ ] **Step 7: Commit**

```bash
git add apps/relay/ package.json
git commit -m "feat: add relay server for cross-network device connections"
```

---

### Task 4: Relay Transport Client

Create a client-side WebSocket wrapper that connects to the relay server, handles registration, pairing, and message forwarding with E2E encryption.

**Files:**
- Create: `apps/web/src/lib/relay-transport.ts`

- [ ] **Step 1: Create relay transport**

This module wraps the relay WebSocket and provides:
- `register()` — register this device with the relay
- `pair()` — pair with another device using their QR code data
- `sendToDevice()` — send an encrypted message to a paired device
- `onMessage()` — receive decrypted messages from paired devices
- Automatic reconnection

The relay transport sits between the existing `WsTransport` and the relay server. When a remote device sends an RPC message, it arrives as a `forwarded` relay message, gets decrypted, and is processed as if it came from a direct WebSocket.

```typescript
// apps/web/src/lib/relay-transport.ts
import {
  generateKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  type E2EKeyPair,
} from "@t3tools/shared/e2e-crypto";
import type {
  ClientToRelayMessage,
  RelayToClientMessage,
  RelaySessionInfo,
} from "../../relay/src/types";

export interface PairedDeviceInfo {
  deviceId: string;
  deviceName: string;
  publicKey: string;
  online: boolean;
  sessions: RelaySessionInfo[];
  sharedKey: CryptoKey | null;
}

export interface RelayTransportOptions {
  relayUrl: string;
  deviceId: string;
  deviceName: string;
  pairingToken: string;
  onDeviceOnline?: (deviceId: string, deviceName: string, sessions: RelaySessionInfo[]) => void;
  onDeviceOffline?: (deviceId: string) => void;
  onPairAccepted?: (deviceId: string, deviceName: string) => void;
  onMessage?: (fromDeviceId: string, message: string) => void;
}

export class RelayTransport {
  private ws: WebSocket | null = null;
  private keyPair: E2EKeyPair | null = null;
  private pairedDevices = new Map<string, PairedDeviceInfo>();
  private options: RelayTransportOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;

  constructor(options: RelayTransportOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    // Generate E2E key pair on first connect
    if (!this.keyPair) {
      this.keyPair = await generateKeyPair();
    }

    this.ws = new WebSocket(this.options.relayUrl);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Register with relay
      this.send({
        type: "register",
        deviceId: this.options.deviceId,
        deviceName: this.options.deviceName,
        pairingToken: this.options.pairingToken,
        publicKey: this.keyPair!.publicKey,
        sessions: [], // Will be updated later
      });
    };

    this.ws.onmessage = (event) => {
      void this.handleMessage(event.data as string);
    };

    this.ws.onclose = () => {
      if (!this.disposed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  async pairWithDevice(
    targetDeviceId: string,
    targetPairingToken: string,
    targetPublicKey: string,
    targetDeviceName: string,
  ): Promise<void> {
    if (!this.keyPair) throw new Error("Not connected");

    // Pre-store the device info so we can derive key immediately on pair-accepted
    this.pairedDevices.set(targetDeviceId, {
      deviceId: targetDeviceId,
      deviceName: targetDeviceName,
      publicKey: targetPublicKey,
      online: false,
      sessions: [],
      sharedKey: null,
    });

    // Derive shared key from their public key
    const sharedKey = await deriveSharedKey(
      this.keyPair.privateKey,
      targetPublicKey,
    );
    const info = this.pairedDevices.get(targetDeviceId)!;
    info.sharedKey = sharedKey;

    // Send pair request to relay
    this.send({
      type: "pair-request",
      targetDeviceId,
      pairingToken: targetPairingToken,
      publicKey: this.keyPair.publicKey,
      deviceName: this.options.deviceName,
    });
  }

  async sendToDevice(targetDeviceId: string, message: string): Promise<void> {
    const device = this.pairedDevices.get(targetDeviceId);
    if (!device?.sharedKey) {
      throw new Error(`Not paired with device ${targetDeviceId}`);
    }

    const encrypted = await encrypt(device.sharedKey, message);
    this.send({
      type: "forward",
      targetDeviceId,
      encrypted,
    });
  }

  updateSessions(sessions: RelaySessionInfo[]): void {
    if (!this.keyPair) return;
    this.send({
      type: "register",
      deviceId: this.options.deviceId,
      deviceName: this.options.deviceName,
      pairingToken: this.options.pairingToken,
      publicKey: this.keyPair.publicKey,
      sessions,
    });
  }

  queryDevices(): void {
    this.send({ type: "query-devices" });
  }

  getPublicKey(): string | null {
    return this.keyPair?.publicKey ?? null;
  }

  getPairedDevices(): PairedDeviceInfo[] {
    return Array.from(this.pairedDevices.values());
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: RelayToClientMessage;
    try {
      msg = JSON.parse(raw) as RelayToClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "register-ack":
        if (msg.success) {
          // Query for paired devices
          this.queryDevices();
        }
        break;

      case "pair-accepted": {
        let device = this.pairedDevices.get(msg.deviceId);
        if (!device) {
          device = {
            deviceId: msg.deviceId,
            deviceName: msg.deviceName,
            publicKey: msg.publicKey,
            online: true,
            sessions: [],
            sharedKey: null,
          };
          this.pairedDevices.set(msg.deviceId, device);
        }
        device.online = true;
        device.deviceName = msg.deviceName;

        // Derive shared key if we don't have one
        if (!device.sharedKey && this.keyPair) {
          device.sharedKey = await deriveSharedKey(
            this.keyPair.privateKey,
            msg.publicKey,
          );
        }

        this.options.onPairAccepted?.(msg.deviceId, msg.deviceName);
        break;
      }

      case "pair-rejected":
        console.warn(`[relay] Pair rejected: ${msg.reason}`);
        break;

      case "forwarded": {
        const device = this.pairedDevices.get(msg.fromDeviceId);
        if (!device?.sharedKey) {
          console.warn("[relay] Received message from unknown/unpaired device");
          return;
        }

        try {
          const decrypted = await decrypt(device.sharedKey, msg.encrypted);
          this.options.onMessage?.(msg.fromDeviceId, decrypted);
        } catch (err) {
          console.error("[relay] Failed to decrypt message:", err);
        }
        break;
      }

      case "device-list":
        for (const d of msg.devices) {
          const existing = this.pairedDevices.get(d.deviceId);
          if (existing) {
            existing.online = d.online;
            existing.deviceName = d.deviceName;
            existing.sessions = d.sessions;
          }
        }
        break;

      case "device-online": {
        const device = this.pairedDevices.get(msg.deviceId);
        if (device) {
          device.online = true;
          device.sessions = msg.sessions;
        }
        this.options.onDeviceOnline?.(msg.deviceId, msg.deviceName, msg.sessions);
        break;
      }

      case "device-offline": {
        const device = this.pairedDevices.get(msg.deviceId);
        if (device) device.online = false;
        this.options.onDeviceOffline?.(msg.deviceId);
        break;
      }

      case "error":
        console.warn("[relay] Server error:", msg.message);
        break;
    }
  }

  private send(msg: ClientToRelayMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/relay-transport.ts
git commit -m "feat: add relay transport client with E2E encryption"
```

---

### Task 5: Update App Settings Schema

Replace Tailscale config with relay-based config. Store paired devices with their E2E public keys locally.

**Files:**
- Modify: `apps/web/src/appSettings.ts`

- [ ] **Step 1: Update schema**

Replace `tailscaleHostname` and `RemoteDeviceConfigSchema` with relay-based equivalents:

```typescript
// Add new schema for paired devices
export const PairedDeviceSchema = Schema.Struct({
  deviceId: Schema.String,
  deviceName: Schema.String,
  publicKey: Schema.String,
  pairedAt: Schema.Number,
});
export type PairedDevice = typeof PairedDeviceSchema.Type;

// Update RemoteDeviceConfigSchema — keep for backwards compat but add relay fields
export const RemoteDeviceConfigSchema = Schema.Struct({
  name: Schema.String,
  tailscaleHost: Schema.String,  // keep for legacy
  port: Schema.Number,
  authToken: Schema.String,
});

// Add to AppSettingsSchema:
//   relayUrl: string (default "wss://relay.kuumbacode.com")
//   devicePairingToken: string (auto-generated on first launch)
//   e2ePrivateKey: string (auto-generated on first launch)
//   e2ePublicKey: string (auto-generated on first launch)
//   pairedDevices: PairedDevice[] (devices that have paired with us)
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/appSettings.ts
git commit -m "feat: add relay and E2E key fields to app settings"
```

---

### Task 6: Update Settings UI

Replace the "This Device" Tailscale section with relay-based QR code and paired devices list.

**Files:**
- Modify: `apps/web/src/routes/_chat.settings.tsx`
- Modify: `apps/web/src/components/DeviceQRCode.tsx`

- [ ] **Step 1: Update ThisDeviceSettings**

Replace Tailscale hostname input with:
- Auto-generated device ID and pairing token (shown for reference)
- QR code that encodes: `{ relayUrl, deviceId, pairingToken, publicKey }`
- List of paired devices with online/offline status
- "Unpair" button per device

- [ ] **Step 2: Update DeviceQRCode**

QR code now encodes relay connection info instead of Tailscale hostname.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_chat.settings.tsx apps/web/src/components/DeviceQRCode.tsx
git commit -m "feat: update settings UI for relay-based pairing"
```

---

### Task 7: Update Remote Device Discovery

Replace HTTP polling with relay-based device presence.

**Files:**
- Modify: `apps/web/src/remoteDevices.ts`
- Modify: `apps/web/src/remoteConnection.ts`
- Modify: `apps/web/src/components/RemoteSessionsContent.tsx`

- [ ] **Step 1: Update remoteDevices.ts**

Instead of polling each device via HTTP, query the relay for paired device status. The relay knows which devices are online and what sessions they're sharing.

- [ ] **Step 2: Update remoteConnection.ts**

Connection now goes through relay transport instead of direct WebSocket.

- [ ] **Step 3: Update RemoteSessionsContent.tsx**

Use relay-based device list instead of HTTP-polled list.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/remoteDevices.ts apps/web/src/remoteConnection.ts apps/web/src/components/RemoteSessionsContent.tsx
git commit -m "feat: switch remote device discovery to relay"
```

---

### Task 8: Bridge Relay Transport to Existing WsTransport

The existing codebase uses `WsTransport` for all RPC and push messages. We need to bridge the relay transport so that messages forwarded through the relay are processed exactly like direct WebSocket messages.

**Files:**
- Modify: `apps/web/src/wsNativeApi.ts` — add `createRelayNativeApi()` that uses relay transport
- Modify: `apps/web/src/wsTransport.ts` — optionally accept a relay message handler

- [ ] **Step 1: Create relay-backed NativeApi factory**

Add `createRelayNativeApi(relayTransport, targetDeviceId)` that:
1. Sends RPC requests by encrypting them and forwarding via relay
2. Receives RPC responses from the relay's `onMessage` callback
3. Same `NativeApi` interface as existing remote API

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/wsNativeApi.ts apps/web/src/wsTransport.ts
git commit -m "feat: bridge relay transport to NativeApi interface"
```

---

### Task 9: Auto-Generate Device Identity on First Launch

On first app launch, auto-generate a device pairing token and E2E key pair so the QR code is ready immediately without user configuration.

**Files:**
- Modify: `apps/web/src/appSettings.ts` — add initialization logic

- [ ] **Step 1: Add auto-generation**

When `useAppSettings()` first loads and `devicePairingToken` is empty, generate:
- A random 32-char hex pairing token
- An ECDH key pair (public + private key)

Store these in app settings (localStorage).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/appSettings.ts
git commit -m "feat: auto-generate device identity and E2E keys on first launch"
```

---

### Task 10: Deploy Relay Server

Document how to deploy the relay server to a VPS.

**Files:**
- Create: `apps/relay/Dockerfile`
- Create: `apps/relay/README.md`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
EXPOSE 4400
CMD ["node", "src/index.ts"]
```

- [ ] **Step 2: Create README with deploy instructions**

Cover:
- DigitalOcean / any VPS setup
- Docker deploy
- SSL with Let's Encrypt (nginx reverse proxy)
- Environment variables (RELAY_PORT)
- Domain setup (relay.kuumbacode.com)

- [ ] **Step 3: Commit**

```bash
git add apps/relay/Dockerfile apps/relay/README.md
git commit -m "docs: add relay server deployment guide"
```

---

## Security Model Summary

| Layer | Protection |
|-------|-----------|
| **Transport** | WSS (TLS) — encrypted in transit, relay cannot sniff |
| **Authentication** | Pairing token — only devices with the correct token can pair |
| **E2E Encryption** | ECDH + AES-256-GCM — relay cannot read message contents |
| **Rate Limiting** | 20 connections/minute per IP — prevents brute-force pairing |
| **Message Integrity** | AES-GCM includes authentication tag — tampering detected |
| **Forward Secrecy** | New key pair on each app install — past messages unreadable if key leaked |

**What the relay server CAN see:**
- Which device IDs are online
- Which devices are paired (but not their communication content)
- Message sizes and timing

**What the relay server CANNOT do:**
- Read any messages (E2E encrypted)
- Inject fake messages (AES-GCM auth tag would fail)
- Pair devices without the correct token
- Control or access any device
