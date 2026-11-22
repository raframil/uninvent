import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@/lib/utils";

function Input({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      className={cn("flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm", className)}
      {...props}
    />
  );
}

export { Input };
