import type { PropsWithChildren } from "react";

type StatusNoticeProps = PropsWithChildren<{
  kind?: "neutral" | "caution" | "danger";
  testId?: string;
}>;

export function StatusNotice({ children, kind = "neutral", testId }: StatusNoticeProps) {
  const className = kind === "danger" ? "error" : kind === "caution" ? "turn-progress" : "turn-progress";
  return (
    <p className={className} data-testid={testId}>
      {children}
    </p>
  );
}
