import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Same composition as DeleteA, so scan can see the repetition. */
export function DeleteB() {
  return (
    <Dialog>
      <DialogContent>
        <DialogTitle>Remove?</DialogTitle>
        <Button>Cancel</Button>
        <Button>Remove</Button>
      </DialogContent>
    </Dialog>
  );
}
