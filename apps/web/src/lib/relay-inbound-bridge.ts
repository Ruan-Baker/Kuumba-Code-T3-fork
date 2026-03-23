/**
 * RelayInboundBridge — proxies inbound RPC requests from paired mobile
 * devices (via the relay) to the local desktop server, and forwards
 * responses and push events back.
 *
 * Uses the browser's fetch API for RPC (POST to local server) instead
 * of a separate WebSocket, avoiding connection management issues.
 * Push events are forwarded from the existing WsTransport subscription.
 */
import type { RelayTransport } from "./relay-transport";

export class RelayInboundBridge {
  private relay: RelayTransport;
  private serverOrigin: string;
  private disposed = false;

  /** Track active mobile devices */
  private activeMobileDevices = new Set<string>();
  private handlerCleanups = new Map<string, () => void>();

  /** Current composer state — updated by desktop, read by mobile */
  private composerState: {
    interactionMode: string;
    runtimeMode: string;
    model: string;
    reasoningLevel: string;
  } = {
    interactionMode: "default",
    runtimeMode: "full-access",
    model: "claude-sonnet-4-6",
    reasoningLevel: "high",
  };

  /** Callback when mobile sends composer.setState */
  onComposerStateChanged:
    | ((data: {
        interactionMode?: string;
        runtimeMode?: string;
        model?: string;
        reasoningLevel?: string;
      }) => void)
    | null = null;

  /** Callback when mobile sends notes.sync */
  onNotesSyncReceived:
    | ((data: { cwd: string; editorState: string; timestamp: number }) => void)
    | null = null;

  /** Callback to get live composer state from the desktop's ChatView */
  getComposerStateLive:
    | (() => {
        interactionMode: string;
        runtimeMode: string;
        model: string;
        reasoningLevel: string;
      })
    | null = null;

  /** Local WebSocket for forwarding RPC and receiving push events */
  private localWs: WebSocket | null = null;
  private localWsUrl: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<string, string>(); // requestId → mobileDeviceId

  constructor(relay: RelayTransport, localServerWsUrl: string) {
    this.relay = relay;
    this.localWsUrl = localServerWsUrl;

    // Derive HTTP origin from WS URL for TTS requests
    try {
      const url = new URL(localServerWsUrl);
      const protocol = url.protocol === "wss:" ? "https:" : "http:";
      this.serverOrigin = `${protocol}//${url.host}`;
    } catch {
      this.serverOrigin = "http://127.0.0.1:3773";
    }

    this.connectLocalWs();
  }

  addMobileDevice(deviceId: string): void {
    if (this.activeMobileDevices.has(deviceId)) return;
    this.activeMobileDevices.add(deviceId);

    const cleanup = this.relay.registerMessageHandler(deviceId, (plaintext: string) => {
      this.handleInboundMessage(deviceId, plaintext);
    });
    this.handlerCleanups.set(deviceId, cleanup);
    console.log(
      `[inbound-bridge] Registered handler for mobile device: ${deviceId.slice(0, 8)}...`,
    );
  }

  handleGlobalMessage(fromDeviceId: string, plaintext: string): void {
    if (this.activeMobileDevices.has(fromDeviceId)) return;
    console.log(
      `[inbound-bridge] Auto-registering device ${fromDeviceId.slice(0, 8)}... from global onMessage`,
    );
    this.addMobileDevice(fromDeviceId);
    this.handleInboundMessage(fromDeviceId, plaintext);
  }

  /**
   * Update the composer state from the desktop side.
   * Pushes a composer.state-changed notification to all paired mobiles.
   */
  updateComposerState(state: Partial<typeof this.composerState>): void {
    Object.assign(this.composerState, state);
    // Use live state from window if available (more accurate)
    const liveState = (window as any).__composerState ?? this.composerState;
    const push = JSON.stringify({
      type: "push",
      channel: "composer.state-changed",
      data: { ...liveState },
    });
    for (const deviceId of this.activeMobileDevices) {
      void this.relay.sendToDevice(deviceId, push).catch(() => {});
    }
    // Fallback: also try all paired devices
    for (const device of this.relay.getPairedDevices()) {
      if (!this.activeMobileDevices.has(device.deviceId)) {
        void this.relay.sendToDevice(device.deviceId, push).catch(() => {});
      }
    }
  }

  /** Get current composer state (for mobile's composer.getState RPC) */
  getComposerState(): typeof this.composerState {
    return { ...this.composerState };
  }

  /**
   * Push notes update to all connected mobile devices.
   * Called by the desktop notes store after local edits.
   */
  pushNotesSync(cwd: string, editorState: string, timestamp: number): void {
    const push = JSON.stringify({
      type: "push",
      channel: "notes.sync",
      data: { cwd, editorState, timestamp },
    });
    for (const deviceId of this.activeMobileDevices) {
      void this.relay.sendToDevice(deviceId, push).catch(() => {});
    }
    for (const device of this.relay.getPairedDevices()) {
      if (!this.activeMobileDevices.has(device.deviceId)) {
        void this.relay.sendToDevice(device.deviceId, push).catch(() => {});
      }
    }
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

  // --- Local WebSocket connection ---

  private connectLocalWs(): void {
    if (this.disposed) return;

    console.log(`[inbound-bridge] Connecting to local server: ${this.localWsUrl}`);
    const ws = new WebSocket(this.localWsUrl);
    this.localWs = ws;

    ws.onopen = () => {
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
        this.forwardPushToMobiles(raw);
      } else if (typeof parsed.id === "string") {
        const mobileDeviceId = this.pendingRequests.get(parsed.id);
        if (mobileDeviceId) {
          this.pendingRequests.delete(parsed.id);
          if (parsed.error) {
            console.warn(`[inbound-bridge] Server error for id=${parsed.id}:`, parsed.error);
          } else {
            console.log(
              `[inbound-bridge] Forwarding response id=${parsed.id} to mobile ${mobileDeviceId.slice(0, 8)}...`,
            );
          }
          void this.relay.sendToDevice(mobileDeviceId, raw).catch((err) => {
            console.warn(`[inbound-bridge] Failed to send response:`, err);
          });
        }
      }
    };

    ws.onclose = () => {
      this.localWs = null;
      console.log("[inbound-bridge] Disconnected from local server");
      if (!this.disposed) {
        this.reconnectTimer = setTimeout(() => this.connectLocalWs(), 2000);
      }
    };

    ws.onerror = () => {};
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
      console.warn("[inbound-bridge] Unrecognized message:", plaintext.slice(0, 120));
      return;
    }

