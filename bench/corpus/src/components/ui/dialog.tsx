import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

export function DialogContent({ children }: { children?: React.ReactNode }) {
  return <DialogPrimitive.Content>{children}</DialogPrimitive.Content>;
}

export function DialogTitle({ children }: { children?: React.ReactNode }) {
  return <DialogPrimitive.Title>{children}</DialogPrimitive.Title>;
}

export function DialogDescription({ children }: { children?: React.ReactNode }) {
  return <DialogPrimitive.Description>{children}</DialogPrimitive.Description>;
}
