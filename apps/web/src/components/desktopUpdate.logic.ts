import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "downloaded") {
    return "install";
  }
  if (state.status === "error") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return "install";
    }
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function isDesktopUpdateCheckInProgress(state: DesktopUpdateState | null): boolean {
  return state?.status === "checking";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading" || state?.status === "checking";
}

export function getDesktopUpdatePrimaryButtonLabel(state: DesktopUpdateState | null): string {
  if (!state || state.status === "idle" || state.status === "up-to-date") {
    return "Check for updates";
  }
  if (state.status === "checking") {
    return "Checking...";
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` ${Math.floor(state.downloadPercent)}%` : "";
    return `Downloading${progress}`;
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return state.status === "error" && state.errorContext === "download"
      ? "Retry download"
      : "Download update";
  }
  if (action === "install") {
    return state.status === "error" && state.errorContext === "install"
      ? "Retry install"
      : "Restart to update";
  }
  if (state.status === "error" && state.errorContext === "check") {
    return "Check again";
  }
  return "Check for updates";
}

export function getDesktopUpdateStatusMessage(state: DesktopUpdateState | null): string {
  if (!state) {
    return "Check GitHub Releases for a newer desktop build.";
  }
  if (!state.enabled) {
    return state.message ?? "Automatic updates are unavailable in this build.";
  }
  if (state.status === "checking") {
    return "Checking GitHub Releases for a newer version.";
  }
  if (state.status === "up-to-date") {
    return "You're on the latest version.";
  }
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} is ready to download.`;
  }
  if (state.status === "downloading") {
    return typeof state.downloadPercent === "number"
      ? `Downloading update ${Math.floor(state.downloadPercent)}%.`
      : "Downloading update.";
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} is downloaded and ready to install.`;
  }
  if (state.status === "error") {
    return state.message ?? "Update check failed.";
  }
  return "Check GitHub Releases for a newer version.";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "This install is using the correct architecture.";
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return "This Mac has Apple Silicon, but T3 Code is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.";
  }
  if (action === "install") {
    return "This Mac has Apple Silicon, but T3 Code is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.";
  }
  return "This Mac has Apple Silicon, but T3 Code is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    return state.message ?? "Update failed";
  }
  return "Update available";
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return result.accepted && !result.completed;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}
