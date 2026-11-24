import { Button as ButtonPrimitive } from "@acme/headless/button";

export function Button(props: { children?: string }) {
  return <ButtonPrimitive {...props} />;
}
