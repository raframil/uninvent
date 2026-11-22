import { Button } from "@/components/ui/button";

/** Uses Button inside a raw dialog, so this is not a from-scratch confirm. */
export function Partial() {
  return (
    <dialog open>
      <h2>Delete?</h2>
      <Button>Cancel</Button>
      <button type="button">Delete</button>
    </dialog>
  );
}
