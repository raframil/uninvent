import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Settings({ saving }: { saving?: boolean }) {
  return (
    <form>
      <h1>Workspace</h1>
      <label>
        Name
        <Input name="workspace" placeholder="Acme" />
      </label>
      <Button variant="outline" type="button">
        Cancel
      </Button>
      <Button loading={saving} type="submit">
        Save
      </Button>
    </form>
  );
}
