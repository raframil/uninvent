import { Select as SelectPrimitive } from "@base-ui/react/select";

function Select(props: SelectPrimitive.Root.Props) {
  return <SelectPrimitive.Root {...props} />;
}

function SelectTrigger(props: SelectPrimitive.Trigger.Props) {
  return <SelectPrimitive.Trigger {...props} />;
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value {...props} />;
}

export { Select, SelectTrigger, SelectValue };
