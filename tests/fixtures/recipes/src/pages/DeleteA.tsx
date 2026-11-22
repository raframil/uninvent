import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Composes the confirm-dialog recipe. Check stays silent. */
export function DeleteA() {
  return (
    <Dialog>
      <DialogContent>
        <DialogTitle>Delete?</DialogTitle>
        <Button>Cancel</Button>
        <Button>Delete</Button>
      </DialogContent>
    </Dialog>
  );
}
