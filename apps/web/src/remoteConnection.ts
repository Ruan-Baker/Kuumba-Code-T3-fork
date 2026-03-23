/**
 * Remote Connection Manager
 *
 * Manages the lifecycle of connecting to a remote Kuumba Code server.
 * When a remote session is selected, swaps the global NativeApi to point
 * at the remote server via the relay. All existing components work unchanged.
 */
import { create } from "zustand";
import type { RelayTransport } from "./lib/relay-transport";
import type { RelayWsBridge } from "./lib/relay-ws-bridge";

// ── Global bridge reference for remote composer sync ─────────────────

let activeRemoteBridge: RelayWsBridge | null = null;

export function getActiveRemoteBridge(): RelayWsBridge | null {
  return activeRemoteBridge;
}

export function setActiveRemoteBridge(bridge: RelayWsBridge | null): void {
  activeRemoteBridge = bridge;
}

// ── State ────────────────────────────────────────────────────────────

export interface RemoteConnectionState {
  /** Whether a remote connection is currently active */
  isActive: boolean;
  /** The device name (from relay presence) */
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
  connectViaRelay: (transport: RelayTransport, targetDeviceId: string, deviceName: string) => void;
  disconnect: () => void;
  setStatus: (status: RemoteConnectionState["status"], error?: string) => void;
}

export const useRemoteConnectionStore = create<RemoteConnectionState & RemoteConnectionActions>(
  (set) => ({
    isActive: false,
    connectedDeviceName: null,
    status: "disconnected",
    error: null,
    relayTransport: null,
    relayTargetDeviceId: null,

    connectViaRelay: (transport: RelayTransport, targetDeviceId: string, deviceName: string) => {
      set({
        isActive: true,
        connectedDeviceName: deviceName,
        status: "connected",
        error: null,
        relayTransport: transport,
        relayTargetDeviceId: targetDeviceId,
      });
    },

    disconnect: () => {
      activeRemoteBridge = null;
      set({
        isActive: false,
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
