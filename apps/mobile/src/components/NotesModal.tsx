import { useEffect, useRef, useState, useCallback } from "react";
import { X, Plus, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotesStore } from "~/stores/notesStore";
interface Transport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

interface NotesModalProps {
  open: boolean;
  onClose: () => void;
  transport: Transport | null;
  projectCwd: string;
  projectName: string;
}

export function NotesModal({
  open,
  onClose,
  transport,
  projectCwd,
  projectName,
}: NotesModalProps) {
  const {
    notes, loading, load, save, setText,
    addTodo, toggleTodo, removeTodo, updateTodoLabel, moveTodo, reset,
  } = useNotesStore();

  const [newTodoText, setNewTodoText] = useState("");
  const newTodoRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load notes on open
  useEffect(() => {
    if (open && transport && projectCwd) {
      void load(transport, projectCwd);
    }
    if (!open) reset();
  }, [open, transport, projectCwd, load, reset]);

  // Auto-save on changes (debounced)
  const triggerSave = useCallback(() => {
    if (!transport || !projectCwd) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void save(transport, projectCwd);
    }, 800);
  }, [transport, projectCwd, save]);

  useEffect(() => {
    if (notes && open) triggerSave();
  }, [notes, open, triggerSave]);

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open) return null;

  const sortedTodos = notes ? [...notes.todos].sort((a, b) => a.order - b.order) : [];

  function handleAddTodo() {
    const label = newTodoText.trim();
    if (!label) return;
    addTodo(label);
    setNewTodoText("");
    setTimeout(() => newTodoRef.current?.focus(), 0);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-background">
        {/* Handle */}
        <div className="flex justify-center pb-1.5 pt-2.5">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-1">
          <div className="min-w-0 flex-1">
            <span className="text-base font-semibold text-foreground">Notes</span>
            <span className="ml-2 truncate text-xs text-muted-foreground">{projectName}</span>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full bg-muted active:bg-muted/80"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {loading && !notes ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading notes...</p>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Free-form notes */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Notes
                </label>
                <textarea
                  className="w-full min-h-[100px] max-h-[200px] resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-ring/45"
                  placeholder="Type your notes here..."
                  value={notes?.text ?? ""}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>

              {/* Checklist */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Checklist
                </label>
                <div className="flex flex-col gap-1">
                  {sortedTodos.map((todo, index) => (
                    <div
                      key={todo.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 active:bg-muted/50"
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleTodo(todo.id)}
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded border-2",
                          todo.done
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {todo.done && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-primary-foreground">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>

                      {/* Label */}
                      <input
                        className={cn(
                          "min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none",
                          todo.done && "text-muted-foreground line-through",
                        )}
                        value={todo.label}
                        onChange={(e) => updateTodoLabel(todo.id, e.target.value)}
                      />

                      {/* Actions */}
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => moveTodo(todo.id, "up")}
                          disabled={index === 0}
                          className="flex size-6 items-center justify-center text-muted-foreground disabled:opacity-20"
                        >
                          <ChevronUp className="size-3" />
                        </button>
                        <button
                          onClick={() => moveTodo(todo.id, "down")}
                          disabled={index === sortedTodos.length - 1}
                          className="flex size-6 items-center justify-center text-muted-foreground disabled:opacity-20"
                        >
                          <ChevronDown className="size-3" />
                        </button>
                        <button
                          onClick={() => removeTodo(todo.id)}
                          className="flex size-6 items-center justify-center text-muted-foreground active:text-destructive-foreground"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add new todo */}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    ref={newTodoRef}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-ring/45"
                    placeholder="Add item..."
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddTodo(); }
                    }}
                  />
                  <button
                    onClick={handleAddTodo}
                    className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground active:bg-muted/80"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
