import type { NativeApi } from "@t3tools/contracts";
import { create } from "zustand";
import { Debouncer } from "@tanstack/react-pacer";
import { ensureNativeApi } from "./nativeApi";
import { migrateV1ToV2 } from "./components/notes/notesMigration";

// ── Types ────────────────────────────────────────────────────────────

export interface TodoItem {
  id: string;
  label: string;
  done: boolean;
  order: number;
}

export interface ProjectNotesData {
  version: 2;
  editorState: string | null; // JSON-stringified Lexical EditorState
  todos: TodoItem[];
}

const NOTES_RELATIVE_PATH = ".kuumbacode/notes.json";

function createEmptyNotes(): ProjectNotesData {
  return { version: 2, editorState: null, todos: [] };
}

// ── Store ────────────────────────────────────────────────────────────

interface ProjectNotesState {
  notesByCwd: Record<string, ProjectNotesData>;
  loadingCwds: Set<string>;
}

interface ProjectNotesActions {
  loadNotes: (cwd: string) => Promise<void>;
  setEditorState: (cwd: string, editorState: string) => void;
  setEditorStateFromRemote: (cwd: string, editorState: string) => void;
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
      { wait: 300 },
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

  // Push to connected mobile devices
  pushNotesToDevices(cwd, data);
}

function triggerSave(cwd: string, data: ProjectNotesData) {
  const debouncer = getDebouncedSave(cwd);
  debouncer.maybeExecute(cwd, data);
}

// ── Real-time sync push ──────────────────────────────────────────────

type NotesPushFn = (cwd: string, editorState: string, timestamp: number) => void;
let notesPushHandler: NotesPushFn | null = null;

/** Register a handler that pushes notes updates to mobile devices. */
export function setNotesPushHandler(handler: NotesPushFn | null): void {
  notesPushHandler = handler;
}

function pushNotesToDevices(cwd: string, data: ProjectNotesData): void {
  if (!notesPushHandler || !data.editorState) return;
  notesPushHandler(cwd, data.editorState, Date.now());
}

// ── Zustand store ────────────────────────────────────────────────────

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

          if (parsed.version === 2) {
            // v2 format — use directly
            notes = {
              version: 2,
              editorState: typeof parsed.editorState === "string" ? parsed.editorState : null,
              todos: Array.isArray(parsed.todos) ? parsed.todos : [],
            };
          } else {
            // v1 format — migrate
            const oldText = typeof parsed.text === "string" ? parsed.text : "";
            let editorState: string | null = null;
            if (oldText) {
              try {
                const migrated = migrateV1ToV2(oldText);
                editorState = JSON.stringify(migrated);
              } catch {
                editorState = null;
              }
            }
            notes = {
              version: 2,
              editorState,
              todos: Array.isArray(parsed.todos) ? parsed.todos : [],
            };
          }
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
      set((s) => ({
        notesByCwd: { ...s.notesByCwd, [cwd]: createEmptyNotes() },
        loadingCwds: new Set([...s.loadingCwds].filter((c) => c !== cwd)),
      }));
    }
  },

  setEditorState: (cwd: string, editorState: string) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      const updated = { ...existing, editorState };
      triggerSave(cwd, updated);
      return { notesByCwd: { ...s.notesByCwd, [cwd]: updated } };
    });
  },

  /** Update from remote sync — does NOT trigger save or push back. */
  setEditorStateFromRemote: (cwd: string, editorState: string) => {
    set((s) => {
      const existing = s.notesByCwd[cwd] ?? createEmptyNotes();
      return { notesByCwd: { ...s.notesByCwd, [cwd]: { ...existing, editorState } } };
    });
  },
}));
