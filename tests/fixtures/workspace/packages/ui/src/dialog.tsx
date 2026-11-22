import * as React from "react";

export function Dialog(props: { open?: boolean; children?: React.ReactNode }) {
  return <dialog open={props.open}>{props.children}</dialog>;
}

export function DialogContent(props: { children?: React.ReactNode }) {
  return <div>{props.children}</div>;
}

export function DialogTitle(props: { children?: React.ReactNode }) {
  return <h2>{props.children}</h2>;
}
