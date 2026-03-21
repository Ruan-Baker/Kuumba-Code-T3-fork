import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { cn, generateId } from "~/lib/utils";

interface ToastItem {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

let addToastFn: ((toast: Omit<ToastItem, "id">) => void) | null = null;

export function showToast(type: ToastItem["type"], message: string) {
  addToastFn?.({ type, message });
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = generateId();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-4 pt-14">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-xl border px-4 py-3 shadow-lg",
            toast.type === "error" && "border-destructive/20 bg-destructive/10 text-destructive-foreground",
            toast.type === "success" && "border-success/20 bg-success/10 text-success-foreground",
            toast.type === "info" && "border-border bg-card text-foreground",
          )}
        >
          <span className="flex-1 text-sm">{toast.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            className="shrink-0"
          >
            <X className="size-3.5 opacity-50" />
          </button>
        </div>
      ))}
    </div>
  );
}
