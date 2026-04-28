import type { ReactNode } from "react";

type StreamListProps<T> = {
  items: T[];
  empty: ReactNode;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  testId?: string;
};

export function StreamList<T>({ items, empty, getKey, renderItem, testId }: StreamListProps<T>) {
  return (
    <ul className="stream" data-testid={testId}>
      {items.length ? items.map((item, index) => <li key={getKey(item, index)}>{renderItem(item, index)}</li>) : <li>{empty}</li>}
    </ul>
  );
}
