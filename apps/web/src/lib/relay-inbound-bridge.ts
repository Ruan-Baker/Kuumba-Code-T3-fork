/**
 * RelayInboundBridge — proxies inbound RPC requests from paired mobile
 * devices (via the relay) to the local desktop server, and forwards
 * responses and push events back.
 *
 * Flow:
 *   Mobile → relay → RelayTransport decrypts → this bridge
 *     → raw WebSocket to local server → server responds
 *     → this bridge → relay encrypts → mobile
 *
 *   Local server push event → this bridge → relay encrypts → all paired mobiles
 */
import type { RelayTransport } from "./relay-transport";

export class RelayInboundBridge {
  private relay: RelayTransport;
  private localWs: WebSocket | null = null;
  private localWsUrl: string;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private localConnected = false;

  /** Maps request ID → mobile device ID that sent the request */
  private pendingRequests = new Map<string, string>();

  /** Track which mobile devices are active */
  private activeMobileDevices = new Set<string>();
  private handlerCleanups = new Map<string, () => void>();

  constructor(relay: RelayTransport, localServerWsUrl: string) {
    this.relay = relay;
    this.localWsUrl = localServerWsUrl;
    this.connectLocal();
  }

  /**
   * Register a paired mobile device so it can send RPC requests through us.
   */
  addMobileDevice(deviceId: string): void {
    if (this.activeMobileDevices.has(deviceId)) return;
    this.activeMobileDevices.add(deviceId);

    const cleanup = this.relay.registerMessageHandler(deviceId, (plaintext: string) => {
      this.handleInboundMessage(deviceId, plaintext);
    });
    this.handlerCleanups.set(deviceId, cleanup);
    console.log(`[inbound-bridge] Registered handler for mobile device: ${deviceId.slice(0, 8)}...`);
  }

  /**
   * Handle a message from ANY paired device (fallback for devices not yet registered).
   * Call this from the RelayTransport's global onMessage callback.
   */
  handleGlobalMessage(fromDeviceId: string, plaintext: string): void {
    // If there's already a per-device handler, it was already called by the relay transport.
    // Only process here if no per-device handler exists.
    if (this.activeMobileDevices.has(fromDeviceId)) return;

    // Auto-register this device and process the message
    console.log(`[inbound-bridge] Auto-registering device ${fromDeviceId.slice(0, 8)}... from global onMessage`);
    this.addMobileDevice(fromDeviceId);
    this.handleInboundMessage(fromDeviceId, plaintext);
  }

  removeMobileDevice(deviceId: string): void {
    this.activeMobileDevices.delete(deviceId);
    const cleanup = this.handlerCleanups.get(deviceId);
    if (cleanup) {
      cleanup();
      this.handlerCleanups.delete(deviceId);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const cleanup of this.handlerCleanups.values()) cleanup();
    this.handlerCleanups.clear();
    this.activeMobileDevices.clear();
    this.pendingRequests.clear();
    if (this.localWs) {
      this.localWs.onclose = null;
      this.localWs.close();
      this.localWs = null;
    }
  }

  // --- Local server connection ---

  private connectLocal(): void {
    if (this.disposed) return;

    console.log(`[inbound-bridge] Connecting to local server: ${this.localWsUrl}`);
    const ws = new WebSocket(this.localWsUrl);
    this.localWs = ws;

    ws.onopen = () => {
      this.localConnected = true;
      console.log("[inbound-bridge] Connected to local server");
    };

    ws.onmessage = (event: MessageEvent) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      if (parsed.type === "push") {
        // Push event from local server → forward to all active mobile devices
        this.forwardPushToMobiles(raw);
      } else if (typeof parsed.id === "string") {
        // Response to an RPC request → route back to the mobile that sent it
        const mobileDeviceId = this.pendingRequests.get(parsed.id);
        if (mobileDeviceId) {
          this.pendingRequests.delete(parsed.id);
          console.log(`[inbound-bridge] Forwarding response id=${parsed.id} to mobile ${mobileDeviceId.slice(0, 8)}...`);
          void this.relay.sendToDevice(mobileDeviceId, raw).catch((err) => {
            console.warn(`[inbound-bridge] Failed to send response:`, err);
          });
        }
      }
    };

