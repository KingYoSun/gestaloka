import type { PropsWithChildren } from "react";

type FieldProps = PropsWithChildren<{
  label: string;
}>;

export function Field({ label, children }: FieldProps) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
