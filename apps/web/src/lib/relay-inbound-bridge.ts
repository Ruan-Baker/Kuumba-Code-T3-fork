/**
 * RelayInboundBridge — proxies inbound RPC requests from paired mobile
 * devices (via the relay) to the local desktop server, and forwards
 * responses and push events back.
 *
 * Uses the browser's fetch API for RPC (POST to local server) instead
 * of a separate WebSocket, avoiding connection management issues.
 * Push events are forwarded from the existing WsTransport subscription.
 *
 * Also syncs thread state to Convex so mobile devices have a reliable
 * fallback when relay messages are missed.
 */
import type { RelayTransport } from "./relay-transport";
import { syncThreadState, type ThreadStateSnapshot } from "./convex-sync";

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

  /**
   * In-memory thread state tracker for Convex sync.
   * Builds up a snapshot from push events and periodically syncs to Convex.
   */
  private threadStates = new Map<string, {
    sessionStatus: string;
    title: string;
    projectName: string;
    projectCwd: string;
    model: string;
    messages: Array<{ id: string; role: string; text: string; streaming: boolean; createdAt: string }>;
    activities: Array<{ id: string; tone: string; kind: string; summary: string; createdAt: string }>;
    proposedPlans: Array<{ id: string; planMarkdown: string; implementedAt: string | null; createdAt: string }>;
    pendingApprovals: Array<{ requestId: string; type: string; detail: string }>;
    isStreaming: boolean;
  }>();

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

    // Also sync state to Convex for mobile fallback
    this.syncPushToConvex(raw);
  }

  /**
   * Parse push events and update Convex thread state.
   * This ensures mobile always has current state even if relay messages are missed.
   */
  private syncPushToConvex(raw: string): void {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type !== "push") return;

      const channel = parsed.channel as string;
      const data = parsed.data as Record<string, unknown>;
      if (!data) return;

      // Only sync orchestration domain events
      if (channel !== "orchestration.domainEvent") return;

      const event = data as { type: string; aggregateId?: string; payload: Record<string, unknown> };
      const threadId = (event.payload?.threadId as string) ?? event.aggregateId;
      if (!threadId) return;

      // Get or create thread state tracker
      let tracker = this.threadStates.get(threadId);
      if (!tracker) {
        tracker = {
          sessionStatus: "idle",
          title: "",
          projectName: "",
          projectCwd: "",
          model: "",
          messages: [],
          activities: [],
          proposedPlans: [],
          pendingApprovals: [],
          isStreaming: false,
        };
        this.threadStates.set(threadId, tracker);
      }

      let shouldSync = false;

      switch (event.type) {
        case "thread.message-sent": {
          const p = event.payload;
          const messageId = (p.messageId ?? p.id) as string;
          const role = (p.role ?? "assistant") as string;
          const text = (p.text ?? "") as string;
          const streaming = (p.streaming ?? false) as boolean;
          const createdAt = (p.createdAt ?? new Date().toISOString()) as string;

          const idx = tracker.messages.findIndex((m) => m.id === messageId);
          if (idx >= 0) {
            if (streaming) {
              tracker.messages[idx] = { ...tracker.messages[idx]!, text: tracker.messages[idx]!.text + text, streaming: true, createdAt };
            } else {
              tracker.messages[idx] = { ...tracker.messages[idx]!, streaming: false };
              shouldSync = true; // Message finished — sync immediately
            }
          } else {
            tracker.messages.push({ id: messageId, role, text, streaming, createdAt });
            if (role === "user") shouldSync = true; // New user message — sync immediately
          }
          tracker.isStreaming = streaming;
          break;
        }

        case "thread.activity-appended": {
          const p = event.payload as Record<string, unknown>;
          tracker.activities.push({
            id: p.id as string,
            tone: p.tone as string,
            kind: p.kind as string,
            summary: p.summary as string,
            createdAt: p.createdAt as string,
          });
          if ((p.tone as string) === "approval") {
            tracker.pendingApprovals.push({
              requestId: p.id as string,
              type: p.kind as string,
              detail: p.summary as string,
            });
            shouldSync = true; // Approval needs immediate sync
          }
          break;
        }

        case "thread.session-set": {
          const status = event.payload.status as string;
          if (status) {
            tracker.sessionStatus = status;
            tracker.isStreaming = status === "running" || status === "starting";
            shouldSync = true; // Session status change — sync immediately
          }
          break;
        }

        case "thread.meta-updated": {
          if (event.payload.title) {
            tracker.title = event.payload.title as string;
            shouldSync = true;
          }
          break;
        }

        case "thread.proposed-plan-upserted": {
          const p = event.payload as { proposedPlan?: { id: string; planMarkdown: string; implementedAt: string | null; createdAt: string } };
          if (p.proposedPlan) {
            const idx = tracker.proposedPlans.findIndex((pl) => pl.id === p.proposedPlan!.id);
            if (idx >= 0) {
              tracker.proposedPlans[idx] = p.proposedPlan;
            } else {
              tracker.proposedPlans.push(p.proposedPlan);
            }
            shouldSync = true;
          }
          break;
        }
      }

      // Sync to Convex (syncThreadState handles debouncing)
      if (shouldSync || !tracker.isStreaming) {
        syncThreadState({
          threadId,
          sessionStatus: tracker.sessionStatus,
          title: tracker.title,
          projectName: tracker.projectName,
          projectCwd: tracker.projectCwd,
          model: tracker.model,
          messages: tracker.messages,
          activities: tracker.activities,
          proposedPlans: tracker.proposedPlans,
          pendingApprovals: tracker.pendingApprovals,
          isStreaming: tracker.isStreaming,
        });
      }
    } catch {
      // Don't let Convex sync errors break push forwarding
    }
  }
}