    ws.onclose = () => {
      this.localWs = null;
      this.localConnected = false;
      console.log("[inbound-bridge] Disconnected from local server");
      if (!this.disposed) {
        this.reconnectTimer = setTimeout(() => this.connectLocal(), 2000);
      }
    };

    ws.onerror = () => {
      // onclose fires after this
    };
  }

  // --- Message handling ---

  private handleInboundMessage(fromDeviceId: string, plaintext: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      console.warn("[inbound-bridge] Invalid JSON from mobile");
      return;
    }

    const id = parsed.id;
    const body = parsed.body as Record<string, unknown> | undefined;

    if (typeof id !== "string" || !body?._tag) {
      console.warn("[inbound-bridge] Invalid RPC envelope:", plaintext.slice(0, 120));
      return;
    }

    console.log(`[inbound-bridge] RPC from mobile: id=${id} method=${body._tag}`);

    // Handle TTS requests locally — call POST /api/tts and return base64 audio
    if (body._tag === "tts.synthesize") {
      void this.handleTTSRequest(fromDeviceId, id as string, body).catch(() => {});
      return;
    }

    // Track which mobile sent this so we can route the response back
    this.pendingRequests.set(id as string, fromDeviceId);

    // Forward to local server
    if (this.localWs?.readyState === WebSocket.OPEN) {
      this.localWs.send(plaintext);
    } else {
      console.warn(`[inbound-bridge] Local server not connected, rejecting: ${body._tag}`);
      this.pendingRequests.delete(id as string);
      const errorResponse = JSON.stringify({
        id,
        error: { message: "Desktop server is not available" },
      });
      void this.relay.sendToDevice(fromDeviceId, errorResponse).catch(() => {});
    }
  }

  private async handleTTSRequest(
    fromDeviceId: string,
    requestId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const text = body.text;
    if (typeof text !== "string" || !text.trim()) {
      const errorResponse = JSON.stringify({
        id: requestId,
        error: { message: "Missing text field" },
      });
      void this.relay.sendToDevice(fromDeviceId, errorResponse).catch(() => {});
      return;
    }

    try {
      // Resolve the local server URL
      let origin = "";
      const bridgeWsUrl = (window as any).desktopBridge?.getWsUrl?.();
      if (typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0) {
        const url = new URL(bridgeWsUrl);
        const protocol = url.protocol === "wss:" ? "https:" : "http:";
        origin = `${protocol}//${url.host}`;
      } else {
        origin = window.location.origin;
      }

      console.log(`[inbound-bridge] TTS request from mobile: "${text.slice(0, 50)}..."`);

      const res = await fetch(`${origin}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 5000) }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `TTS server error (${res.status})`);
      }

      const wavBuffer = await res.arrayBuffer();

      // Base64-encode the WAV for transmission through the relay
      const bytes = new Uint8Array(wavBuffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const base64Audio = btoa(binary);

      const response = JSON.stringify({
        id: requestId,
        result: { audio: base64Audio },
      });

      console.log(`[inbound-bridge] TTS response: ${(wavBuffer.byteLength / 1024).toFixed(0)}KB WAV → base64 to mobile`);
      void this.relay.sendToDevice(fromDeviceId, response).catch((err) => {
        console.warn("[inbound-bridge] Failed to send TTS response:", err);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "TTS synthesis failed";
      console.warn("[inbound-bridge] TTS error:", message);
      const errorResponse = JSON.stringify({
        id: requestId,
        error: { message },
      });
      void this.relay.sendToDevice(fromDeviceId, errorResponse).catch(() => {});
    }
  }

  private forwardPushToMobiles(raw: string): void {
    for (const deviceId of this.activeMobileDevices) {
      void this.relay.sendToDevice(deviceId, raw).catch((err) => {
        console.warn(`[inbound-bridge] Failed to forward push to ${deviceId.slice(0, 8)}:`, err);
      });
    }
  }
}
