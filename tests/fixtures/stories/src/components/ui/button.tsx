import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex rounded-md", {
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
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends VariantProps<typeof buttonVariants> {
  loading?: boolean;
  disabled?: boolean;
  children?: string;
}

export function Button({ variant, size, loading, disabled, children }: ButtonProps) {
  return (
    <button className={buttonVariants({ variant, size })} disabled={disabled || loading}>
      {children}
    </button>
  );
}
