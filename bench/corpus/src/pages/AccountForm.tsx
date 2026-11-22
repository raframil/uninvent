import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AccountForm() {
  return (
    <form>
      <h1>Your account</h1>
      <Input type="email" name="email" placeholder="you@example.com" />
      <Button variant="destructive" type="submit">
        Close account
      </Button>
    </form>
  );
}
