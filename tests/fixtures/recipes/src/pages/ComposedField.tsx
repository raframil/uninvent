import { Input } from "@/components/ui/input";

/** Uses Input, so the form-field recipe is not a miss. */
export function ComposedField() {
  return (
    <div>
      <label htmlFor="email">Email</label>
      <Input id="email" />
      <p>Required</p>
    </div>
  );
}
