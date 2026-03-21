import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { QrCode, Wifi, Globe } from "lucide-react";
import { PageHeader } from "~/components/PageHeader";
import { showToast } from "~/components/Toast";
import { useSettingsStore } from "~/stores/settingsStore";

export const Route = createFileRoute("/connect")({
  component: ConnectPage,
});

function ConnectPage() {
  const navigate = useNavigate();
  const addDevice = useSettingsStore((s) => s.addDevice);

  const [mode, setMode] = useState<"relay" | "direct">("relay");

  // Relay fields
  const [relayPasteJson, setRelayPasteJson] = useState("");
  const [relayDeviceId, setRelayDeviceId] = useState("");
  const [relayPairingToken, setRelayPairingToken] = useState("");
  const [relayPublicKey, setRelayPublicKey] = useState("");
  const [relayUrl, setRelayUrl] = useState("wss://kuumba-relay-server-production.up.railway.app");
  const [relayDeviceName, setRelayDeviceName] = useState("");

  // Direct (legacy) fields
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3773");
  const [authToken, setAuthToken] = useState("");
  const [directPasteJson, setDirectPasteJson] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  function handleRelayPaste(value: string) {
    setRelayPasteJson(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed.relay) setRelayUrl(parsed.relay);
      if (parsed.id) setRelayDeviceId(parsed.id);
      if (parsed.token) setRelayPairingToken(parsed.token);
      if (parsed.key) setRelayPublicKey(parsed.key);
      if (parsed.name) setRelayDeviceName(parsed.name);
      setError(null);
    } catch {
      // Not valid JSON yet
    }
  }

  function handleDirectPaste(value: string) {
    setDirectPasteJson(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed.host) setHost(parsed.host);
      if (parsed.port) setPort(String(parsed.port));
      if (parsed.token) setAuthToken(parsed.token);
      if (parsed.deviceName) setName(parsed.deviceName);
      setError(null);
    } catch {
      // Not valid JSON yet
    }
  }

  async function handleRelayConnect() {
    if (!relayDeviceId.trim()) {
      setError("Device ID is required. Scan the QR code or paste the connection JSON.");
      return;
    }
    if (!relayPairingToken.trim()) {
      setError("Pairing token is required.");
      return;
    }
    if (!relayUrl.trim()) {
      setError("Relay server URL is required.");
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      const deviceName = relayDeviceName.trim() || `Device ${relayDeviceId.slice(0, 8)}`;
      const device: Omit<import("~/stores/settingsStore").SavedDevice, "id"> = {
        name: deviceName,
        host: "",
        port: 0,
        authToken: "",
        isRelay: true,
      };
      if (relayUrl.trim()) device.relayUrl = relayUrl.trim();
      if (relayDeviceId.trim()) device.deviceId = relayDeviceId.trim();
      if (relayPairingToken.trim()) device.pairingToken = relayPairingToken.trim();
      if (relayPublicKey.trim()) device.publicKey = relayPublicKey.trim();

      addDevice(device);

      showToast("success", `Paired with ${deviceName}`);
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save device.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDirectConnect() {
    if (!host.trim()) {
      setError("Host is required");
      return;
    }

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1) {
      setError("Invalid port number");
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      const testUrl = `http://${host.trim()}:${portNum}/api/device-info`;
      const headers: Record<string, string> = {};
      if (authToken.trim()) {
        headers["Authorization"] = `Bearer ${authToken.trim()}`;
      }
      const response = await fetch(testUrl, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        setError(`Device responded with HTTP ${response.status}`);
        setConnecting(false);
        return;
      }

      addDevice({
        name: name.trim() || host.trim(),
        host: host.trim(),
        port: portNum,
        authToken: authToken.trim(),
        isRelay: false,
      });

      showToast("success", `Connected to ${name.trim() || host.trim()}`);
      navigate({ to: "/" });
    } catch {
      addDevice({
        name: name.trim() || host.trim(),
        host: host.trim(),
        port: portNum,
        authToken: authToken.trim(),
        isRelay: false,
      });

      showToast("info", "Device saved but could not be reached. It may be offline.");
      navigate({ to: "/" });
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Add Device" />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-4 pb-8">
        {/* Mode toggle */}
        <div className="mx-auto flex rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => { setMode("relay"); setError(null); }}
            className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium transition-all ${
              mode === "relay"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            <Globe className="size-3.5" />
            Relay (anywhere)
          </button>
          <button
            type="button"
            onClick={() => { setMode("direct"); setError(null); }}
            className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium transition-all ${
              mode === "direct"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            <Wifi className="size-3.5" />
            Direct (LAN)
          </button>
        </div>

        {mode === "relay" ? (
          <>
            {/* QR Scanner placeholder — Capacitor camera plugin will go here */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative flex h-[240px] w-[240px] items-center justify-center rounded-2xl border border-border bg-muted/30">
                <div className="absolute left-0 top-0 h-9 w-9 rounded-tl-2xl border-l-[3px] border-t-[3px] border-primary" />
                <div className="absolute right-0 top-0 h-9 w-9 rounded-tr-2xl border-r-[3px] border-t-[3px] border-primary" />
                <div className="absolute bottom-0 left-0 h-9 w-9 rounded-bl-2xl border-b-[3px] border-l-[3px] border-primary" />
                <div className="absolute bottom-0 right-0 h-9 w-9 rounded-br-2xl border-b-[3px] border-r-[3px] border-primary" />
                <div className="flex flex-col items-center gap-3">
                  <QrCode className="size-10 text-muted-foreground/40" />
                  <span className="text-center text-[13px] text-muted-foreground">
                    Point camera at QR code
                    <br />
                    from desktop Settings
                  </span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3.5">
              <div className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
                or paste connection JSON
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Paste field */}
            <textarea
              value={relayPasteJson}
              onChange={(e) => handleRelayPaste(e.target.value)}
              className="box-border min-h-[72px] w-full resize-none rounded-xl border border-border bg-card p-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/40"
              placeholder='Paste JSON from desktop Settings → copy button...'
            />

            {/* Divider */}
            <div className="flex items-center gap-3.5">
              <div className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
                or enter manually
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Manual relay fields */}
            <div className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Device name</span>
                <input
                  type="text"
                  value={relayDeviceName}
                  onChange={(e) => setRelayDeviceName(e.target.value)}
                  placeholder="My Desktop"
                  className="h-11 rounded-[10px] border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/40"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Device ID</span>
                <input
                  type="text"
                  value={relayDeviceId}
                  onChange={(e) => setRelayDeviceId(e.target.value)}
                  placeholder="From desktop Settings → This Device"
                  className="h-11 rounded-[10px] border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Pairing token</span>
                <input
                  type="password"
                  value={relayPairingToken}
                  onChange={(e) => setRelayPairingToken(e.target.value)}
                  placeholder="From desktop Settings → This Device"
                  className="h-11 rounded-[10px] border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Relay server URL
                </span>
                <input
                  type="url"
                  value={relayUrl}
                  onChange={(e) => setRelayUrl(e.target.value)}
                  placeholder="wss://relay.example.com"
                  className="h-11 rounded-[10px] border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40"
                />
                <span className="text-[11px] text-muted-foreground/50">
                  Pre-filled with Kuumba Code relay. Change only if self-hosting.
                </span>
              </label>
            </div>
          </>
        ) : (
          <>
            {/* Direct/LAN mode — legacy Tailscale or local network */}
            <p className="text-center text-xs text-muted-foreground">
              Connect directly to a device on the same network.
            </p>

            {/* Paste field */}
            <textarea
              value={directPasteJson}
              onChange={(e) => handleDirectPaste(e.target.value)}
              className="box-border min-h-[72px] w-full resize-none rounded-xl border border-border bg-card p-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/40"
              placeholder='Paste JSON from desktop...'
            />

            {/* Divider */}
            <div className="flex items-center gap-3.5">
              <div className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
                or enter manually
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Manual direct fields */}
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2.5">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Device name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Desktop"
                    className="h-11 min-w-0 rounded-[10px] border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/40"
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Host</span>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.1.x"
                    className="h-11 min-w-0 rounded-[10px] border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/40"
                  />
                </label>
              </div>
              <div className="flex gap-2.5">
                <label className="flex w-20 flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Port</span>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="h-11 min-w-0 rounded-[10px] border border-border bg-card px-3 text-sm text-foreground"
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Auth token</span>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Paste token"
                    className="h-11 min-w-0 rounded-[10px] border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/40"
                  />
                </label>
              </div>
            </div>
          </>
        )}

        {error && (
          <p className="text-sm text-destructive-foreground">{error}</p>
        )}
      </div>

      {/* Connect button */}
      <div className="shrink-0 px-4 pb-8 pt-4">
        <button
          onClick={() => void (mode === "relay" ? handleRelayConnect() : handleDirectConnect())}
          disabled={connecting}
          className="h-12 w-full rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:bg-primary/90 disabled:opacity-60"
        >
          {connecting
            ? "Connecting..."
            : mode === "relay"
              ? "Pair & Save"
              : "Connect & Save"}
        </button>
      </div>
    </div>
  );
}
