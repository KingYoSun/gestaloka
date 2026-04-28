import type { PropsWithChildren } from "react";

export function ActionBar({ children }: PropsWithChildren) {
  return <div className="flex flex-wrap items-center gap-3 max-[480px]:grid max-[480px]:grid-cols-1">{children}</div>;
}
