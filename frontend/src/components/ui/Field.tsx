import type { PropsWithChildren } from "react";
import { Label } from "./label";

type FieldProps = PropsWithChildren<{
  label: string;
  className?: string;
}>;

export function Field({ label, children, className }: FieldProps) {
  return (
    <Label className={className}>
      <span>{label}</span>
      {children}
    </Label>
  );
}
