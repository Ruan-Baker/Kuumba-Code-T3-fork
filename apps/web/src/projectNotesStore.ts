import type { NativeApi } from "@t3tools/contracts";
import { create } from "zustand";
import { Debouncer } from "@tanstack/react-pacer";
import { ensureNativeApi } from "./nativeApi";

// ── Types ────────────────────────────────────────────────────────────

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

const NOTES_RELATIVE_PATH = ".kuumbacode/notes.json";

function createEmptyNotes(): ProjectNotesData {
  return { version: 1, text: "", todos: [] };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Store ────────────────────────────────────────────────────────────

interface ProjectNotesState {
  notesByCwd: Record<string, ProjectNotesData>;
  loadingCwds: Set<string>;
}

interface ProjectNotesActions {
  loadNotes: (cwd: string) => Promise<void>;
  setText: (cwd: string, text: string) => void;
  addTodo: (cwd: string, label: string) => void;
  toggleTodo: (cwd: string, todoId: string) => void;
  removeTodo: (cwd: string, todoId: string) => void;
  updateTodoLabel: (cwd: string, todoId: string, label: string) => void;
  reorderTodos: (cwd: string, orderedIds: string[]) => void;
}

// One debouncer per project cwd
const debouncers = new Map<string, Debouncer<(cwd: string, data: ProjectNotesData) => void>>();

function getDebouncedSave(cwd: string) {
  let debouncer = debouncers.get(cwd);
  if (!debouncer) {
    debouncer = new Debouncer(
      (_cwd: string, data: ProjectNotesData) => {
        void saveNotes(_cwd, data);
      },
      { wait: 500 },
    );
    debouncers.set(cwd, debouncer);
  }
  return debouncer;
}

/** Optional override API for remote notes. Keyed by cwd. */
const apiOverrides = new Map<string, NativeApi>();

/** Set a specific NativeApi for a project cwd (used for remote notes). */
export function setNotesApiOverride(cwd: string, api: NativeApi): void {
  apiOverrides.set(cwd, api);
}

/** Remove the API override for a project cwd. */
export function clearNotesApiOverride(cwd: string): void {
  apiOverrides.delete(cwd);
}

function getApiForCwd(cwd: string): NativeApi {
  return apiOverrides.get(cwd) ?? ensureNativeApi();
}

async function saveNotes(cwd: string, data: ProjectNotesData): Promise<void> {
  try {
    const api = getApiForCwd(cwd);
    await api.projects.writeFile({
      cwd,
      relativePath: NOTES_RELATIVE_PATH,
      contents: JSON.stringify(data, null, 2),
    });
  } catch {
    // Silently fail — don't break UX for notes persistence errors
  }
}

function triggerSave(cwd: string, data: ProjectNotesData) {
  const debouncer = getDebouncedSave(cwd);
  debouncer.maybeExecute(cwd, data);
}

export const useProjectNotesStore = create<ProjectNotesState & ProjectNotesActions>((set, get) => ({
  notesByCwd: {},
  loadingCwds: new Set(),

  loadNotes: async (cwd: string) => {
    const state = get();
    if (state.loadingCwds.has(cwd)) return;

    set((s) => ({
      loadingCwds: new Set([...s.loadingCwds, cwd]),
    }));

    try {
      const api = getApiForCwd(cwd);
      const result = await api.projects.readFile({
        cwd,
        relativePath: NOTES_RELATIVE_PATH,
      });

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
                    typeof t === "object" &&
                    t !== null &&
                    "id" in t &&
                    "label" in t &&
                    "done" in t &&
                    "order" in t,
                )
              : [],
          };
        } catch {
          notes = createEmptyNotes();
        }
      } else {
        notes = createEmptyNotes();
      }

      set((s) => ({
        notesByCwd: { ...s.notesByCwd, [cwd]: notes },
        loadingCwds: new Set([...s.loadingCwds].filter((c) => c !== cwd)),
      }));
    } catch {
      // If read fails, initialize with empty notes
      set((s) => ({
        notesByCwd: { ...s.notesByCwd, [cwd]: createEmptyNotes() },
        loadingCwds: new Set([...s.loadingCwds].filter((c) => c !== cwd)),
      }));
    }
  },

  setText: (cwd: string, text: string) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      const updated = { ...existing, text };
      triggerSave(cwd, updated);
      return { notesByCwd: { ...s.notesByCwd, [cwd]: updated } };
    });
  },

  addTodo: (cwd: string, label: string) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      const maxOrder = existing.todos.reduce((max, t) => Math.max(max, t.order), -1);
      const newTodo: TodoItem = {
        id: generateId(),
        label,
        done: false,
        order: maxOrder + 1,
      };
      const updated = { ...existing, todos: [...existing.todos, newTodo] };
      triggerSave(cwd, updated);
      return { notesByCwd: { ...s.notesByCwd, [cwd]: updated } };
    });
  },

  toggleTodo: (cwd: string, todoId: string) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      const updated = {
        ...existing,
        todos: existing.todos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t)),
      };
      triggerSave(cwd, updated);
      return { notesByCwd: { ...s.notesByCwd, [cwd]: updated } };
    });
  },

  removeTodo: (cwd: string, todoId: string) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      const updated = {
        ...existing,
        todos: existing.todos.filter((t) => t.id !== todoId),
      };
      triggerSave(cwd, updated);
      return { notesByCwd: { ...s.notesByCwd, [cwd]: updated } };
    });
  },

  updateTodoLabel: (cwd: string, todoId: string, label: string) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      const updated = {
        ...existing,
        todos: existing.todos.map((t) => (t.id === todoId ? { ...t, label } : t)),
      };
      triggerSave(cwd, updated);
      return { notesByCwd: { ...s.notesByCwd, [cwd]: updated } };
    });
  },

  reorderTodos: (cwd: string, orderedIds: string[]) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      const todoMap = new Map(existing.todos.map((t) => [t.id, t]));
      const reordered = orderedIds
        .map((id, index) => {
          const todo = todoMap.get(id);
          return todo ? { ...todo, order: index } : null;
        })
        .filter((t): t is TodoItem => t !== null);
      // Add any todos not in orderedIds at the end
      const orderedSet = new Set(orderedIds);
      const remaining = existing.todos
        .filter((t) => !orderedSet.has(t.id))
        .map((t, i) => ({ ...t, order: reordered.length + i }));
      const updated = { ...existing, todos: [...reordered, ...remaining] };
      triggerSave(cwd, updated);
      return { notesByCwd: { ...s.notesByCwd, [cwd]: updated } };
    });
  },
}));
