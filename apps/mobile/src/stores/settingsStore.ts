import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generateId } from "~/lib/utils";

export interface SavedDevice {
  id: string;
  name: string;
  /** Legacy direct connection fields */
  host: string;
  port: number;
  authToken: string;
  /** Relay connection fields */
  relayUrl?: string;
  deviceId?: string;
  pairingToken?: string;
  publicKey?: string;
  /** Whether this device was paired via relay */
  isRelay?: boolean;
}

interface SettingsState {
  theme: "system" | "light" | "dark";
  ttsSpeed: 1 | 1.5 | 2;
  ttsAutoDownload: boolean;
  savedDevices: SavedDevice[];

  setTheme: (theme: "system" | "light" | "dark") => void;
  setTtsSpeed: (speed: 1 | 1.5 | 2) => void;
  setTtsAutoDownload: (enabled: boolean) => void;
  addDevice: (device: Omit<SavedDevice, "id">) => void;
  updateDevice: (id: string, updates: Partial<Omit<SavedDevice, "id">>) => void;
  removeDevice: (id: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      ttsSpeed: 1.5,
      ttsAutoDownload: true,
      savedDevices: [],

      setTheme: (theme) => set({ theme }),
      setTtsSpeed: (ttsSpeed) => set({ ttsSpeed }),
      setTtsAutoDownload: (ttsAutoDownload) => set({ ttsAutoDownload }),

      addDevice: (device) =>
        set((state) => {
          // Prevent duplicates for relay devices with same deviceId
          if (device.isRelay && device.deviceId) {
            const existing = state.savedDevices.find(
              (d) => d.isRelay && d.deviceId === device.deviceId,
            );
            if (existing) return state; // Already saved
          }
          return {
            savedDevices: [...state.savedDevices, { ...device, id: generateId() }],
          };
        }),

      updateDevice: (id, updates) =>
        set((state) => ({
          savedDevices: state.savedDevices.map((d) => (d.id === id ? { ...d, ...updates } : d)),
        })),

      removeDevice: (id) =>
        set((state) => ({
          savedDevices: state.savedDevices.filter((d) => d.id !== id),
        })),
    }),
    { name: "kuumba-mobile-settings" },
  ),
);
