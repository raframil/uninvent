import { Modal as ModalPrimitive } from "@acme/headless/modal";

export function Dialog(props: { children?: string }) {
  return <ModalPrimitive.Popup {...props} />;
}
