export function Input({ invalid, placeholder }: { invalid?: boolean; placeholder?: string }) {
  return <input placeholder={placeholder} aria-invalid={invalid || undefined} />;
}
