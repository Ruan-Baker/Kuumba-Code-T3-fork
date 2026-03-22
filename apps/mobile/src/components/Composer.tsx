import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, Square, Plus, X } from "lucide-react";
import { cn, generateId } from "~/lib/utils";
import { ComposerMenu } from "./ComposerMenu";
import { VoiceRecorder } from "./VoiceRecorder";

interface ImageAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

interface ComposerProps {
  disabled?: boolean | undefined;
  hasSession?: boolean | undefined;
  isWorking?: boolean | undefined;
  isUltrathink?: boolean | undefined;
  placeholder?: string | undefined;
  interactionMode?: "chat" | "plan" | undefined;
  runtimeMode?: "full-access" | "approval-required" | undefined;
  onSend?: ((message: string, images?: File[]) => void) | undefined;
  onStop?: (() => void) | undefined;
  onModelPickerOpen?: (() => void) | undefined;
  onToggleInteractionMode?: (() => void) | undefined;
  onToggleRuntimeMode?: (() => void) | undefined;
  onOpenNotes?: (() => void) | undefined;
  projectContext?: string | undefined;
  approvalPanel?: React.ReactNode | undefined;
}

export function Composer({
  disabled = false,
  hasSession = false,
  isWorking = false,
  isUltrathink = false,
  placeholder = "Ask anything, @tag files...",
  interactionMode = "chat",
  runtimeMode = "full-access",
  onSend,
  onStop,
  onModelPickerOpen,
  onToggleInteractionMode,
  onToggleRuntimeMode,
  onOpenNotes,
  projectContext,
  approvalPanel,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = (text.trim().length > 0 || images.length > 0) && !disabled && !isWorking;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  function handleSend() {
    if (!canSend) return;
    onSend?.(text.trim(), images.length > 0 ? images.map((i) => i.file) : undefined);
    setText("");
    // Cleanup preview URLs
    for (const img of images) URL.revokeObjectURL(img.previewUrl);
    setImages([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const handleAttachImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const newImages: ImageAttachment[] = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        newImages.push({
          id: generateId(),
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }
    }
    setImages((prev) => [...prev, ...newImages]);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  return (
    <div className="shrink-0 px-3 pb-3 pt-1.5">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <div
        className={cn("rounded-[22px] p-px", isUltrathink ? "ultrathink-frame" : "bg-border/60")}
      >
        <div className="relative rounded-[20px] border border-border bg-card">
          {/* Approval panel slot */}
          {approvalPanel && (
            <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
              {approvalPanel}
            </div>
          )}

          {/* Image previews */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="relative size-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                >
                  <img
                    src={img.previewUrl}
                    alt={img.file.name}
                    className="size-full object-cover"
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-background/90"
                  >
                    <X className="size-2.5 text-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Editor area */}
          <div className={cn("relative px-4 pb-2", approvalPanel ? "pt-2.5" : "pt-3.5")}>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || !!approvalPanel}
              placeholder={approvalPanel ? "Resolve approval to continue" : placeholder}
              rows={1}
              className={cn(
                "message-content w-full resize-none bg-transparent text-[15px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground/50",
                (disabled || !!approvalPanel) && "opacity-40",
              )}
            />
          </div>

          {/* Footer toolbar */}
          <div className="relative flex items-center justify-between px-2.5 pb-2.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground active:bg-muted/80"
              >
                <Plus className={cn("size-4 transition-transform", menuOpen && "rotate-45")} />
              </button>

              <ComposerMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                hasSession={hasSession}
                interactionMode={interactionMode}
                runtimeMode={runtimeMode}
                onAttachImage={handleAttachImage}
                onSelectModel={() => onModelPickerOpen?.()}
                onToggleInteractionMode={() => onToggleInteractionMode?.()}
                onToggleRuntimeMode={() => onToggleRuntimeMode?.()}
              />
            </div>

            <div className="flex items-center gap-1.5">
              {/* Voice recorder — mic button or nothing when recording (overlay takes over) */}
              <VoiceRecorder
                disabled={disabled}
                projectContext={projectContext}
                onTranscript={(t) => setText((prev) => (prev ? prev + " " + t : t))}
              />

              {isWorking ? (
                <button
                  onClick={onStop}
                  className="flex size-8 items-center justify-center rounded-full bg-destructive active:bg-destructive/90"
                >
                  <Square className="size-3.5 fill-white text-white" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full",
                    canSend ? "bg-primary active:bg-primary/90" : "bg-muted",
                  )}
                >
                  <ArrowUp
                    className={cn(
                      "size-4",
                      canSend ? "text-primary-foreground" : "text-muted-foreground/50",
                    )}
                  />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
