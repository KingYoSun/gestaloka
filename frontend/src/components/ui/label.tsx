import * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("grid gap-1.5 text-sm font-medium leading-5 text-muted-foreground", className)} {...props} />;
}

export { Label };
