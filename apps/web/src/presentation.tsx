import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { errorMessage } from "./api.js";
import { WORLD_DAY_MS } from "@gestaloka/contracts";

export const worldTime = (at: number) =>
  `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 3 }).format(at / (at >= WORLD_DAY_MS ? WORLD_DAY_MS : 1000))}${at >= WORLD_DAY_MS ? "日" : "秒"}`;
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
