import { cn } from "~/lib/utils";

interface SkeletonProps {
  className?: string | undefined;
}

function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className,
      )}
    />
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {/* User message skeleton */}
      <div className="flex flex-col gap-1.5 border-t border-border/30 pt-3">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      {/* Assistant message skeleton */}
      <div className="flex flex-col gap-1.5 border-t border-border/30 pt-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function DeviceSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-1.5 rounded-full" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex flex-col gap-1.5 pl-4">
        <Skeleton className="h-10 w-full rounded-[10px]" />
        <Skeleton className="h-10 w-full rounded-[10px]" />
      </div>
    </div>
  );
}

export { Skeleton };
