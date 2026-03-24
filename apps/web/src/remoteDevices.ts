/**
 * Remote device discovery — dual-mode: WebSocket push + HTTP polling fallback.
 *
 * Primary mode: Once a WebSocket connection is established to a remote device,
 * session list and presence come from server push events over WebSocket.
 *
 * Fallback mode: HTTP polling to /api/device-info is used for initial discovery
 * before a WebSocket connection is established, and as a diagnostic fallback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteDeviceConfig } from "./appSettings";
import { WsTransport, type TransportState } from "./wsTransport";
import type { RemotePresenceState, RemoteSessionsPayload } from "@t3tools/contracts";
import { WS_CHANNELS, WS_METHODS } from "@t3tools/contracts";

// ── Types ────────────────────────────────────────────────────────────

export interface RemoteSessionInfo {
  threadId: string;
  projectId: string;
  projectName: string;
  projectCwd: string;
  status: string;
  title: string;
}

export interface RemoteDeviceInfo {
  deviceId: string;
  deviceName: string;
  port: number;
  sessions: RemoteSessionInfo[];
}

// ── Relay-based presence ──────────────────────────────────────────────

export interface RelayDevicesConfig {
  relayUrl: string;
  deviceId: string;
  deviceName: string;
  pairingToken: string;
}

export interface RemoteDeviceStatus {
  config: RemoteDeviceConfig;
  online: boolean;
  info: RemoteDeviceInfo | null;
  lastChecked: number;
  error: string | null;
  /** Heartbeat-based presence state (only set when using WebSocket transport). */
  presence: RemotePresenceState | null;
}

// ── HTTP Polling (fallback/bootstrap) ────────────────────────────────

const HTTP_POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

async function fetchDeviceInfo(device: RemoteDeviceConfig): Promise<RemoteDeviceInfo> {
  const url = `http://${device.tailscaleHost}:${device.port}/api/device-info`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const fetchOptions: RequestInit = { signal: controller.signal };
    if (device.authToken) {
      fetchOptions.headers = { Authorization: `Bearer ${device.authToken}` };
    }
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as RemoteDeviceInfo;
  } finally {
    clearTimeout(timeout);
  }
}

// ── WebSocket-based discovery ────────────────────────────────────────

interface WsDeviceConnection {
  transport: WsTransport;
  device: RemoteDeviceConfig;
  unsubPresence: (() => void) | null;
  unsubSessions: (() => void) | null;
}

function buildWsUrl(device: RemoteDeviceConfig): string {
  const tokenParam = device.authToken ? `?token=${encodeURIComponent(device.authToken)}` : "";
  return `ws://${device.tailscaleHost}:${device.port}${tokenParam}`;
}

// ── Combined React Hook ──────────────────────────────────────────────