    console.log(`[inbound-bridge] RPC from mobile: id=${id} method=${body._tag}`);

    // Handle composer.getState — return current desktop composer state
    if (body._tag === "composer.getState") {
      // Read live state directly from window (set by ChatView useEffect)
      const liveState = (window as any).__composerState;
      const state = liveState ?? this.getComposerState();
      console.log("[inbound-bridge] composer.getState →", state);
      const response = JSON.stringify({ id, result: state });
      void this.relay.sendToDevice(fromDeviceId, response).catch(() => {});
      return;
    }

    // Handle composer.setState — remote/mobile is changing a setting
    if (body._tag === "composer.setState") {
      console.log("[inbound-bridge] composer.setState received:", JSON.stringify(body));
      const newState: Record<string, unknown> = {};
      if (typeof body.interactionMode === "string") newState.interactionMode = body.interactionMode;
      if (typeof body.runtimeMode === "string") newState.runtimeMode = body.runtimeMode;
      if (typeof body.model === "string") newState.model = body.model;
      if (typeof body.reasoningLevel === "string") newState.reasoningLevel = body.reasoningLevel;
      if (body.fastMode !== undefined) newState.fastMode = body.fastMode;
      Object.assign(this.composerState, newState);
      const handler = this.onComposerStateChanged ?? (window as any).__onComposerStateChanged;
      console.log(
        "[inbound-bridge] composer.setState newState:",
        JSON.stringify(newState),
        "handler exists:",
        !!handler,
      );
      if (handler) {
        handler(newState);
        console.log("[inbound-bridge] composer.setState handler called successfully");
      } else {
        console.warn("[inbound-bridge] NO handler for composer.setState!");
      }
      const response = JSON.stringify({ id, result: { ok: true } });
      void this.relay.sendToDevice(fromDeviceId, response).catch(() => {});
      return;
    }

    // Handle notes.sync from mobile — update desktop store
    if (body._tag === "notes.sync") {
      const data = body as { _tag: string; cwd?: string; editorState?: string; timestamp?: number };
      if (typeof data.cwd === "string" && typeof data.editorState === "string") {
        console.log("[inbound-bridge] notes.sync from mobile:", data.cwd);
        this.onNotesSyncReceived?.({
          cwd: data.cwd,
          editorState: data.editorState,
          timestamp: data.timestamp ?? Date.now(),
        });
      }
      const response = JSON.stringify({ id, result: { ok: true } });
      void this.relay.sendToDevice(fromDeviceId, response).catch(() => {});
      return;
    }

    // Handle TTS requests locally
    if (body._tag === "tts.synthesize") {
      void this.handleTTSRequest(fromDeviceId, id, body).catch(() => {});
      return;
    }

    // Forward to local server via WebSocket
    this.pendingRequests.set(id, fromDeviceId);

    if (this.localWs?.readyState === WebSocket.OPEN) {
      console.log(`[inbound-bridge] Forwarding to local server: ${plaintext.slice(0, 200)}`);
      this.localWs.send(plaintext);
    } else {
      console.warn(`[inbound-bridge] Local server not connected, rejecting: ${body._tag}`);
      this.pendingRequests.delete(id);
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
      void this.relay
        .sendToDevice(
          fromDeviceId,
          JSON.stringify({ id: requestId, error: { message: "Missing text field" } }),
        )
        .catch(() => {});
      return;
    }

    try {
      console.log(`[inbound-bridge] TTS request from mobile: "${text.slice(0, 50)}..."`);
      const res = await fetch(`${this.serverOrigin}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 5000) }),
      });

      if (!res.ok) {
        throw new Error(await res.text().catch(() => `TTS server error (${res.status})`));
      }

      const wavBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(wavBuffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const base64Audio = btoa(binary);

      console.log(
        `[inbound-bridge] TTS response: ${(wavBuffer.byteLength / 1024).toFixed(0)}KB WAV → base64 to mobile`,
      );
      void this.relay
        .sendToDevice(
          fromDeviceId,
          JSON.stringify({ id: requestId, result: { audio: base64Audio } }),
        )
        .catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : "TTS synthesis failed";
      void this.relay
        .sendToDevice(fromDeviceId, JSON.stringify({ id: requestId, error: { message } }))
        .catch(() => {});
    }
  }

  private forwardPushToMobiles(raw: string): void {
    for (const deviceId of this.activeMobileDevices) {
      void this.relay.sendToDevice(deviceId, raw).catch(() => {});
    }
  }
}
