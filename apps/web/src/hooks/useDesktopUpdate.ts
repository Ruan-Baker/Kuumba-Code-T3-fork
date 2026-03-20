import { useCallback, useEffect, useState } from "react";
import type { DesktopUpdateState } from "@t3tools/contracts";
import { isElectron } from "~/env";
import { toastManager } from "~/components/ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "~/components/desktopUpdate.logic";

export function useDesktopUpdate() {
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);
  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;

  const checkForUpdates = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.checkForUpdates !== "function") {
      return;
    }

    void bridge
      .checkForUpdates()
      .then((nextState) => {
        setDesktopUpdateState(nextState);
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not check for updates",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      });
  }, []);

  const handlePrimaryAction = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || desktopUpdateButtonDisabled) return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateState(result.state);
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateState(result.state);
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    checkForUpdates();
  }, [checkForUpdates, desktopUpdateButtonAction, desktopUpdateButtonDisabled]);

  return {
    desktopUpdateState,
    showDesktopUpdateButton,
    desktopUpdateTooltip,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    checkForUpdates,
    handlePrimaryAction,
  };
}
