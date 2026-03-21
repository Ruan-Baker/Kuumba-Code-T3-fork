/**
 * Device discovery store — polls saved devices via HTTP for online status & sessions.
 * Pattern from apps/web/src/remoteDevices.ts
 */
import { create } from "zustand";
import type { SavedDevice } from "./settingsStore";

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

export interface DeviceState {
  deviceId: string;
  config: SavedDevice;
  online: boolean;
  lastChecked: number | null;
  info: RemoteDeviceInfo | null;
  error: string | null;
}

interface DevicesStoreState {
  devices: Record<string, DeviceState>;
  refreshing: boolean;

  refreshAll: (savedDevices: SavedDevice[]) => Promise<void>;
  refreshDevice: (device: SavedDevice) => Promise<void>;
  clearDevices: () => void;
}

const FETCH_TIMEOUT_MS = 5_000;

async function fetchDeviceInfo(device: SavedDevice): Promise<RemoteDeviceInfo> {
  const url = `http://${device.host}:${device.port}/api/device-info`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const fetchOptions: RequestInit = { signal: controller.signal };
    if (device.authToken) {
      fetchOptions.headers = { Authorization: `Bearer ${device.authToken}` };
    }
    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as RemoteDeviceInfo;
  } finally {
    clearTimeout(timeout);
  }
}

export const useDevicesStore = create<DevicesStoreState>()((set, get) => ({
  devices: {},
  refreshing: false,

  refreshAll: async (savedDevices) => {
    set({ refreshing: true });
    const results = await Promise.allSettled(
      savedDevices.map(async (device) => {
        try {
          const info = await fetchDeviceInfo(device);
          return {
            key: device.id,
            state: {
              deviceId: device.id,
              config: device,
              online: true,
              lastChecked: Date.now(),
              info,
              error: null,
            } satisfies DeviceState,
          };
        } catch (err) {
          return {
            key: device.id,
            state: {
              deviceId: device.id,
              config: device,
              online: false,
              lastChecked: Date.now(),
              info: null,
              error: err instanceof Error ? err.message : "Unknown error",
            } satisfies DeviceState,
          };
        }
      }),
    );

    const devices: Record<string, DeviceState> = {};
    for (const result of results) {
      if (result.status === "fulfilled") {
        devices[result.value.key] = result.value.state;
      }
    }
    set({ devices, refreshing: false });
  },

  refreshDevice: async (device) => {
    try {
      const info = await fetchDeviceInfo(device);
      set((state) => ({
        devices: {
          ...state.devices,
          [device.id]: {
            deviceId: device.id,
            config: device,
            online: true,
            lastChecked: Date.now(),
            info,
            error: null,
          },
        },
      }));
    } catch (err) {
      set((state) => ({
        devices: {
          ...state.devices,
          [device.id]: {
            deviceId: device.id,
            config: device,
            online: false,
            lastChecked: Date.now(),
            info: null,
            error: err instanceof Error ? err.message : "Unknown error",
          },
        },
      }));
    }
  },

  clearDevices: () => set({ devices: {} }),
}));
