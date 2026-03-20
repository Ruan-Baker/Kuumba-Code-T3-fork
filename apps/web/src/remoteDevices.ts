/**
 * Remote device discovery.
 *
 * Two strategies are supported:
 *  1. Tailscale HTTP polling — each configured remote device is polled at
 *     GET /api/device-info every 30s (useRemoteDevices).
 *  2. Relay-based presence — devices register with a relay server and the
 *     relay tracks who is online (useRelayDevices).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RelayTransport, type PairedDevice } from "~/lib/relay-transport";
import type { RemoteDeviceConfig } from "./appSettings";

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

export interface RemoteDeviceStatus {
  config: RemoteDeviceConfig;
  online: boolean;
  info: RemoteDeviceInfo | null;
  lastChecked: number;
  error: string | null;
}

// ── Polling Logic ────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;
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

// ── React Hook ───────────────────────────────────────────────────────

export function useRemoteDevices(devices: readonly RemoteDeviceConfig[]) {
  const [statuses, setStatuses] = useState<Map<string, RemoteDeviceStatus>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollAll = useCallback(async () => {
    const results = await Promise.allSettled(
      devices.map(async (device) => {
        const key = `${device.tailscaleHost}:${device.port}`;
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
            } satisfies RemoteDeviceStatus,
          };
        }
      }),
    );

    setStatuses((prev) => {
      const next = new Map(prev);
      for (const result of results) {
        if (result.status === "fulfilled") {
          next.set(result.value.key, result.value.status);
        }
      }
      // Remove devices that were removed from config
      const currentKeys = new Set(devices.map((d) => `${d.tailscaleHost}:${d.port}`));
      for (const key of next.keys()) {
        if (!currentKeys.has(key)) {
          next.delete(key);
        }
      }
      return next;
    });
  }, [devices]);

  useEffect(() => {
    if (devices.length === 0) {
      setStatuses(new Map());
      return;
    }

    // Poll immediately on mount / device list change
    void pollAll();

    intervalRef.current = setInterval(() => {
      void pollAll();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [devices, pollAll]);

  return {
    statuses: Array.from(statuses.values()),
    refresh: pollAll,
  };
}

// ── Relay-based presence ──────────────────────────────────────────────

export interface RelayDevicesConfig {
  relayUrl: string;
  deviceId: string;
  deviceName: string;
  pairingToken: string;
}

/**
 * useRelayDevices — tracks paired device presence via a relay server.
 *
 * Creates and manages a RelayTransport instance. On mount it connects to
 * the relay and begins receiving real-time online/offline/session updates
 * for all previously-paired devices.  On unmount the transport is disposed.
 *
 * Returns the same `pairedDevices` array that RelayTransport maintains so
 * consumers get live online status and session lists.
 */
export function useRelayDevices(config: RelayDevicesConfig | null): {
  transport: RelayTransport | null;
  pairedDevices: PairedDevice[];
  relayConnected: boolean;
} {
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [relayConnected, setRelayConnected] = useState(false);
  const transportRef = useRef<RelayTransport | null>(null);

  useEffect(() => {
    if (!config?.relayUrl || !config.deviceId || !config.pairingToken) {
      setPairedDevices([]);
      setRelayConnected(false);
      return;
    }

    const transport = new RelayTransport({
      relayUrl: config.relayUrl,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      pairingToken: config.pairingToken,
      onConnected: () => setRelayConnected(true),
      onDisconnected: () => setRelayConnected(false),
      onPairedDevicesChanged: (devices) => setPairedDevices([...devices]),
    });

    transportRef.current = transport;
    void transport.connect();

    return () => {
      transportRef.current = null;
      transport.dispose();
      setRelayConnected(false);
    };
    // Only rebuild the transport when connection-identity fields change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.relayUrl, config?.deviceId, config?.pairingToken]);

  return {
    transport: transportRef.current,
    pairedDevices,
    relayConnected,
  };
}
