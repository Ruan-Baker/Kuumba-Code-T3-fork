"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "~/lib/utils";

const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent font-medium outline-none [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-5 min-w-5 px-1 text-xs",
        lg: "h-6 min-w-6 px-1.5 text-sm",
        sm: "h-4 min-w-4 px-1 text-[10px]",
      },
      variant: {
        default: "bg-primary text-primary-foreground",
        destructive: "bg-destructive text-white",
        outline: "border-input bg-background text-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        success: "bg-success/8 text-success-foreground",
        warning: "bg-warning/8 text-warning-foreground",
      },
    },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ className, size, variant }))} {...props} />;
}

export { Badge, badgeVariants };
