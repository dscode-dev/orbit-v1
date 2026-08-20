import type { ReactNode } from "react";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-[var(--color-background)] text-[var(--color-foreground)]">{children}</div>;
}
