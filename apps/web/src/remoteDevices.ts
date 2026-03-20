/**
 * Remote device discovery via Tailscale HTTP polling.
 *
 * Each configured remote device is polled at GET /api/device-info every 30s.
 * Returns online status and session list per device.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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

async function fetchDeviceInfo(
  device: RemoteDeviceConfig,
): Promise<RemoteDeviceInfo> {
  const url = `http://${device.tailscaleHost}:${device.port}/api/device-info`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: device.authToken
        ? { Authorization: `Bearer ${device.authToken}` }
        : undefined,
    });
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
