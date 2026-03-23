/**
 * Remote device discovery via relay-based presence.
 *
 * Devices register with a relay server and the relay tracks who is online.
 */
import { useEffect, useRef, useState } from "react";
import { RelayTransport, type PairedDevice } from "~/lib/relay-transport";

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
