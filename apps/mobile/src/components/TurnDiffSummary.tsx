import { memo, useState } from "react";
import { ChevronDown, FolderOpen, FileIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

interface TurnDiffSummaryProps {
  files: FileChange[];
}

function buildTree(files: FileChange[]): Map<string, FileChange[]> {
  const groups = new Map<string, FileChange[]>();
  for (const file of files) {
    const parts = file.path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    const existing = groups.get(dir) ?? [];
    existing.push(file);
    groups.set(dir, existing);
  }
  return groups;
}

export const TurnDiffSummary = memo(function TurnDiffSummary({ files }: TurnDiffSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  if (files.length === 0) return null;

  const totalAdditions = files.reduce((n, f) => n + f.additions, 0);
  const totalDeletions = files.reduce((n, f) => n + f.deletions, 0);
  const tree = buildTree(files);

  return (
    <div className="my-2 rounded-xl border border-border bg-card">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left active:bg-muted/50"
      >
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
        <span className="flex-1 text-xs font-medium text-foreground">
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
        <span className="text-[11px] font-medium text-success-foreground">
          +{totalAdditions}
        </span>
        <span className="text-[11px] text-muted-foreground">/</span>
        <span className="text-[11px] font-medium text-destructive-foreground">
          -{totalDeletions}
        </span>
      </button>

      {/* File tree */}
      {expanded && (
        <div className="border-t border-border px-3.5 py-2">
          {[...tree.entries()].map(([dir, dirFiles]) => (
            <div key={dir} className="mb-1.5 last:mb-0">
              {dir !== "." && (
                <div className="flex items-center gap-1.5 py-1">
                  <FolderOpen className="size-3 text-muted-foreground/60" />
                  <span className="font-mono text-[11px] text-muted-foreground">{dir}</span>
                </div>
              )}
              {dirFiles.map((file) => {
                const fileName = file.path.split("/").pop() ?? file.path;
                return (
                  <div
                    key={file.path}
                    className={cn(
                      "flex items-center gap-1.5 py-1",
                      dir !== "." && "pl-4",
                    )}
                  >
                    <FileIcon className="size-3 text-muted-foreground/40" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                      {fileName}
                    </span>
                    <span className="text-[10px] font-medium text-success-foreground">
                      +{file.additions}
                    </span>
                    <span className="text-[10px] text-muted-foreground">/</span>
                    <span className="text-[10px] font-medium text-destructive-foreground">
                      -{file.deletions}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
