/**
 * DeviceQRCode - Shows connection info for the mobile app.
 *
 * Displays the WebSocket URL that the mobile app needs to connect.
 * A real QR code library can be added later for scan-to-connect.
 */
import { useEffect, useState } from "react";
import { CopyIcon, CheckIcon, QrCodeIcon } from "lucide-react";
import { Button } from "./ui/button";

export function DeviceQRCode() {
  const [copied, setCopied] = useState(false);

  // Derive connection info from current browser location
  // In production, this will be the Tailscale hostname + server port
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const port = typeof window !== "undefined" ? window.location.port || "3773" : "3773";

  const connectionPayload = JSON.stringify({
    host,
    port: Number(port),
    token: "",
  });

  const wsUrl = `ws://${host}:${port}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(connectionPayload);
      setCopied(true);
    } catch {
      // Fallback for non-HTTPS contexts
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
      <div className="flex items-center gap-2">
        <QrCodeIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Mobile Connection</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Scan this from the Kuumba Code mobile app, or copy the connection string manually.
      </p>

      {/* QR Code placeholder — install a QR library like 'qrcode' to render a real one */}
      <div className="flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <QrCodeIcon className="size-12 text-muted-foreground/40" />
          <span className="text-xs text-muted-foreground/60">
            QR code rendering requires a QR library.
            <br />
            Use the copy button below for now.
          </span>
        </div>
      </div>

      {/* Connection string */}
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-2 py-1.5 text-xs font-mono text-foreground/80 truncate">
          {wsUrl}
        </code>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void handleCopy()}
          className="shrink-0"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-green-500" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground/50">
        Host: {host} | Port: {port}
      </p>
    </div>
  );
}
