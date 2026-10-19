import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { errorMessage } from "./api.js";

export const worldTime = (at: number) =>
  `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 3 }).format(at / 1000)}秒`;
export const createdDate = (date: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
export function Problem({ error }: { error: unknown }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>処理を確認できませんでした</AlertTitle>
      <AlertDescription>{errorMessage(error)}</AlertDescription>
    </Alert>
  );
}
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="notice">
      {children}
    </p>
  );
}
