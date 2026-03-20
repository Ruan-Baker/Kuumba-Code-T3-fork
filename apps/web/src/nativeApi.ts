import type { NativeApi } from "@t3tools/contracts";

import { createWsNativeApi } from "./wsNativeApi";

let cachedApi: NativeApi | undefined;
let remoteApi: NativeApi | undefined;

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;

  // If a remote API is active, return it instead of local
  if (remoteApi) return remoteApi;

  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  cachedApi = createWsNativeApi();
  return cachedApi;
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}

/**
 * Swap the active NativeApi to a remote-backed instance.
 * All components calling readNativeApi() will now use the remote API.
 */
export function setActiveApi(api: NativeApi): void {
  remoteApi = api;
}

/**
 * Reset to the local NativeApi. Clears the remote override.
 */
export function resetToLocalApi(): void {
  remoteApi = undefined;
}

/**
 * Check if a remote API is currently active.
 */
export function isRemoteApiActive(): boolean {
  return remoteApi !== undefined;
}
