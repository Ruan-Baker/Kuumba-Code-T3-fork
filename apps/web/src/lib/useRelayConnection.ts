/**
 * Global relay connection hook.
 *
 * Auto-connects to the relay server on app startup when relayUrl and
 * device identity are configured.
 */
import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { RelayTransport, type PairedDevice } from "./relay-transport";
import { RelayInboundBridge } from "./relay-inbound-bridge";

export interface RelayConnectionState {
  transport: RelayTransport | null;
  connected: boolean;
  pairedDevices: PairedDevice[];
  /** Call this after sharing/unsharing a session to update the relay */
  refreshRelaySessions: () => void;
}

const DEVICE_ID_KEY = "t3code:device-id";
const SETTINGS_KEY = "t3code:app-settings:v1";

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
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
      relayUrl: parsed.relayUrl ?? "",
      pairingToken: parsed.devicePairingToken ?? "",
      e2ePublicKey: parsed.e2ePublicKey ?? "",
      e2ePrivateKey: parsed.e2ePrivateKey ?? "",
    };
  } catch {
    return { relayUrl: "", pairingToken: "", e2ePublicKey: "", e2ePrivateKey: "" };
  }
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
export function useRelayConnection(): RelayConnectionState {
  const [connected, setConnected] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const transportRef = useRef<RelayTransport | null>(null);
  const configRef = useRef({ relayUrl: "", pairingToken: "", deviceId: "" });

  const refreshRelaySessions = useCallback(() => {
    const transport = transportRef.current;
    if (!transport) return;
    void fetchLocalDeviceInfo().then((sessions) => {
      console.log(`[relay] Updating relay with ${sessions.length} shared session(s)`);
      transport.updateSessions(sessions);
    });
  }, []);

  useEffect(() => {
    const { relayUrl, pairingToken, e2ePublicKey, e2ePrivateKey } = readRelaySettings();
    const deviceId = getOrCreateDeviceId();
    const deviceName =
      typeof window !== "undefined" && window.desktopBridge ? "Desktop" : "Browser";

    // Don't connect if not configured yet
    if (!relayUrl || !pairingToken) return;

    // Don't reconnect if config hasn't changed
    if (
      transportRef.current &&
      configRef.current.relayUrl === relayUrl &&
      configRef.current.pairingToken === pairingToken &&
      configRef.current.deviceId === deviceId
    ) {
      return;
    }

    // Dispose old transport if config changed
    if (transportRef.current) {
      transportRef.current.dispose();
      transportRef.current = null;
      setConnected(false);
    }

    configRef.current = { relayUrl, pairingToken, deviceId };

    // Get the local server WebSocket URL for the inbound bridge
    const localWsUrl = resolveLocalServerWsUrl();

    // Use the key pair from appSettings so it matches the QR code
    const existingKeyPair =
      e2ePublicKey && e2ePrivateKey
        ? { publicKey: e2ePublicKey, privateKey: e2ePrivateKey }
        : undefined;

    // Create the inbound bridge immediately so it's ready when devices pair
    let bridge: RelayInboundBridge | null = null;

    const transport = new RelayTransport({
      relayUrl,
      deviceId,
      deviceName,
      pairingToken,
      existingKeyPair,
      onConnected: () => {
        console.log("[relay] Connected to relay server");
        setConnected(true);
        void fetchLocalDeviceInfo().then((sessions) => {
          console.log(`[relay] Initial session sync: ${sessions.length} shared session(s)`);
          transport.updateSessions(sessions);
        });

        // Start the inbound bridge so mobile devices can send RPC requests
        if (localWsUrl && !bridge) {
          bridge = new RelayInboundBridge(transport, localWsUrl);
          console.log("[relay] Inbound bridge started for mobile RPC proxying");
        }
      },
      onDisconnected: () => {
        console.log("[relay] Disconnected from relay server");
        setConnected(false);
      },
      onPairedDevicesChanged: (devices) => {
        setPairedDevices(devices);
        // Auto-register all paired devices with the inbound bridge
        if (bridge) {
          for (const d of devices) {
            bridge.addMobileDevice(d.deviceId);
          }
        }
      },
      onMessage: (fromDeviceId, _fromDeviceName, message) => {
        // Fallback: if the bridge exists but the device wasn't registered yet,
        // route the message through the bridge's global handler
        if (bridge) {
          bridge.handleGlobalMessage(fromDeviceId, message);
        } else {
          console.log(`[relay] Message from ${fromDeviceId} (no bridge):`, message.slice(0, 100));
        }
      },
    });

    transportRef.current = transport;
    void transport.connect();

    return () => {
      bridge?.dispose();
      bridge = null;
      transport.dispose();
      if (transportRef.current === transport) {
        transportRef.current = null;
      }
      setConnected(false);
    };
  }, []); // Run once on mount — reads settings from localStorage directly

  return {
    transport: transportRef.current,
    connected,
    pairedDevices,
    refreshRelaySessions,
  };
}

// Context for sharing relay state across the app
export const RelayContext = createContext<RelayConnectionState>({
  transport: null,
  connected: false,
  pairedDevices: [],
  refreshRelaySessions: () => {},
});

export function useRelay(): RelayConnectionState {
  return useContext(RelayContext);
}
