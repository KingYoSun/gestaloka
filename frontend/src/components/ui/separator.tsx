import * as React from "react";
import { cn } from "@/lib/utils";

function Separator({ className, orientation = "horizontal", ...props }: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      role="separator"
      {...props}
    />
  );
}

export { Separator };
