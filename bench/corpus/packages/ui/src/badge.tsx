import type { ReactNode } from "react";

export function Badge({ loading = false, children }: { loading?: boolean; children?: ReactNode }) {
  return (
    <span>
      {loading ? "…" : null}
      {children}
    </span>
  );
}
