/**
 * Project notes store for mobile — reads/writes .kuumbacode/notes.json
 * on the remote desktop via WebSocket transport.
 */
import { create } from "zustand";
import { WS_METHODS } from "@t3tools/contracts";
import { migrateV1ToV2 } from "~/components/notes/notesMigration";

interface Transport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface ProjectNotesData {
  version: 2;
  editorState: string | null; // JSON-stringified Lexical EditorState
  todos: never[];
}

const NOTES_PATH = ".kuumbacode/notes.json";

function createEmpty(): ProjectNotesData {
  return { version: 2, editorState: null, todos: [] };
}

// ── Real-time sync push ──────────────────────────────────────────────

type NotesPushFn = (cwd: string, editorState: string, timestamp: number) => void;
let notesPushHandler: NotesPushFn | null = null;

export function setMobileNotesPushHandler(handler: NotesPushFn | null): void {
  notesPushHandler = handler;
}

interface NotesState {
  notes: ProjectNotesData | null;
  loading: boolean;
  saving: boolean;

  load: (transport: Transport, cwd: string) => Promise<void>;
  save: (transport: Transport, cwd: string) => Promise<void>;
  setEditorState: (editorState: string) => void;
  setEditorStateFromRemote: (editorState: string) => void;
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
      if (result?.contents) {
        try {
          const parsed = JSON.parse(result.contents);

          if (parsed.version === 2) {
            notes = {
              version: 2,
              editorState: typeof parsed.editorState === "string" ? parsed.editorState : null,
              todos: [],
            };
          } else {
            // v1 migration
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
            notes = { version: 2, editorState, todos: [] };
          }
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

    // Push to desktop
    if (notesPushHandler && notes.editorState) {
      notesPushHandler(cwd, notes.editorState, Date.now());
    }
  },

  setEditorState: (editorState) =>
    set((s) => ({
      notes: s.notes ? { ...s.notes, editorState } : null,
    })),

  /** Update from remote — does NOT trigger push back. */
  setEditorStateFromRemote: (editorState) =>
    set((s) => ({
      notes: s.notes ? { ...s.notes, editorState } : null,
    })),

  reset: () => set({ notes: null, loading: false, saving: false }),
}));
