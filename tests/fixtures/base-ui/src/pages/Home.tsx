import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/** Uses the Base UI wrappers. `uninvent check` stays silent. */
export function Home() {
  return (
    <main>
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <Button>Save</Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
