import { useEffect, useRef, useState, useCallback } from "react";
import { useNotesStore } from "~/stores/notesStore";
import { NotesEditor } from "./notes/NotesEditor";

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
  const { notes, loading, load, save, setEditorState, reset } = useNotesStore();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Swipe-to-close state
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const dragStartY = useRef(0);

  // Track editor key to remount when notes finish loading
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (open && transport && projectCwd) {
      void load(transport, projectCwd);
    }
    if (!open) { reset(); setDragY(0); }
  }, [open, transport, projectCwd, load, reset]);

  // Remount editor when loading completes
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setEditorKey((k: number) => k + 1);
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  const triggerSave = useCallback(() => {
    if (!transport || !projectCwd) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => { void save(transport, projectCwd); }, 300);
  }, [transport, projectCwd, save]);

  const handleChange = useCallback((serialized: string) => {
    setEditorState(serialized);
    triggerSave();
  }, [setEditorState, triggerSave]);

  const editorState = notes?.editorState ?? null;

  // Swipe to close — touch events on the handle bar
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragging.current = true;
    dragStartY.current = e.touches[0]!.clientY;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dy = e.touches[0]!.clientY - dragStartY.current;
    setDragY(Math.max(0, dy));
  }, []);

  const onTouchEnd = useCallback(() => {
    dragging.current = false;
    if (dragY > 120) {
      onClose();
    }
    setDragY(0);
  }, [dragY, onClose]);

  // Also mouse-based swipe for desktop testing
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStartY.current = e.clientY;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setDragY(Math.max(0, ev.clientY - dragStartY.current));
    };
    const onUp = () => {
      dragging.current = false;
      setDragY((y: number) => { if (y > 120) { onClose(); } return 0; });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div
        ref={sheetRef}
        className="relative flex flex-col rounded-t-2xl border-t border-border bg-background transition-transform"
        style={{
          height: "80vh",
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* Swipe handle */}
        <div
          className="flex justify-center pb-1 pt-2.5 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown}
        >
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>

        {/* Sticky header */}
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-1">
          <span className="text-base font-semibold text-foreground truncate flex-1">
            {projectName || "Notes"}
          </span>
        </div>

        {/* Editor */}
        {loading && !notes ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading notes...</p>
          </div>
        ) : (
          <NotesEditor
            key={editorKey}
            initialEditorState={editorState}
            externalState={editorState}
            onChange={handleChange}
            toolbarSize="mobile"
            autoFocus
          />
        )}
      </div>
    </div>
  );
}
