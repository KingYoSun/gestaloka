import type { PropsWithChildren, ReactNode } from "react";

type AppShellProps = PropsWithChildren<{
  header: ReactNode;
  error?: ReactNode;
}>;

export function AppShell({ header, children, error }: AppShellProps) {
  return (
    <main className="shell">
      {header}
      {children}
      {error}
    </main>
  );
}
