/**
 * DeviceQRCode - Generates a QR code for the mobile app to scan and connect.
 *
 * Encodes the relay server URL, device ID, pairing token, and public key so
 * the mobile app can connect without any manual configuration.
 */
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CopyIcon, CheckIcon, QrCodeIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "./ui/button";
import type { PairedDevice } from "~/appSettings";

export interface DeviceQRCodeProps {
  relayUrl: string;
  deviceId: string;
  pairingToken: string;
  publicKey: string;
  /** Devices that have scanned the QR code and connected */
  pairedDevices?: PairedDevice[];
}

export function DeviceQRCode({
  relayUrl,
  deviceId,
  pairingToken,
  publicKey,
  pairedDevices = [],
}: DeviceQRCodeProps) {
  const [copied, setCopied] = useState(false);

  const connectionPayload = useMemo(
    () =>
      JSON.stringify({
        relay: relayUrl,
        id: deviceId,
        token: pairingToken,
        key: publicKey,
      }),
    [relayUrl, deviceId, pairingToken, publicKey],
  );

  const isConfigured = relayUrl.trim().length > 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(connectionPayload);
      setCopied(true);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = connectionPayload;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
    }
  };

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  return (
    <div className="flex flex-col gap-3">
      {isConfigured ? (
        <>
          {/* QR Code */}
          <div className="flex items-center justify-center rounded-lg border border-border bg-white p-4">
            <QRCodeSVG
              value={connectionPayload}
              size={180}
              level="M"
              marginSize={1}
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Scan from the Kuumba Code mobile app to connect.
          </p>

          {/* Connection string with copy */}
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-2 py-1.5 text-xs font-mono text-foreground/80 truncate">
              {relayUrl}
            </code>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleCopy()}
              className="shrink-0"
              title="Copy connection JSON"
            >
              {copied ? (
                <CheckIcon className="size-3.5 text-green-500" />
              ) : (
                <CopyIcon className="size-3.5" />
              )}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <QrCodeIcon className="size-12 text-muted-foreground/30" />
            <span className="text-xs text-muted-foreground/60">
              Set your relay server URL above to generate a QR code.
            </span>
          </div>
        </div>
      )}

      {/* Paired devices list */}
      {pairedDevices.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <SmartphoneIcon className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Paired devices ({pairedDevices.length})
            </span>
          </div>
          {pairedDevices.map((device) => (
            <div
              key={device.deviceId}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <div className="size-1.5 rounded-full bg-muted-foreground/30" />
              <span className="flex-1 text-xs text-foreground truncate">
                {device.deviceName}
              </span>
              <span className="text-[10px] text-muted-foreground">
                paired {formatLastSeen(device.pairedAt)}
              </span>
            </div>
          ))}
        </div>
      ) : isConfigured ? (
        <p className="text-[10px] text-muted-foreground/50 text-center">
          No devices paired yet. Scan the QR code from your phone to connect.
        </p>
      ) : null}
    </div>
  );
}

function formatLastSeen(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
