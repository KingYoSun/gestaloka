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
    <dl className={variant === "scope" ? "grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3" : "grid gap-3"} data-testid={testId}>
      {items.map((item) => (
        <div className="grid min-w-0 gap-1" key={item.label}>
          <dt className="text-xs font-semibold leading-[18px] text-muted-foreground">{item.label}</dt>
          <dd className="m-0 min-w-0 overflow-wrap-anywhere">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
