/**
 * Global relay connection hook.
 *
 * Auto-connects to the relay server on app startup when relayUrl and
 * device identity are configured.
 */
import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { RelayTransport, type PairedDevice } from "./relay-transport";
import { RelayInboundBridge } from "./relay-inbound-bridge";
import { initConvexSync } from "./convex-sync";
import { useRemoteConnectionStore } from "../remoteConnection";

export interface RelayConnectionState {
  transport: RelayTransport | null;
  connected: boolean;
  pairedDevices: PairedDevice[];
  /** Call this after sharing/unsharing a session to update the relay */
  refreshRelaySessions: () => void;
  /** Update composer state and push to mobile devices */
  updateComposerState: (state: {
    interactionMode?: string;
    runtimeMode?: string;
    model?: string;
    reasoningLevel?: string;
  }) => void;
  /** Subscribe to composer state changes from mobile */
  onComposerStateChanged: (
    handler: (data: {
      interactionMode?: string;
      runtimeMode?: string;
      model?: string;
      reasoningLevel?: string;
    }) => void,
  ) => void;
  /** Register a live state getter so mobile can fetch the real state */
  registerComposerStateGetter: (
    getter: () => {
      interactionMode: string;
      runtimeMode: string;
      model: string;
      reasoningLevel: string;
    },
  ) => void;
  /** Push notes update to all connected mobile devices */
  pushNotesSync: (cwd: string, editorState: string, timestamp: number) => void;
  /** Subscribe to notes sync from mobile */
  onNotesSyncReceived: (
    handler: (data: { cwd: string; editorState: string; timestamp: number }) => void,
  ) => void;
  /** Pair with a remote device via relay */
  pairRemoteDevice: (
    deviceId: string,
    pairingToken: string,
    publicKey: string,
    deviceName: string,
  ) => void;
}

const DEVICE_ID_KEY = "t3code:device-id";
const SERVER_DEVICE_ID_KEY = "t3code:server-device-id";
const SETTINGS_KEY = "t3code:app-settings:v1";

/**
 * Get the stable device ID. Prefers the server's persisted deviceId
 * (survives port changes in dev mode). Falls back to localStorage UUID.
 */
function getOrCreateDeviceId(): string {
  // First check if we have the server's stable device ID
  const serverDeviceId = localStorage.getItem(SERVER_DEVICE_ID_KEY);
  if (serverDeviceId) return serverDeviceId;

  // Fallback to the old key
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Fetch the server's stable device ID and persist it.
 * Retries until server is available (server might still be starting).
 */
async function syncServerDeviceId(): Promise<string | null> {
  // If we already have it cached, return immediately
  const cached = localStorage.getItem(SERVER_DEVICE_ID_KEY);
  if (cached) {
    console.log("[relay] Using cached server device ID:", cached);
    return cached;
  }

  // Try fetching from server, with retries
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
      if (!bridgeWsUrl) return null;

      const url = new URL(bridgeWsUrl);
      const protocol = url.protocol === "wss:" ? "https:" : "http:";
      const origin = `${protocol}//${url.host}`;

      const res = await fetch(`${origin}/api/device-info`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.deviceId) {
          console.log("[relay] Synced server device ID:", data.deviceId);
          localStorage.setItem(SERVER_DEVICE_ID_KEY, data.deviceId);
          localStorage.setItem(DEVICE_ID_KEY, data.deviceId);
          return data.deviceId;
        }
      }
    } catch {
      // Server not ready yet — wait and retry
      if (attempt < 9) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  console.warn("[relay] Could not sync server device ID after 10 attempts");
  return null;
}

/** Read the Convex deployment URL from settings or env */
function readConvexUrl(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.convexUrl) return parsed.convexUrl;
    }
  } catch { /* ignore */ }
  // Fallback to env var (for dev)
  return (import.meta as any).env?.VITE_CONVEX_URL ?? "";
}

/** Read relay settings directly from localStorage to avoid hook dependencies */
function readRelaySettings(): {
  relayUrl: string;
  pairingToken: string;
  e2ePublicKey: string;
  e2ePrivateKey: string;
} {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { relayUrl: "", pairingToken: "", e2ePublicKey: "", e2ePrivateKey: "" };
    const parsed = JSON.parse(raw);
    return {
      relayUrl: parsed.relayUrl || "wss://kuumba-relay-server-production.up.railway.app",
      pairingToken: parsed.devicePairingToken ?? "",
      e2ePublicKey: parsed.e2ePublicKey ?? "",
      e2ePrivateKey: parsed.e2ePrivateKey ?? "",
    };
  } catch {
    return { relayUrl: "", pairingToken: "", e2ePublicKey: "", e2ePrivateKey: "" };
  }
}

