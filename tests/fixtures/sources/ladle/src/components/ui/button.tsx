import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex", {
  variants: {
    variant: {
      default: "bg-primary",
      destructive: "bg-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Button({
  variant,
  loading,
  children,
}: { loading?: boolean; children?: string } & VariantProps<typeof buttonVariants>) {
  return <button className={buttonVariants({ variant })}>{loading ? "Saving" : children}</button>;
}
