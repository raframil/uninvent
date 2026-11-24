/**
 * ---
 * Input:
 *   - invalid
 * ---
 */
export function Input({ invalid }: { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} />;
}
