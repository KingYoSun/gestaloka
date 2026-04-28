import type { PropsWithChildren } from "react";

export function ActionBar({ children }: PropsWithChildren) {
  return <div className="actions">{children}</div>;
}
