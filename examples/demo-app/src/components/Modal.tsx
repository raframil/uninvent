import type { ReactNode } from "react";

/**
 * Invented dialog. The catalog already has Dialog.
 * The miss is the native <dialog>, not the filename — v0.1 does not guess
 * that "Modal" means "Dialog".
 */
export function Modal({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <dialog open className="rounded-lg border p-6">
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
