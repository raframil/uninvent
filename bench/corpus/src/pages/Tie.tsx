import { Button } from "@/components/ui/button";

export function Tie() {
  return (
    <div>
      <Button>Save</Button>
      <span className="animate-spin" />
      <Button>Cancel</Button>
    </div>
  );
}
