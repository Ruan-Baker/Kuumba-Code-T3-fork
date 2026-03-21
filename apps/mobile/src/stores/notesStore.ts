/**
 * Project notes store for mobile — reads/writes .kuumbacode/notes.json
 * on the remote desktop via WebSocket transport.
 */
import { create } from "zustand";
import { WS_METHODS } from "@t3tools/contracts";

interface Transport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface TodoItem {
  id: string;
  label: string;
  done: boolean;
  order: number;
}

export interface ProjectNotesData {
  version: 1;
  text: string;
  todos: TodoItem[];
}

const NOTES_PATH = ".kuumbacode/notes.json";

function createEmpty(): ProjectNotesData {
  return { version: 1, text: "", todos: [] };
}

interface NotesState {
  notes: ProjectNotesData | null;
  loading: boolean;
  saving: boolean;

  load: (transport: Transport, cwd: string) => Promise<void>;
  save: (transport: Transport, cwd: string) => Promise<void>;
  setText: (text: string) => void;
  addTodo: (label: string) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  updateTodoLabel: (id: string, label: string) => void;
  moveTodo: (id: string, direction: "up" | "down") => void;
  reset: () => void;
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: null,
  loading: false,
  saving: false,

  load: async (transport, cwd) => {
    set({ loading: true });
    try {
      const result = await transport.request<{ contents: string | null }>(
        WS_METHODS.projectsReadFile,
        { cwd, relativePath: NOTES_PATH },
      );
      let notes: ProjectNotesData;
      if (result.contents) {
        try {
          const parsed = JSON.parse(result.contents);
          notes = {
            version: 1,
            text: typeof parsed.text === "string" ? parsed.text : "",
            todos: Array.isArray(parsed.todos)
              ? parsed.todos.filter(
                  (t: unknown): t is TodoItem =>
                    typeof t === "object" && t !== null &&
                    "id" in t && "label" in t && "done" in t && "order" in t,
                )
              : [],
          };
        } catch {
          notes = createEmpty();
        }
      } else {
        notes = createEmpty();
      }
      set({ notes, loading: false });
    } catch {
      set({ notes: createEmpty(), loading: false });
    }
  },

  save: async (transport, cwd) => {
    const { notes } = get();
    if (!notes) return;
    set({ saving: true });
    try {
      await transport.request(WS_METHODS.projectsWriteFile, {
        cwd,
        relativePath: NOTES_PATH,
        contents: JSON.stringify(notes, null, 2),
      });
    } catch {
      // silent
    }
    set({ saving: false });
  },

  setText: (text) => set((s) => ({
    notes: s.notes ? { ...s.notes, text } : null,
  })),

  addTodo: (label) => set((s) => {
    if (!s.notes) return s;
    const maxOrder = s.notes.todos.reduce((m, t) => Math.max(m, t.order), -1);
    return {
      notes: {
        ...s.notes,
        todos: [...s.notes.todos, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          label,
          done: false,
          order: maxOrder + 1,
        }],
      },
    };
  }),

  toggleTodo: (id) => set((s) => ({
    notes: s.notes ? {
      ...s.notes,
      todos: s.notes.todos.map((t) => t.id === id ? { ...t, done: !t.done } : t),
    } : null,
  })),

  removeTodo: (id) => set((s) => ({
    notes: s.notes ? {
      ...s.notes,
      todos: s.notes.todos.filter((t) => t.id !== id),
    } : null,
  })),

  updateTodoLabel: (id, label) => set((s) => ({
    notes: s.notes ? {
      ...s.notes,
      todos: s.notes.todos.map((t) => t.id === id ? { ...t, label } : t),
    } : null,
  })),

  moveTodo: (id, direction) => set((s) => {
    if (!s.notes) return s;
    const sorted = [...s.notes.todos].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((t) => t.id === id);
    if (idx < 0) return s;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return s;
    const ids = sorted.map((t) => t.id);
    [ids[idx], ids[swapIdx]] = [ids[swapIdx]!, ids[idx]!];
    return {
      notes: {
        ...s.notes,
        todos: s.notes.todos.map((t) => {
          const newOrder = ids.indexOf(t.id);
          return newOrder >= 0 ? { ...t, order: newOrder } : t;
        }),
      },
    };
  }),

  reset: () => set({ notes: null, loading: false, saving: false }),
}));
