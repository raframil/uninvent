type Tone = "neutral" | "info";

export interface BadgeProps {
  tone?: Tone;
  children?: string;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  return <span data-tone={tone}>{children}</span>;
}
