import type { ReactNode } from "react";

type DefinitionGridItem = {
  label: string;
  value: ReactNode;
};

type DefinitionGridProps = {
  items: DefinitionGridItem[];
  testId?: string;
  variant?: "meta" | "scope";
};

export function DefinitionGrid({ items, testId, variant = "meta" }: DefinitionGridProps) {
  return (
    <dl className={variant === "scope" ? "scope-summary" : "meta"} data-testid={testId}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
