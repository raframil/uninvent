import { cn } from "@/lib/utils";

/**
 * shadcn's Base UI textarea is a native control. Base UI does not ship a Textarea part.
 */
function Textarea({ className, ...props }: { className?: string }) {
  return (
    <textarea
      className={cn("flex min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 text-sm", className)}
      {...props}
    />
  );
}

export { Textarea };
