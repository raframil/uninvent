import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CnDanger() {
  return <Button className={cn("bg-destructive text-destructive-foreground")}>Delete</Button>;
}
