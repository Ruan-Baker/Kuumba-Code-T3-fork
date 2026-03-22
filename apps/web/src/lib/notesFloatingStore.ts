/**
 * Global store for the floating notes panel.
 * Tracks which project's notes are currently open.
 */
import { create } from "zustand";

interface NotesFloatingState {
  /** The project whose notes are open, or null if closed */
  openProject: { cwd: string; name: string } | null;
  open: (cwd: string, name: string) => void;
  close: () => void;
  toggle: (cwd: string, name: string) => void;
}

export const useNotesFloatingStore = create<NotesFloatingState>((set, get) => ({
  openProject: null,
  open: (cwd, name) => set({ openProject: { cwd, name } }),
  close: () => set({ openProject: null }),
  toggle: (cwd, name) => {
    const current = get().openProject;
    if (current && current.cwd === cwd) {
      set({ openProject: null });
    } else {
      set({ openProject: { cwd, name } });
    }
  },
}));
