export function Dialog({ open, children }: { open?: boolean; children?: unknown }) {
  return <div data-open={open}>{children as never}</div>;
}

export function DialogContent({ children }: { children?: unknown }) {
  return <div>{children as never}</div>;
}
