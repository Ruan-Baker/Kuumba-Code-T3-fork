import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Monitor, PlusIcon, Mic, Trash2, Wifi, WifiOff } from "lucide-react";
import { PageHeader } from "~/components/PageHeader";
import { useSettingsStore } from "~/stores/settingsStore";
import { useConnectionStore } from "~/stores/connectionStore";
import { cn } from "~/lib/utils";
import { encryptAndStore, loadStoredKey, hasStoredKey } from "~/lib/voice/crypto";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const THEME_OPTIONS = [
  { value: "system" as const, label: "System", description: "Match your OS appearance." },
  { value: "light" as const, label: "Light", description: "Always use the light theme." },
  { value: "dark" as const, label: "Dark", description: "Always use the dark theme." },
];

const TTS_SPEED_OPTIONS = [
  { value: 1 as const, label: "1x" },
  { value: 1.5 as const, label: "1.5x" },
  { value: 2 as const, label: "2x" },
];

function SettingsPage() {
  const {
    theme, setTheme,
    ttsSpeed, setTtsSpeed,
    savedDevices, removeDevice,
  } = useSettingsStore();
  const { relayConnected, relayDevices } = useConnectionStore();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pb-10">
          {/* Appearance */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3">
              <h2 className="text-sm font-medium text-foreground">Appearance</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Choose how Kuumba Code looks on mobile.
              </p>
            </div>

            <div className="space-y-1.5">
              {THEME_OPTIONS.map((option) => {
                const selected = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "flex w-full items-start justify-between rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-primary/50 bg-primary/8"
                        : "border-border bg-background active:bg-accent",
                    )}
                    onClick={() => setTheme(option.value)}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                    {selected && (
                      <span className="mt-0.5 rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Remote Devices */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3">
              <h2 className="text-sm font-medium text-foreground">Remote Devices</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Devices running Kuumba Code that you can connect to remotely.
              </p>
            </div>

            <div className="space-y-2">
              {/* Relay server connection status */}
              {savedDevices.some((d) => d.isRelay) && (
                <div className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2",
                  relayConnected
                    ? "border-success/30 bg-success/5"
                    : "border-border bg-background",
                )}>
                  {relayConnected ? (
                    <Wifi className="size-3.5 text-success-foreground" />
                  ) : (
                    <WifiOff className="size-3.5 text-muted-foreground" />
                  )}
                  <span className={cn(
                    "text-xs font-medium",
                    relayConnected ? "text-success-foreground" : "text-muted-foreground",
                  )}>
                    {relayConnected ? "Connected to relay server" : "Connecting to relay..."}
                  </span>
                </div>
              )}

              {savedDevices.length > 0 ? (
                savedDevices.map((device) => {
                  // Find relay online status for this device
                  const relayInfo = device.isRelay
                    ? relayDevices.find((rd) => rd.deviceId === device.deviceId)
                    : undefined;
                  const isOnline = relayInfo?.online ?? false;

                  return (
                    <div
                      key={device.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
                    >
                      <div className="relative shrink-0">
                        <Monitor className="size-4 text-muted-foreground/60" />
                        {device.isRelay && (
                          <span className={cn(
                            "absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-background",
                            isOnline ? "bg-success" : "bg-muted-foreground/40",
                          )} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {device.name}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {device.isRelay
                            ? isOnline ? "Online via relay" : "Offline"
                            : `${device.host}:${device.port}`}
                        </p>
                      </div>
                      <button
                        onClick={() => removeDevice(device.id)}
                        className="flex size-7 items-center justify-center rounded-md active:bg-muted"
                      >
                        <Trash2 className="size-3.5 text-destructive-foreground" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-background px-3 py-5 text-center text-xs text-muted-foreground">
                  No remote devices configured yet.
                </div>
              )}

              <Link
                to="/connect"
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background py-2.5 text-sm font-medium text-foreground active:bg-accent"
              >
                <PlusIcon className="size-3.5" />
                Add remote device
              </Link>
            </div>
          </section>

          {/* Text-to-Speech */}
          <TTSSettings ttsSpeed={ttsSpeed} setTtsSpeed={setTtsSpeed} />

          {/* Voice Input */}
          <VoiceInputSettings />

          {/* About */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3">
              <h2 className="text-sm font-medium text-foreground">About</h2>
            </div>

            <div className="space-y-0">
              <div className="flex items-center justify-between border-b border-border/50 py-2.5">
                <span className="text-sm text-foreground">Version</span>
                <span className="font-mono text-xs text-muted-foreground">0.0.1</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-foreground">Build</span>
                <span className="font-mono text-xs text-muted-foreground">1</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function TTSSettings({ ttsSpeed, setTtsSpeed }: { ttsSpeed: 1 | 1.5 | 2; setTtsSpeed: (v: 1 | 1.5 | 2) => void }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground">Text-to-Speech</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Read AI responses aloud using the desktop's voice engine. No downloads needed.
        </p>
      </div>

      <div className="space-y-3">
        {/* Speed selector */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-foreground">Playback speed</p>
            <p className="text-xs text-muted-foreground">Audio playback rate.</p>
          </div>
          <div className="flex gap-1">
            {TTS_SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTtsSpeed(opt.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  ttsSpeed === opt.value
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground active:bg-muted",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function VoiceInputSettings() {
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHasKey(hasStoredKey());
    void loadStoredKey().then((key) => {
      if (key) setApiKey(key);
    });
  }, []);

  async function handleSaveKey() {
    setSaving(true);
    await encryptAndStore(apiKey);
    setHasKey(apiKey.length > 0);
    setSaving(false);
  }

  async function handleRemoveKey() {
    setApiKey("");
    await encryptAndStore("");
    setHasKey(false);
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground">Voice Input</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Dictate messages using speech-to-text with AI cleanup.
        </p>
      </div>

      <div className="space-y-3">
        {/* How it works */}
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
          <Mic className="size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Speech recognition</p>
            <p className="text-[11px] text-muted-foreground">Uses your device's built-in voice recognition. No downloads needed.</p>
          </div>
        </div>

        {/* OpenRouter API Key */}
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="mb-1.5 text-xs font-medium text-foreground">OpenRouter API Key</p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Optional — cleans up transcription with AI for better accuracy with dev terms (~$0.01 per 1000 dictations).
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-ring/45"
            />
            {hasKey ? (
              <button
                onClick={() => void handleRemoveKey()}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-destructive-foreground active:bg-muted"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : (
              <button
                onClick={() => void handleSaveKey()}
                disabled={saving || !apiKey.trim()}
                className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? "..." : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
