import type { DesktopRendererLogEntry } from "@t3tools/contracts";

let globalDiagnosticsInstalled = false;

function normalizeErrorDetails(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function logRendererDiagnostic(entry: DesktopRendererLogEntry): void {
  if (entry.level === "error") {
    console.error(`[${entry.scope}] ${entry.message}`, entry.details ?? "");
  } else if (entry.level === "warn") {
    console.warn(`[${entry.scope}] ${entry.message}`, entry.details ?? "");
  } else {
    console.info(`[${entry.scope}] ${entry.message}`, entry.details ?? "");
  }

  const pendingLog =
    typeof window === "undefined" ? undefined : window.desktopBridge?.logRenderer(entry);
  if (!pendingLog) {
    return;
  }

  void pendingLog.catch((error: unknown) => {
    console.error("[renderer.log] Failed to forward renderer log", error);
  });
}

export function installGlobalRendererDiagnostics(): void {
  if (globalDiagnosticsInstalled || typeof window === "undefined") {
    return;
  }
  globalDiagnosticsInstalled = true;

  window.addEventListener("error", (event) => {
    logRendererDiagnostic({
      level: "error",
      scope: "window.error",
      message: event.message || "Unhandled window error",
      details:
        normalizeErrorDetails(event.error) ?? `${event.filename}:${event.lineno}:${event.colno}`,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const entry: DesktopRendererLogEntry = {
      level: "error",
      scope: "window.unhandledrejection",
      message: "Unhandled promise rejection",
    };
    const details = normalizeErrorDetails(event.reason);
    if (details !== undefined) {
      entry.details = details;
    }
    logRendererDiagnostic(entry);
  });
}
