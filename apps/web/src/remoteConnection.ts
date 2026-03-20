/**
 * Remote Connection Manager
 *
 * Manages the lifecycle of connecting to a remote Kuumba Code server.
 * When a remote session is selected, swaps the global NativeApi to point
 * at the remote server's WebSocket. All existing components work unchanged.
 *
 * Two connection modes are supported:
 *  - Direct (Tailscale): connect(device, deviceName) — builds a ws:// URL
 *    from the device's tailscaleHost/port.
 *  - Relay: connectViaRelay(transport, targetDeviceId) — routes through the
 *    relay server using an existing RelayTransport instance.
 */
import { create } from "zustand";
import type { RelayTransport } from "./lib/relay-transport";
import type { RemoteDeviceConfig } from "./appSettings";

// ── State ────────────────────────────────────────────────────────────

export interface RemoteConnectionState {
  /** Whether a remote connection is currently active */
  isActive: boolean;
  /** The device we're connected to (direct/Tailscale connections) */
  connectedDevice: RemoteDeviceConfig | null;
  /** The device name (from /api/device-info or relay presence) */
  connectedDeviceName: string | null;
  /** Connection status */
  status: "disconnected" | "connecting" | "connected" | "error";
  /** Error message if status is "error" */
  error: string | null;
  /** Relay transport instance used for relay-mode connections */
  relayTransport: RelayTransport | null;
  /** The remote device ID when connected via relay */
  relayTargetDeviceId: string | null;
}

interface RemoteConnectionActions {
  connect: (device: RemoteDeviceConfig, deviceName: string) => void;
  connectViaRelay: (transport: RelayTransport, targetDeviceId: string, deviceName: string) => void;
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
    relayTransport: null,
    relayTargetDeviceId: null,

    connect: (device: RemoteDeviceConfig, deviceName: string) => {
      set({
        isActive: true,
        connectedDevice: device,
        connectedDeviceName: deviceName,
        status: "connecting",
        error: null,
        relayTransport: null,
        relayTargetDeviceId: null,
      });
    },

    connectViaRelay: (transport: RelayTransport, targetDeviceId: string, deviceName: string) => {
      set({
        isActive: true,
        connectedDevice: null,
        connectedDeviceName: deviceName,
        status: "connected",
        error: null,
        relayTransport: transport,
        relayTargetDeviceId: targetDeviceId,
      });
    },

    disconnect: () => {
      set({
        isActive: false,
        connectedDevice: null,
        connectedDeviceName: null,
        status: "disconnected",
        error: null,
        relayTransport: null,
        relayTargetDeviceId: null,
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