/**
 * Get the device ID we're currently viewing remotely (if any).
 * Messages from this device should go through RelayWsBridge, NOT the inbound bridge.
 */
function getActiveViewedDeviceId(): string | null {
  return useRemoteConnectionStore.getState().relayTargetDeviceId;
}

/**
 * Read ALL remote desktop device IDs from settings.
 * These devices should NEVER be treated as mobile devices by the inbound bridge,
 * because their messages are handled by RelayWsBridge when viewing remote sessions.
 * Unlike getActiveViewedDeviceId(), this works BEFORE any session is clicked.
 */
function getRemoteDesktopDeviceIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const rd of parsed.remoteDevices ?? []) {
        if (rd.deviceId) ids.add(rd.deviceId);
      }
    }
  } catch { /* ignore */ }
  return ids;
}

/**
 * Get the local server's WebSocket URL (for the inbound bridge to connect to).
 */
function resolveLocalServerWsUrl(): string | null {
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  if (typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0) {
    return bridgeWsUrl;
  }
  // Fallback for non-Electron: ws://localhost:port
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }
  return null;
}

/**
 * Fetch current shared sessions from the local server's /api/device-info.
 */
async function fetchLocalDeviceInfo(): Promise<
  Array<{
    threadId: string;
    projectId: string;
    projectName: string;
    projectCwd: string;
    status: string;
    title: string;
  }>
