import type { PropsWithChildren } from "react";

type PanelProps = PropsWithChildren<{
  title: string;
  wide?: boolean;
}>;

export function Panel({ title, wide = false, children }: PanelProps) {
  return (
    <article className={wide ? "card wide" : "card"}>
      <h2>{title}</h2>
      {children}
    </article>
  );
}
