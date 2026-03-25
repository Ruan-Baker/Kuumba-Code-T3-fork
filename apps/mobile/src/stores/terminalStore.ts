/**
 * Mobile terminal store — tracks terminal output received from desktop
 * via relay push events. Read-only view of desktop terminal sessions.
 */
import { create } from "zustand";

/** Strip ANSI escape codes for clean mobile display. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

const MAX_OUTPUT_LENGTH = 50_000; // 50 KB cap per terminal

interface TerminalInfo {
  output: string;
  status: "starting" | "running" | "exited" | "error";
  cwd: string;
  exitCode?: number | null;
}

interface TerminalStoreState {
  terminals: Record<string, TerminalInfo>;
  activeTerminalId: string | null;
  visible: boolean;
}

interface TerminalStoreActions {
  handleTerminalEvent: (event: unknown) => void;
  setActiveTerminal: (id: string) => void;
  setVisible: (v: boolean) => void;
  reset: () => void;
}

type TerminalStore = TerminalStoreState & TerminalStoreActions;

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},
  activeTerminalId: null,
  visible: false,

  handleTerminalEvent: (event: unknown) => {
    const ev = event as Record<string, unknown> | undefined;
    if (!ev || typeof ev !== "object") return;

    const type = ev.type as string | undefined;
    const terminalId = (ev.terminalId as string) ?? "default";

    switch (type) {
      case "started": {
        const snapshot = ev.snapshot as Record<string, unknown> | undefined;
        const history = typeof snapshot?.history === "string" ? stripAnsi(snapshot.history) : "";
        const cwd = typeof snapshot?.cwd === "string" ? snapshot.cwd : "";
        set((state) => ({
          terminals: {
            ...state.terminals,
            [terminalId]: {
              output: history.slice(-MAX_OUTPUT_LENGTH),
              status: "running",
              cwd,
            },
          },
          activeTerminalId: state.activeTerminalId ?? terminalId,
        }));
        break;
      }
      case "output": {
        const data = typeof ev.data === "string" ? stripAnsi(ev.data) : "";
        if (!data) break;
        set((state) => {
          const existing = state.terminals[terminalId];
          if (!existing) return state;
          const newOutput = (existing.output + data).slice(-MAX_OUTPUT_LENGTH);
          return {
            terminals: {
              ...state.terminals,
              [terminalId]: { ...existing, output: newOutput },
            },
          };
        });
        break;
      }
      case "exited": {
        const exitCode = typeof ev.exitCode === "number" ? ev.exitCode : null;
        set((state) => {
          const existing = state.terminals[terminalId];
          if (!existing) return state;
          return {
            terminals: {
              ...state.terminals,
              [terminalId]: { ...existing, status: "exited", exitCode },
            },
          };
        });
        break;
      }
      case "error": {
        set((state) => {
          const existing = state.terminals[terminalId];
          if (!existing) return state;
          const msg = typeof ev.message === "string" ? `\n[Error: ${ev.message}]\n` : "";
          return {
            terminals: {
              ...state.terminals,
              [terminalId]: {
                ...existing,
                status: "error",
                output: (existing.output + msg).slice(-MAX_OUTPUT_LENGTH),
              },
            },
          };
        });
        break;
      }
      case "cleared": {
        set((state) => {
          const existing = state.terminals[terminalId];
          if (!existing) return state;
          return {
            terminals: {
              ...state.terminals,
              [terminalId]: { ...existing, output: "" },
            },
          };
        });
        break;
      }
      case "restarted": {
        set((state) => {
          const existing = state.terminals[terminalId];
          if (!existing) return state;
          return {
            terminals: {
              ...state.terminals,
              [terminalId]: { ...existing, output: "", status: "running" },
            },
          };
        });
        break;
      }
    }
  },

  setActiveTerminal: (id: string) => set({ activeTerminalId: id }),

  setVisible: (v: boolean) => set({ visible: v }),

  reset: () =>
    set({
      terminals: {},
      activeTerminalId: null,
      visible: false,
    }),
}));