> {
  try {
    let origin = "";
    const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
    if (typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0) {
      const url = new URL(bridgeWsUrl);
      const protocol = url.protocol === "wss:" ? "https:" : "http:";
      origin = `${protocol}//${url.host}`;
    } else {
      origin = window.location.origin;
    }

    const res = await fetch(`${origin}/api/device-info`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions ?? [];
  } catch {
    return [];
  }
}

/**
 * Hook that manages a single global RelayTransport connection.
 * Call this once at app root level.
 *
 * Reads settings directly from localStorage (not useAppSettings) to
 * keep the hook count stable and avoid React hooks-order errors.
 */
// Store on window so they survive HMR module replacement
const win = window as unknown as {
  __relayTransport?: RelayTransport | null;
  __relayBridge?: RelayInboundBridge | null;
  __relayConfig?: { relayUrl: string; pairingToken: string; deviceId: string };
  __relaySessionRefreshInterval?: ReturnType<typeof setInterval> | null;
};

function getGlobalTransport(): RelayTransport | null {
  return win.__relayTransport ?? null;
}
function setGlobalTransport(t: RelayTransport | null) {
  win.__relayTransport = t;
}
function getGlobalBridge(): RelayInboundBridge | null {
  return win.__relayBridge ?? null;
}
function setGlobalBridge(b: RelayInboundBridge | null) {
  win.__relayBridge = b;
}
function getGlobalConfig() {
  return win.__relayConfig ?? { relayUrl: "", pairingToken: "", deviceId: "" };
}
function setGlobalConfig(c: { relayUrl: string; pairingToken: string; deviceId: string }) {
  win.__relayConfig = c;
}

export function useRelayConnection(): RelayConnectionState {
  const [connected, setConnected] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const transportRef = useRef<RelayTransport | null>(null);
  const configRef = useRef(getGlobalConfig());

  const refreshRelaySessions = useCallback(() => {
    const transport = getGlobalTransport();
    if (!transport) return;
    void fetchLocalDeviceInfo().then((sessions) => {
      console.log(`[relay] Updating relay with ${sessions.length} shared session(s)`);
      transport.updateSessions(sessions);
    });
  }, []);

  const updateComposerState = useCallback(
    (state: {
      interactionMode?: string;
      runtimeMode?: string;
      model?: string;
      reasoningLevel?: string;
    }) => {
      const bridge = getGlobalBridge();
      if (bridge) {
        bridge.updateComposerState(state);
      }
    },
    [],
  );

  const onComposerStateChanged = useCallback(
    (
      handler: (data: {
        interactionMode?: string;
        runtimeMode?: string;
        model?: string;
        reasoningLevel?: string;
      }) => void,
    ) => {
      const bridge = getGlobalBridge();
      if (bridge) {
        bridge.onComposerStateChanged = handler;
      }
    },
    [],
  );

  const registerComposerStateGetter = useCallback(
    (
      getter: () => {
        interactionMode: string;
        runtimeMode: string;
        model: string;
        reasoningLevel: string;
      },
    ) => {
      const bridge = getGlobalBridge();
      if (bridge) {
        bridge.getComposerStateLive = getter;
      }
    },
    [],
  );

  const pushNotesSync = useCallback((cwd: string, editorState: string, timestamp: number) => {
    const bridge = getGlobalBridge();
    if (bridge) {
      bridge.pushNotesSync(cwd, editorState, timestamp);
    }
  }, []);

  const onNotesSyncReceived = useCallback(
    (handler: (data: { cwd: string; editorState: string; timestamp: number }) => void) => {
      const bridge = getGlobalBridge();
      if (bridge) {
        bridge.onNotesSyncReceived = handler;
      }
    },
    [],
  );

  const pairRemoteDevice = useCallback(
    (deviceId: string, pairingToken: string, publicKey: string, deviceName: string) => {
      const transport = getGlobalTransport();
      if (transport) {
        void transport.pairWithDevice(deviceId, pairingToken, publicKey, deviceName);
      }
    },
    [],
  );

  useEffect(() => {
    // Sync the server's stable device ID first, then connect
    void syncServerDeviceId().then(() => {
      connectToRelay();
    });

    function connectToRelay() {
      const { relayUrl, pairingToken, e2ePublicKey, e2ePrivateKey } = readRelaySettings();
      const deviceId = getOrCreateDeviceId();
      const deviceName =
        typeof window !== "undefined" && window.desktopBridge ? "Desktop" : "Browser";

      console.log("[relay] Using device ID:", deviceId);

      // Don't connect if not configured yet
      if (!relayUrl || !pairingToken) return;

      const gc = getGlobalConfig();

      // If global transport already exists with same config AND same device ID, reuse it
      if (
        getGlobalTransport() &&
        gc.relayUrl === relayUrl &&
        gc.deviceId === deviceId &&
        gc.pairingToken === pairingToken &&
        gc.deviceId === deviceId
      ) {
        transportRef.current = getGlobalTransport();
        setPairedDevices(getGlobalTransport()?.getPairedDevices() ?? []);
        return;
      }

      // Dispose old transport if config changed
      if (getGlobalTransport()) {
        getGlobalTransport()!.dispose();
        setGlobalTransport(null);
      }
      if (getGlobalBridge()) {
        getGlobalBridge()!.dispose();
        setGlobalBridge(null);
      }

      setGlobalConfig({ relayUrl, pairingToken, deviceId });
      configRef.current = getGlobalConfig();

      // Get the local server WebSocket URL for the inbound bridge
      const localWsUrl = resolveLocalServerWsUrl();

      const transport = new RelayTransport({
        relayUrl,
        deviceId,
        deviceName,
        pairingToken,
        ...(e2ePublicKey && e2ePrivateKey
          ? { existingKeyPair: { publicKey: e2ePublicKey, privateKey: e2ePrivateKey } }
          : {}),
        onConnected: () => {
          console.log("[relay] Connected to relay server");
          setConnected(true);
          void fetchLocalDeviceInfo().then((sessions) => {
            console.log(`[relay] Initial session sync: ${sessions.length} shared session(s)`);
            transport.updateSessions(sessions);
          });

          // Start the inbound bridge so mobile devices can send RPC requests
          if (localWsUrl && !getGlobalBridge()) {
            const bridge = new RelayInboundBridge(transport, localWsUrl);
            // Exclude remote desktop devices from the inbound bridge so their
            // messages go through RelayWsBridge instead. This MUST happen at
            // creation time, BEFORE any pair-accepted events arrive.
            const remoteIds = getRemoteDesktopDeviceIds();
            bridge.setExcludedDevices(remoteIds);
            console.log("[relay] Excluding remote desktop device IDs from inbound bridge:", [...remoteIds]);
            setGlobalBridge(bridge);
            console.log("[relay] Inbound bridge started for mobile RPC proxying");
          }

          // Wire up session-change callback on the bridge so new sessions
          // are immediately pushed to the relay (and thus to mobile)
          if (getGlobalBridge()) {
            getGlobalBridge()!.onSessionsChanged = () => {
              void fetchLocalDeviceInfo().then((sessions) => {
                console.log(`[relay] Session change detected — pushing ${sessions.length} session(s) to relay`);
                transport.updateSessions(sessions);
              });
            };
          }

          // Periodic session refresh — safety net to catch any missed session changes
          if (win.__relaySessionRefreshInterval) {
            clearInterval(win.__relaySessionRefreshInterval);
          }
          win.__relaySessionRefreshInterval = setInterval(() => {
            void fetchLocalDeviceInfo().then((sessions) => {
              transport.updateSessions(sessions);
            });
          }, 10_000); // Every 10 seconds

          // Initialize Convex sync for thread state persistence
          const convexUrl = readConvexUrl();
          if (convexUrl) {
            void initConvexSync(convexUrl, deviceId);
          }

          // Auto-pair ALL known devices on reconnect (both remote desktops and QR-scanned mobiles)
          try {
            const raw = localStorage.getItem("t3code:app-settings:v1");
            if (raw) {
              const parsed = JSON.parse(raw);

              // 1. Auto-pair manually configured remote devices (other desktops)
              const remoteDevices = parsed.remoteDevices ?? [];
              for (const rd of remoteDevices) {
                if (rd.deviceId && rd.pairingToken) {
                  console.log(`[relay] Auto-pairing remote device: ${rd.name || rd.deviceId}`);
                  void transport.pairWithDevice(
                    rd.deviceId,
                    rd.pairingToken,
                    rd.publicKey ?? "",
                    rd.name || rd.deviceId,
                  );
                }
              }

              // 2. Auto-pair QR-scanned mobile devices (from pairedDevices array)
              // This ensures mobile devices see this desktop as online immediately
              // after the desktop app restarts.
              const qrPairedDevices = parsed.pairedDevices ?? [];
              for (const pd of qrPairedDevices) {
                if (pd.deviceId && pd.publicKey) {
                  console.log(`[relay] Auto-pairing QR-scanned device: ${pd.deviceName || pd.deviceId}`);
                  void transport.pairWithDevice(
                    pd.deviceId,
                    pairingToken, // Use our own pairing token (mobile already knows it from QR)
                    pd.publicKey,
                    pd.deviceName || pd.deviceId,
                  );
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        },
        onDisconnected: () => {
          console.log("[relay] Disconnected from relay server");
          setConnected(false);
        },
        onPairedDevicesChanged: (devices) => {
          setPairedDevices(devices);
          if (getGlobalBridge()) {
            // Refresh the exclusion list from settings — this catches remote
            // desktops BEFORE any session is clicked (unlike getActiveViewedDeviceId
            // which only works after clicking).
            const remoteDesktopIds = getRemoteDesktopDeviceIds();
            getGlobalBridge()!.setExcludedDevices(remoteDesktopIds);
            // Also check the currently viewed device (belt and suspenders)
            const viewedDeviceId = getActiveViewedDeviceId();
            for (const d of devices) {
              if (remoteDesktopIds.has(d.deviceId) || (viewedDeviceId && d.deviceId === viewedDeviceId)) {
                console.log(`[relay] Skipping remote device in onPairedDevicesChanged: ${d.deviceId.slice(0, 8)}...`);
                continue;
              }
              getGlobalBridge()!.addMobileDevice(d.deviceId);
            }
          }
        },
        onMessage: (fromDeviceId, _fromDeviceName, message) => {
          if (getGlobalBridge()) {
            // Don't let the inbound bridge handle messages from remote desktop
            // devices — those are handled by RelayWsBridge. The inbound bridge's
            // handleGlobalMessage would auto-register them as mobile devices,
            // overwriting the RelayWsBridge handler.
            const viewedDeviceId = getActiveViewedDeviceId();
            if (viewedDeviceId && fromDeviceId === viewedDeviceId) return;
            // Also check if this device is a configured remote desktop
            if (getGlobalBridge()!.isExcludedDevice(fromDeviceId)) return;
            getGlobalBridge()!.handleGlobalMessage(fromDeviceId, message);
          } else {
            console.log(`[relay] Message from ${fromDeviceId} (no bridge):`, message.slice(0, 100));
          }
        },
      });

      setGlobalTransport(transport);
      transportRef.current = transport;
      void transport.connect();
    } // end connectToRelay

    // Don't dispose on unmount — keep alive across HMR
    return () => {
      transportRef.current = null;
    };
  }, []); // Run once on mount — reads settings from localStorage directly

  return {
    transport: getGlobalTransport(),
    connected,
    pairedDevices,
    refreshRelaySessions,
    updateComposerState,
    onComposerStateChanged,
    registerComposerStateGetter,
    pushNotesSync,
    onNotesSyncReceived,
    pairRemoteDevice,
  };
}

// Context for sharing relay state across the app
export const RelayContext = createContext<RelayConnectionState>({
  transport: null,
  connected: false,
  pairedDevices: [],
  refreshRelaySessions: () => {},
  updateComposerState: () => {},
  onComposerStateChanged: () => {},
  registerComposerStateGetter: () => {},
  pushNotesSync: () => {},
  onNotesSyncReceived: () => {},
  pairRemoteDevice: () => {},
});

export function useRelay(): RelayConnectionState {
  return useContext(RelayContext);
}
