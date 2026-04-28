import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm leading-5", {
  variants: {
    variant: {
      default: "border-border bg-card text-muted-foreground",
      destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      caution: "border-caution/40 bg-caution/10 text-caution",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div className={cn(alertVariants({ variant }), className)} role="alert" {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("text-sm leading-5", className)} {...props} />;
}

export { Alert, AlertDescription };
