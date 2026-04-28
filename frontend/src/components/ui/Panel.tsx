import type { PropsWithChildren } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

type PanelProps = PropsWithChildren<{
  title: string;
  wide?: boolean;
}>;

export function Panel({ title, wide = false, children }: PanelProps) {
  return (
    <Card className={wide ? "col-span-full" : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}
