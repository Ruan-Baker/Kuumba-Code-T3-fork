import type { NativeApi } from "@t3tools/contracts";

import { createWsNativeApi } from "./wsNativeApi";

let cachedApi: NativeApi | undefined;
let remoteApi: NativeApi | undefined;
let apiVersion = 0;
const apiChangeListeners = new Set<() => void>();

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
  apiVersion++;
  for (const listener of apiChangeListeners) listener();
}

/**
 * Reset to the local NativeApi. Clears the remote override.
 */
export function resetToLocalApi(): void {
  remoteApi = undefined;
  apiVersion++;
  for (const listener of apiChangeListeners) listener();
}

/**
 * Check if a remote API is currently active.
 */
export function isRemoteApiActive(): boolean {
  return remoteApi !== undefined;
}

/**
 * Get the current API version (incremented on every swap).
 */
export function getApiVersion(): number {
  return apiVersion;
}

/**
 * Subscribe to API changes (swap to remote or back to local).
 * Returns an unsubscribe function.
 */
export function onApiChange(listener: () => void): () => void {
  apiChangeListeners.add(listener);
  return () => apiChangeListeners.delete(listener);
}
