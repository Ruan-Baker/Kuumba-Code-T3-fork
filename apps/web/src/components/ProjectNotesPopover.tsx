import { StickyNoteIcon, PlusIcon, XIcon, ChevronUpIcon, ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SidebarMenuAction } from "./ui/sidebar";
import { useProjectNotesStore, type TodoItem } from "../projectNotesStore";

interface ProjectNotesPopoverProps {
  projectCwd: string;
  projectName: string;
}

export function ProjectNotesPopover({ projectCwd, projectName }: ProjectNotesPopoverProps) {
  const [open, setOpen] = useState(false);
  const { notesByCwd, loadingCwds, loadNotes, setText, addTodo, toggleTodo, removeTodo, updateTodoLabel, reorderTodos } =
    useProjectNotesStore();
  const [newTodoText, setNewTodoText] = useState("");
  const newTodoInputRef = useRef<HTMLInputElement>(null);

  const notes = notesByCwd[projectCwd];
  const isLoading = loadingCwds.has(projectCwd);
  const sortedTodos = notes ? [...notes.todos].sort((a, b) => a.order - b.order) : [];

  useEffect(() => {
    if (open) {
      void loadNotes(projectCwd);
    }
  }, [open, projectCwd, loadNotes]);

  const handleAddTodo = useCallback(() => {
    const label = newTodoText.trim();
    if (!label) return;
    addTodo(projectCwd, label);
    setNewTodoText("");
    // Focus back to input for rapid entry
    setTimeout(() => newTodoInputRef.current?.focus(), 0);
  }, [newTodoText, projectCwd, addTodo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddTodo();
      }
    },
    [handleAddTodo],
  );

  const handleMoveTodo = useCallback(
    (todoId: string, direction: "up" | "down") => {
      const index = sortedTodos.findIndex((t) => t.id === todoId);
      if (index < 0) return;
      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= sortedTodos.length) return;
      const ids = sortedTodos.map((t) => t.id);
      // Swap
      [ids[index], ids[newIndex]] = [ids[newIndex]!, ids[index]!];
      reorderTodos(projectCwd, ids);
    },
    [sortedTodos, projectCwd, reorderTodos],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <SidebarMenuAction
                  render={<button type="button" aria-label={`Notes for ${projectName}`} />}
                  showOnHover
                  className="top-1 right-6 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                />
              }
            />
          }
        />
        <TooltipPopup side="top">Project notes</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        side="right"
        align="start"
        sideOffset={8}
        className="w-80 max-h-[480px]"
      >
        <div className="flex flex-col gap-3">
          <PopoverTitle className="text-sm font-semibold truncate">
            Notes: {projectName}
          </PopoverTitle>

          {isLoading && !notes ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <>
              {/* Free-form text notes */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Notes
                </label>
                <textarea
                  className="w-full min-h-[80px] max-h-[200px] resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Type your notes here..."
                  value={notes?.text ?? ""}
                  onChange={(e) => setText(projectCwd, e.target.value)}
                />
              </div>

              {/* Checklist */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Checklist
                </label>
                <div className="flex flex-col gap-1">
                  {sortedTodos.map((todo, index) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      isFirst={index === 0}
                      isLast={index === sortedTodos.length - 1}
                      onToggle={() => toggleTodo(projectCwd, todo.id)}
                      onRemove={() => removeTodo(projectCwd, todo.id)}
                      onLabelChange={(label) => updateTodoLabel(projectCwd, todo.id, label)}
                      onMove={(dir) => handleMoveTodo(todo.id, dir)}
                    />
                  ))}
                </div>

                {/* Add new todo */}
                <div className="flex items-center gap-1 mt-1.5">
                  <input
                    ref={newTodoInputRef}
                    className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Add item..."
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <button
                    type="button"
                    className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                    onClick={handleAddTodo}
                    aria-label="Add todo item"
                  >
                    <PlusIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

interface TodoRowProps {
  todo: TodoItem;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onLabelChange: (label: string) => void;
  onMove: (direction: "up" | "down") => void;
}

function TodoRow({ todo, isFirst, isLast, onToggle, onRemove, onLabelChange, onMove }: TodoRowProps) {
  return (
    <div className="group/todo flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-secondary/50">
      <Checkbox
        checked={todo.done}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
      <input
        className={`flex-1 min-w-0 bg-transparent text-xs text-foreground focus:outline-none ${
          todo.done ? "line-through text-muted-foreground" : ""
        }`}
        value={todo.label}
        onChange={(e) => onLabelChange(e.target.value)}
      />
      <div className="flex items-center opacity-0 group-hover/todo:opacity-100 transition-opacity">
        <button
          type="button"
          className="size-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
          onClick={() => onMove("up")}
          disabled={isFirst}
          aria-label="Move up"
        >
          <ChevronUpIcon className="size-3" />
        </button>
        <button
          type="button"
          className="size-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
          onClick={() => onMove("down")}
          disabled={isLast}
          aria-label="Move down"
        >
          <ChevronDownIcon className="size-3" />
        </button>
        <button
          type="button"
          className="size-4 flex items-center justify-center text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove todo"
        >
          <XIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
