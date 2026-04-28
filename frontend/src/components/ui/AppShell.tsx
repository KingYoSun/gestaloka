import type { PropsWithChildren, ReactNode } from "react";

type AppShellProps = PropsWithChildren<{
  header: ReactNode;
  error?: ReactNode;
}>;

export function AppShell({ header, children, error }: AppShellProps) {
  return (
    <main className="mx-auto w-[min(100%-1rem,940px)] pb-10 sm:w-[min(100%-2rem,940px)]">
      {header}
      {children}
      {error}
    </main>
  );
}
