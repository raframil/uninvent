import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex items-center rounded-md text-sm font-medium", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      destructive: "bg-destructive text-destructive-foreground",
      outline: "border border-border bg-background",
    },
    size: {
      default: "h-10 px-4",
      sm: "h-9 px-3",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps extends VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({ variant, size, loading, children }: ButtonProps) {
  return (
    <button className={buttonVariants({ variant, size })}>
      {loading ? "…" : null}
      {children}
    </button>
  );
}
