import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StreamListProps<T> = {
  items: T[];
  empty: ReactNode;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  testId?: string;
};

export function StreamList<T>({ items, empty, getKey, renderItem, testId }: StreamListProps<T>) {
  return (
    <ul className="grid gap-3" data-testid={testId}>
      {items.length ? (
        items.map((item, index) => (
          <li
            key={getKey(item, index)}
            className={cn("grid min-w-0 gap-1 border-t border-border pt-3 text-sm leading-5 text-muted-foreground first:border-t-0 first:pt-0 [&_strong]:font-semibold [&_strong]:text-foreground")}
          >
            {renderItem(item, index)}
          </li>
        ))
      ) : (
        <li className="min-w-0 text-sm leading-5 text-muted-foreground">{empty}</li>
      )}
    </ul>
  );
}
