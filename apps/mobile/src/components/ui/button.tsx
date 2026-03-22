"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-10 px-4",
        icon: "size-10",
        lg: "h-11 px-5",
        sm: "h-8 gap-1.5 px-3",
        xs: "h-7 gap-1 rounded-md px-2 text-xs",
      },
      variant: {
        default: "border-primary bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "border-destructive bg-destructive text-white shadow-xs hover:bg-destructive/90",
        ghost: "border-transparent text-foreground hover:bg-accent",
        link: "border-transparent underline-offset-4 hover:underline",
        outline: "border-input bg-background text-foreground shadow-xs/5 hover:bg-accent/50",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90",
      },
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ className, size, variant }))} type="button" {...props} />
  );
}

export { Button, buttonVariants };
