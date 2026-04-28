import type { ReactNode } from "react";

type RouteTabsItem = {
  active: boolean;
  icon?: ReactNode;
  label: string;
  testId: string;
  onClick: () => void;
};

type RouteTabsProps = {
  items: RouteTabsItem[];
};

export function RouteTabs({ items }: RouteTabsProps) {
  return (
    <nav className="route-nav">
      {items.map((item) => (
        <button
          key={item.testId}
          data-testid={item.testId}
          className={item.active ? "nav-pill active" : "nav-pill"}
          onClick={item.onClick}
          type="button"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  );
}
