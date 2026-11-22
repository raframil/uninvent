import { Button } from "@/components/ui/button";

export function SiblingLoader() {
  return (
    <div>
      <Button>Save</Button>
      <Loader2 />
    </div>
  );
}

function Loader2() {
  return <svg aria-hidden viewBox="0 0 24 24" />;
}
