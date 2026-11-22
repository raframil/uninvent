import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center rounded-md text-sm font-medium", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      outline: "border border-border bg-background",
      secondary: "bg-secondary text-secondary-foreground",
      ghost: "hover:bg-muted",
      destructive: "bg-destructive text-destructive-foreground",
      link: "text-primary underline-offset-4",
    },
    size: {
      default: "h-9 px-4",
      sm: "h-8 px-3",
      lg: "h-10 px-6",
      icon: "size-9",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
