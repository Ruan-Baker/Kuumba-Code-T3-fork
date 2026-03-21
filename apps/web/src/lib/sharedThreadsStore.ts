/**
 * Lightweight store tracking which threads are remotely shared.
 * Used by the sidebar to show a green dot next to shared sessions.
 */
import { create } from "zustand";

interface SharedThreadsState {
  sharedThreadIds: Set<string>;
  setShared: (threadId: string, shared: boolean) => void;
}

export const useSharedThreadsStore = create<SharedThreadsState>((set) => ({
  sharedThreadIds: new Set(),
  setShared: (threadId, shared) =>
    set((state) => {
      const next = new Set(state.sharedThreadIds);
      if (shared) {
        next.add(threadId);
      } else {
        next.delete(threadId);
      }
      return { sharedThreadIds: next };
    }),
}));
