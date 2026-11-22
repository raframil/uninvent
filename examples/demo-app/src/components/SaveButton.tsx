import { Button } from "@/components/ui/button";

/**
 * Hand-rolled loading state. Button already documents `loading`.
 * `uninvent check` should name that state.
 */
export function SaveButton({ pending }: { pending?: boolean }) {
  return (
    <Button disabled={pending}>
      {pending ? (
        <span className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      Save
    </Button>
  );
}
