/**
 * Remote device discovery — tracks remote device statuses for relay-based devices.
 *
 * Remote devices connect through the relay server, not direct HTTP/WebSocket.
 * This module provides a status-tracking hook that the sidebar uses to show
 * device online/offline state and their active sessions.
 *
 * Actual device communication happens through RelayTransport (see useRelayConnection).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteDeviceConfig } from "./appSettings";
import type { RemotePresenceState } from "@t3tools/contracts";

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
  sessions: RemoteSessionInfo[];
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

// ── Combined React Hook ──────────────────────────────────────────────

/**
 * Hook that tracks status of relay-based remote devices.
 * Device discovery and communication happens through the relay server —
 * this hook just maintains a map of device statuses for the UI.
 */
export function useRemoteDevices(devices: readonly RemoteDeviceConfig[]) {
  const [statuses, setStatuses] = useState<Map<string, RemoteDeviceStatus>>(new Map());

  // Initialize statuses for all configured devices
  useEffect(() => {
    if (devices.length === 0) {
      setStatuses(new Map());
      return;
    }

    setStatuses((prev) => {
      const next = new Map(prev);
      const currentKeys = new Set<string>();

      for (const device of devices) {
        const key = device.deviceId;
        currentKeys.add(key);
        if (!next.has(key)) {
          next.set(key, {
            config: device,
            online: false,
            info: null,
            lastChecked: Date.now(),
            error: null,
            presence: null,
          });
        }
      }

      // Remove devices no longer in config
      for (const key of next.keys()) {
        if (!currentKeys.has(key)) {
          next.delete(key);
        }
      }

      return next;
    });
  }, [devices]);

  /** Update a device's status (called externally when relay reports changes). */
  const updateDeviceStatus = useCallback(
    (deviceId: string, update: Partial<Omit<RemoteDeviceStatus, "config">>) => {
      setStatuses((prev) => {
        const current = prev.get(deviceId);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(deviceId, { ...current, ...update, lastChecked: Date.now() });
        return next;
      });
    },
    [],
  );

  /** Update a device's sessions (called when relay pushes session updates). */
  const updateDeviceSessions = useCallback(
    (deviceId: string, info: RemoteDeviceInfo) => {
      setStatuses((prev) => {
        const current = prev.get(deviceId);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(deviceId, {
          ...current,
          online: true,
          info,
          lastChecked: Date.now(),
          error: null,
        });
        return next;
      });
    },
    [],
  );

  return {
    statuses,
    updateDeviceStatus,
    updateDeviceSessions,
  };
}
