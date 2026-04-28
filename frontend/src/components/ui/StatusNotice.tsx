import type { PropsWithChildren } from "react";
import { Alert, AlertDescription } from "./alert";

type StatusNoticeProps = PropsWithChildren<{
  kind?: "neutral" | "caution" | "danger";
  testId?: string;
}>;

export function StatusNotice({ children, kind = "neutral", testId }: StatusNoticeProps) {
  return (
    <Alert variant={kind === "danger" ? "destructive" : kind === "caution" ? "caution" : "default"} data-testid={testId}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
