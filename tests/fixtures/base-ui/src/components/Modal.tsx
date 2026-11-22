import type { ReactNode } from "react";

/** Hand-rolled dialog next to a Base UI Dialog wrapper. */
export function Modal({ children }: { children?: ReactNode }) {
  return <dialog open>{children}</dialog>;
}
