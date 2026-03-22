import { StickyNoteIcon, XIcon, GripHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SidebarMenuAction } from "./ui/sidebar";
import { useProjectNotesStore } from "../projectNotesStore";
import { useNotesFloatingStore } from "../lib/notesFloatingStore";
import { createPortal } from "react-dom";
import { NotesEditor } from "./notes/NotesEditor";

// ── Sidebar button — toggles floating notes for a project ───────────

interface ProjectNotesPopoverProps {
  projectCwd: string;
  projectName: string;
}

export function ProjectNotesPopover({ projectCwd, projectName }: ProjectNotesPopoverProps) {
  const { openProject, toggle } = useNotesFloatingStore();
  const isOpen = openProject?.cwd === projectCwd;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuAction
            render={
              <button
                type="button"
                aria-label={`Notes for ${projectName}`}
                onClick={() => toggle(projectCwd, projectName)}
              >
                <StickyNoteIcon className="size-3.5" />
              </button>
            }
            showOnHover={!isOpen}
            className={`top-1 right-6 size-5 rounded-md p-0 ${isOpen ? "text-primary" : "text-muted-foreground/70 hover:bg-secondary hover:text-foreground"}`}
          />
        }
      />
      <TooltipPopup side="top">Project notes</TooltipPopup>
    </Tooltip>
  );
}

// ── Floating notes panel — rendered via portal ──────────────────────

export function FloatingNotesPanel() {
  const { openProject, close } = useNotesFloatingStore();
  if (!openProject) return null;
  return <FloatingNotesPanelInner projectCwd={openProject.cwd} projectName={openProject.name} onClose={close} />;
}

function FloatingNotesPanelInner({
  projectCwd,
  projectName,
  onClose,
}: {
  projectCwd: string;
  projectName: string;
  onClose: () => void;
}) {
  const { notesByCwd, loadingCwds, loadNotes, setEditorState } = useProjectNotesStore();
  const notes = notesByCwd[projectCwd];
  const isLoading = loadingCwds.has(projectCwd);
  const editorState = notes?.editorState ?? null;

  const [pos, setPos] = useState({ x: 320, y: 80 });
  const [size, setSize] = useState({ w: 320, h: 360 });

  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizing = useRef<string | null>(null);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // Track editor key to remount when project changes or initial load finishes
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    void loadNotes(projectCwd);
  }, [projectCwd, loadNotes]);

  // Remount editor when notes finish loading for the first time
  const prevLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      setEditorKey((k) => k + 1);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading]);

  const handleChange = useCallback(
    (serialized: string) => {
      setEditorState(projectCwd, serialized);
    },
    [projectCwd, setEditorState],
  );

  // ── Drag ───────────────────────────────────────────────────────────

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: Math.max(0, ev.clientX - dragOffset.current.x), y: Math.max(0, ev.clientY - dragOffset.current.y) });
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  // ── Resize ─────────────────────────────────────────────────────────

  const onResizeStart = useCallback((e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = handle;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - resizeStart.current.x;
      const dy = ev.clientY - resizeStart.current.y;
      const h = resizing.current;
      let newW = resizeStart.current.w, newH = resizeStart.current.h, newX = resizeStart.current.px, newY = resizeStart.current.py;
      if (h.includes("e")) newW = Math.max(240, resizeStart.current.w + dx);
      if (h.includes("w")) { newW = Math.max(240, resizeStart.current.w - dx); newX = resizeStart.current.px + dx; }
      if (h.includes("s")) newH = Math.max(200, resizeStart.current.h + dy);
      if (h.includes("n")) { newH = Math.max(200, resizeStart.current.h - dy); newY = resizeStart.current.py + dy; }
      setSize({ w: newW, h: newH });
      setPos({ x: Math.max(0, newX), y: Math.max(0, newY) });
    };
    const onUp = () => { resizing.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [size, pos]);

  const edge = "4px";
  const corner = "8px";

  return createPortal(
    <div
      className="fixed z-50 flex flex-col rounded-xl border border-border bg-card shadow-2xl shadow-black/20 overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none border-b border-border/50 bg-muted/30 shrink-0"
        onMouseDown={onDragStart}
      >
        <GripHorizontalIcon className="size-3 text-muted-foreground/40 shrink-0" />
        <span className="text-[13px] font-medium text-foreground truncate flex-1">{projectName}</span>
        <button type="button" onClick={onClose} onMouseDown={(e) => e.stopPropagation()} className="flex items-center justify-center size-5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary/60 transition-colors" aria-label="Close notes">
          <XIcon className="size-3.5" />
        </button>
      </div>

      {/* Editor */}
      {isLoading && !notes ? (
        <div className="flex-1 flex items-center justify-center"><p className="text-xs text-muted-foreground">Loading...</p></div>
      ) : (
        <NotesEditor
          key={editorKey}
          initialEditorState={editorState}
          externalState={editorState}
          onChange={handleChange}
          toolbarSize="compact"
          autoFocus
        />
      )}

      {/* Resize handles */}
      <div className="absolute top-0 left-0 right-0 cursor-n-resize z-10" style={{ height: edge }} onMouseDown={(e) => onResizeStart(e, "n")} />
      <div className="absolute bottom-0 left-0 right-0 cursor-s-resize z-10" style={{ height: edge }} onMouseDown={(e) => onResizeStart(e, "s")} />
      <div className="absolute top-0 left-0 bottom-0 cursor-w-resize z-10" style={{ width: edge }} onMouseDown={(e) => onResizeStart(e, "w")} />
      <div className="absolute top-0 right-0 bottom-0 cursor-e-resize z-10" style={{ width: edge }} onMouseDown={(e) => onResizeStart(e, "e")} />
      <div className="absolute top-0 left-0 cursor-nw-resize z-10" style={{ width: corner, height: corner }} onMouseDown={(e) => onResizeStart(e, "nw")} />
      <div className="absolute top-0 right-0 cursor-ne-resize z-10" style={{ width: corner, height: corner }} onMouseDown={(e) => onResizeStart(e, "ne")} />
      <div className="absolute bottom-0 left-0 cursor-sw-resize z-10" style={{ width: corner, height: corner }} onMouseDown={(e) => onResizeStart(e, "sw")} />
      <div className="absolute bottom-0 right-0 cursor-se-resize z-10" style={{ width: corner, height: corner }} onMouseDown={(e) => onResizeStart(e, "se")} />
    </div>,
    document.body,
  );
}
