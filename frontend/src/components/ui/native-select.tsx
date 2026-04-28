import * as React from "react";
import { cn } from "@/lib/utils";

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex min-h-11 w-full appearance-auto rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/80 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
