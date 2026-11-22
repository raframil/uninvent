export function Dialog({ children }: { children?: string }) {
  return <div>{children}</div>;
}

export function DialogContent({ children }: { children?: string }) {
  return <div>{children}</div>;
}

export function DialogTitle({ children }: { children?: string }) {
  return <h2>{children}</h2>;
}

export function DialogDescription({ children }: { children?: string }) {
  return <p>{children}</p>;
}
