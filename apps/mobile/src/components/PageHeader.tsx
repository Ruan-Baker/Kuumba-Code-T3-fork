import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

interface PageHeaderProps {
  title: string;
  backTo?: string;
}

export function PageHeader({ title, backTo = "/" }: PageHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-3 px-4 pb-3.5 pt-3">
      <Link
        to={backTo}
        className="flex size-9 items-center justify-center rounded-full border border-border active:bg-muted"
      >
        <ChevronLeft className="size-[18px] text-foreground" />
      </Link>
      <span className="text-base font-semibold text-foreground">{title}</span>
    </header>
  );
}
