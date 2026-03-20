/**
 * Remote Connection Manager
 *
 * Manages the lifecycle of connecting to a remote Kuumba Code server.
 * When a remote session is selected, swaps the global NativeApi to point
 * at the remote server's WebSocket. All existing components work unchanged.
 */
import { create } from "zustand";
import type { RemoteDeviceConfig } from "./appSettings";

// ── State ────────────────────────────────────────────────────────────

export interface RemoteConnectionState {
  /** Whether a remote connection is currently active */
  isActive: boolean;
  /** The device we're connected to */
  connectedDevice: RemoteDeviceConfig | null;
  /** The device name (from /api/device-info) */
  connectedDeviceName: string | null;
  /** Connection status */
  status: "disconnected" | "connecting" | "connected" | "error";
  /** Error message if status is "error" */
  error: string | null;
}

interface RemoteConnectionActions {
  connect: (device: RemoteDeviceConfig, deviceName: string) => void;
  disconnect: () => void;
  setStatus: (status: RemoteConnectionState["status"], error?: string) => void;
}

export const useRemoteConnectionStore = create<RemoteConnectionState & RemoteConnectionActions>(
  (set) => ({
    isActive: false,
    connectedDevice: null,
    connectedDeviceName: null,
    status: "disconnected",
    error: null,

    connect: (device: RemoteDeviceConfig, deviceName: string) => {
      set({
        isActive: true,
        connectedDevice: device,
        connectedDeviceName: deviceName,
        status: "connecting",
        error: null,
      });
    },

    disconnect: () => {
      set({
        isActive: false,
        connectedDevice: null,
        connectedDeviceName: null,
        status: "disconnected",
        error: null,
      });
    },

    setStatus: (status, error) => {
      set((s) => ({
        ...s,
        status,
        error: error ?? null,
        isActive: status === "connected" || status === "connecting" ? true : s.isActive,
      }));
    },
  }),
);

/**
 * Build a WebSocket URL for a remote device.
 */
export function buildRemoteWsUrl(device: RemoteDeviceConfig): string {
  const tokenParam = device.authToken ? `?token=${encodeURIComponent(device.authToken)}` : "";
  return `ws://${device.tailscaleHost}:${device.port}${tokenParam}`;
}
