import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        default: "border-slate-200 bg-slate-100 text-slate-700",
        success: "border-emerald-200 bg-emerald-100 text-emerald-800",
        warning: "border-amber-200 bg-amber-100 text-amber-900",
        danger: "border-red-200 bg-red-100 text-red-800",
        info: "border-sky-200 bg-sky-100 text-sky-800",
        outline: "border-slate-300 bg-white text-slate-700",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