export function useRemoteDevices(devices: readonly RemoteDeviceConfig[]) {
  const [statuses, setStatuses] = useState<Map<string, RemoteDeviceStatus>>(new Map());
  const httpIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnectionsRef = useRef<Map<string, WsDeviceConnection>>(new Map());

  const deviceKey = (d: RemoteDeviceConfig) => `${d.tailscaleHost}:${d.port}`;

  // ── WebSocket Discovery ──────────────────────────────────────────

  const setupWsConnection = useCallback((device: RemoteDeviceConfig) => {
    const key = deviceKey(device);
    const existing = wsConnectionsRef.current.get(key);
    if (existing) return; // Already connected

    const wsUrl = buildWsUrl(device);
    const transport = new WsTransport(wsUrl);

    const conn: WsDeviceConnection = {
      transport,
      device,
      unsubPresence: null,
      unsubSessions: null,
    };

    // Listen for presence changes
    conn.unsubPresence = transport.onPresenceChange((presence) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        const current = next.get(key);
        if (current) {
          next.set(key, {
            ...current,
            online: presence === "healthy" || presence === "degraded",
            presence,
            lastChecked: Date.now(),
            error: presence === "error" ? "Connection error" : null,
          });
        }
        return next;
      });
    });

    // Listen for remote session pushes
    conn.unsubSessions = transport.subscribe(WS_CHANNELS.remoteSessions, (message) => {
      const payload = message.data as RemoteSessionsPayload;
      const sessions: RemoteSessionInfo[] = payload.sessions.map((s) => ({
        threadId: s.threadId,
        projectId: s.projectId,
        projectName: s.projectName,
        projectCwd: s.projectCwd,
        status: s.sessionStatus,
        title: s.title,
      }));
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(key, {
          config: device,
          online: true,
          info: {
            deviceId: payload.deviceId,
            deviceName: payload.deviceName,
            port: device.port,
            sessions,
          },
          lastChecked: Date.now(),
          error: null,
          presence: "healthy",
        });
        return next;
      });
    });

    // Request initial session list once connected
    transport.onStateChange((newState) => {
      if (newState === "open") {
        // Fetch sessions over WebSocket
        transport
          .request<RemoteSessionsPayload>(WS_METHODS.remoteGetSessions)
          .then((payload) => {
            const sessions: RemoteSessionInfo[] = payload.sessions.map((s) => ({
              threadId: s.threadId,
              projectId: s.projectId,
              projectName: s.projectName,
              projectCwd: s.projectCwd,
              status: s.sessionStatus,
              title: s.title,
            }));
            setStatuses((prev) => {
              const next = new Map(prev);
              next.set(key, {
                config: device,
                online: true,
                info: {
                  deviceId: payload.deviceId,
                  deviceName: payload.deviceName,
                  port: device.port,
                  sessions,
                },
                lastChecked: Date.now(),
                error: null,
                presence: "healthy",
              });
              return next;
            });
          })
          .catch(() => {
            // WebSocket connected but method not yet supported — fall back to HTTP
          });
      }
    });

    wsConnectionsRef.current.set(key, conn);
  }, []);

  const teardownWsConnection = useCallback((key: string) => {
    const conn = wsConnectionsRef.current.get(key);
    if (!conn) return;
    conn.unsubPresence?.();
    conn.unsubSessions?.();
    conn.transport.dispose();
    wsConnectionsRef.current.delete(key);
  }, []);

  // ── HTTP Polling (fallback) ──────────────────────────────────────

  const pollAll = useCallback(async () => {
    const results = await Promise.allSettled(
      devices.map(async (device) => {
        const key = deviceKey(device);
        // Skip HTTP poll if WebSocket is already providing data
        const wsConn = wsConnectionsRef.current.get(key);
        if (wsConn && wsConn.transport.getState() === "open") {
          return null; // WS is handling this device
        }
        try {
          const info = await fetchDeviceInfo(device);
          return {
            key,
            status: {
              config: device,
              online: true,
              info,
              lastChecked: Date.now(),
              error: null,
              presence: null,
            } satisfies RemoteDeviceStatus,
          };
        } catch (err) {
          return {
            key,
            status: {
              config: device,
              online: false,
              info: null,
              lastChecked: Date.now(),
              error: err instanceof Error ? err.message : "Unknown error",
              presence: null,
            } satisfies RemoteDeviceStatus,
          };
        }
      }),
    );

    setStatuses((prev) => {
      const next = new Map(prev);
      for (const result of results) {
        if (result.status === "fulfilled" && result.value !== null) {
          next.set(result.value.key, result.value.status);
        }
      }
      // Remove devices that were removed from config
      const currentKeys = new Set(devices.map((d) => deviceKey(d)));
      for (const key of next.keys()) {
        if (!currentKeys.has(key)) {
          next.delete(key);
        }
      }
      return next;
    });
  }, [devices]);

  // ── Effect: Manage WebSocket connections per device ───────────────

  useEffect(() => {
    if (devices.length === 0) {
      // Tear down all WS connections
      for (const key of wsConnectionsRef.current.keys()) {
        teardownWsConnection(key);
      }
      setStatuses(new Map());
      return;
    }

    const currentKeys = new Set(devices.map((d) => deviceKey(d)));

    // Tear down connections for removed devices
    for (const key of wsConnectionsRef.current.keys()) {
      if (!currentKeys.has(key)) {
        teardownWsConnection(key);
      }
    }

    // Set up connections for new devices
    for (const device of devices) {
      setupWsConnection(device);
    }

    // Also do an initial HTTP poll for immediate feedback
    void pollAll();

    // Keep HTTP polling as fallback (less frequent now that WS handles most cases)
    httpIntervalRef.current = setInterval(() => {
      void pollAll();
    }, HTTP_POLL_INTERVAL_MS);

    return () => {
      if (httpIntervalRef.current) {
        clearInterval(httpIntervalRef.current);
        httpIntervalRef.current = null;
      }
      // Note: WS connections are NOT torn down here — they persist across re-renders.
      // They are only torn down when devices are removed.
    };
  }, [devices, setupWsConnection, teardownWsConnection, pollAll]);

  // ── Cleanup on unmount ───────────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const key of wsConnectionsRef.current.keys()) {
        teardownWsConnection(key);
      }
    };
  }, [teardownWsConnection]);

  return {
    statuses,
    wsConnections: wsConnectionsRef.current,
  };
}
