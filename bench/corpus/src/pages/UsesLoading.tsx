import { Button } from "@/components/ui/button";

export function UsesLoading({ pending }: { pending?: boolean }) {
  return (
    <Button loading={pending}>
      {pending ? <span className="mr-2 inline-block size-3 animate-spin" /> : null}
      Save
    </Button>
  );
}
