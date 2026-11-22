import { Button } from "@/components/ui/button";

export function SaveButton({ pending }: { pending?: boolean }) {
  return (
    <Button disabled={pending}>
      {pending ? <span className="mr-2 inline-block size-3 animate-spin" /> : null}
      Save
    </Button>
  );
}
