import { tv } from "tailwind-variants";

const chip = tv({
  base: "inline-flex",
  variants: { tone: { neutral: "bg-muted", info: "bg-primary" } },
  defaultVariants: { tone: "neutral" },
});

export function Chip({ tone }: { tone?: "neutral" | "info" }) {
  return <span className={chip({ tone })} />;
}
