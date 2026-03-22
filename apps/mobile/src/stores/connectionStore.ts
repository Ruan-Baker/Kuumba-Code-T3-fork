/**
 * Active connection pool — supports both direct WebSocket and relay connections.
 * Exposes a unified transport interface regardless of connection type.
 */
import { create } from "zustand";
import { WsTransport, type TransportState } from "~/lib/wsTransport";
import { RelayTransport } from "~/lib/relayTransport";
import type { SavedDevice } from "./settingsStore";

type AnyTransport = WsTransport | RelayTransport;

interface ActiveConnection {
  deviceId: string;
  transport: AnyTransport;
  status: TransportState;
}

interface PairedDeviceInfo {
  deviceId: string;
  deviceName: string;
  online: boolean;
  sessions: Array<{
    threadId: string;
    projectId: string;
    projectName: string;
    projectCwd: string;
    status: string;
    title: string;
  }>;
}

interface ConnectionStoreState {
  connections: Record<string, ActiveConnection>;
  activeDeviceId: string | null;
  /** Relay-provided device info (replaces HTTP polling for relay devices) */
  relayDevices: PairedDeviceInfo[];
  /** Relay WebSocket connection status */
  relayConnected: boolean;
  /** Callback for mode sync from desktop */
  modeSyncHandler:
    | ((data: {
        interactionMode?: string;
        runtimeMode?: string;
        model?: string;
        reasoningLevel?: string;
      }) => void)
    | null;
  setModeSyncHandler: (
    handler:
      | ((data: {
          interactionMode?: string;
          runtimeMode?: string;
          model?: string;
          reasoningLevel?: string;
        }) => void)
      | null,
  ) => void;
  /** Callback for notes sync from desktop */
  notesSyncHandler:
    | ((data: { cwd: string; editorState: string; timestamp: number }) => void)
    | null;
  setNotesSyncHandler: (
    handler: ((data: { cwd: string; editorState: string; timestamp: number }) => void) | null,
  ) => void;

  connect: (device: SavedDevice) => AnyTransport;
  disconnect: (deviceId: string) => void;
  disconnectAll: () => void;
  setActiveDevice: (deviceId: string | null) => void;
  getTransport: (deviceId: string) => AnyTransport | null;
  getActiveTransport: () => AnyTransport | null;
}

function buildDirectWsUrl(device: SavedDevice): string {
  const tokenParam = device.authToken ? `?token=${encodeURIComponent(device.authToken)}` : "";
  return `ws://${device.host}:${device.port}${tokenParam}`;
}

export const useConnectionStore = create<ConnectionStoreState>()((set, get) => ({
  connections: {},
  activeDeviceId: null,
  relayDevices: [],
  relayConnected: false,
  modeSyncHandler: null,
  setModeSyncHandler: (handler) => set({ modeSyncHandler: handler }),
  notesSyncHandler: null,
  setNotesSyncHandler: (handler) => set({ notesSyncHandler: handler }),

  connect: (device) => {
    const existing = get().connections[device.id];
    if (existing) return existing.transport;

    if (device.isRelay && device.relayUrl && device.deviceId && device.pairingToken) {
      // Relay connection
      const relay = new RelayTransport({
        relayUrl: device.relayUrl,
        deviceName: "Kuumba Mobile",
        targetDeviceId: device.deviceId,
        targetPairingToken: device.pairingToken,
        targetPublicKey: device.publicKey ?? "",
        targetDeviceName: device.name,
        onModeSync: (data) => {
          const handler = get().modeSyncHandler;
          if (handler) handler(data);
        },
        onNotesSync: (data) => {
          const handler = get().notesSyncHandler;
          if (handler) handler(data);
        },
        onDevicesChanged: (devices) => {
          set({ relayDevices: devices });
        },
        onConnected: () => {
          set((state) => ({
            relayConnected: true,
            connections: {
              ...state.connections,
              [device.id]: {
                ...state.connections[device.id]!,
                status: "open",
              },
            },
          }));
        },
        onDisconnected: () => {
          set((state) => {
            const conn = state.connections[device.id];
            if (!conn) return state;
            return {
              relayConnected: false,
              connections: {
                ...state.connections,
                [device.id]: { ...conn, status: "closed" },
              },
            };
          });
        },
      });

      set((state) => ({
        connections: {
          ...state.connections,
          [device.id]: { deviceId: device.id, transport: relay, status: "connecting" },
        },
      }));

      void relay.connect();
      return relay;
    }

    // Direct WebSocket connection
    const url = buildDirectWsUrl(device);
    const transport = new WsTransport(url);

    set((state) => ({
      connections: {
        ...state.connections,
        [device.id]: { deviceId: device.id, transport, status: "connecting" },
      },
    }));

    return transport;
  },

  disconnect: (deviceId) => {
    const conn = get().connections[deviceId];
    if (conn) {
      conn.transport.dispose();
      set((state) => {
        const { [deviceId]: _, ...rest } = state.connections;
        return {
          connections: rest,
          activeDeviceId: state.activeDeviceId === deviceId ? null : state.activeDeviceId,
        };
      });
    }
  },

  disconnectAll: () => {
    for (const conn of Object.values(get().connections)) {
      conn.transport.dispose();
    }
    set({ connections: {}, activeDeviceId: null, relayDevices: [] });
  },

  setActiveDevice: (deviceId) => set({ activeDeviceId: deviceId }),

  getTransport: (deviceId) => get().connections[deviceId]?.transport ?? null,

  getActiveTransport: () => {
    const { activeDeviceId, connections } = get();
    if (!activeDeviceId) return null;
    return connections[activeDeviceId]?.transport ?? null;
  },
}));
