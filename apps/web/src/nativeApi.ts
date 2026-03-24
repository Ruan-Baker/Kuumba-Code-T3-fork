/**
 * NativeApi accessor — bridges legacy module-level API access with the new
 * reactive ConnectionContext store.
 *
 * Components that haven't migrated to useConnectionContext() yet can still
 * call readNativeApi() / ensureNativeApi(). These now delegate to the
 * ConnectionContext store when available, falling back to the original
 * module-level cache for bootstrap scenarios.
 */
import type { NativeApi } from "@t3tools/contracts";

import { createWsNativeApi } from "./wsNativeApi";
import { useConnectionContext } from "./connectionContext";

let cachedApi: NativeApi | undefined;
<<<<<<< Updated upstream
let remoteApi: NativeApi | undefined;
let apiVersion = 0;
const apiChangeListeners = new Set<() => void>();
=======
>>>>>>> Stashed changes

/**
 * Read the currently active NativeApi.
 *
 * Priority:
 * 1. ConnectionContext store API (if set — handles both local and remote)
 * 2. Legacy cached local API
 * 3. Create a new local WS API (bootstrap path)
 */
export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;

  // Prefer the reactive ConnectionContext store
  const contextApi = useConnectionContext.getState().api;
  if (contextApi) return contextApi;

  // Fallback: legacy bootstrap path
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
 *
 * @deprecated Use useConnectionContext().setRemote() instead for new code.
 * This function is kept for backward compatibility during migration.
 */
export function setActiveApi(api: NativeApi): void {
<<<<<<< Updated upstream
  remoteApi = api;
  apiVersion++;
  for (const listener of apiChangeListeners) listener();
=======
  // Legacy callers still expect this to work, so we update the context store too.
  // However, without a transport reference this is a partial update.
  // Prefer setRemote() on the ConnectionContext directly.
  const store = useConnectionContext.getState();
  if (store.api !== api) {
    // This is a compatibility shim — new code should not reach here
    cachedApi = api;
  }
>>>>>>> Stashed changes
}

/**
 * Reset to the local NativeApi. Clears the remote override.
 *
 * @deprecated Use useConnectionContext().resetToLocal() instead for new code.
 */
export function resetToLocalApi(): void {
<<<<<<< Updated upstream
  remoteApi = undefined;
  apiVersion++;
  for (const listener of apiChangeListeners) listener();
=======
  useConnectionContext.getState().resetToLocal();
>>>>>>> Stashed changes
}

/**
 * Check if a remote API is currently active.
 */
export function isRemoteApiActive(): boolean {
  return useConnectionContext.getState().mode === "remote";
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
