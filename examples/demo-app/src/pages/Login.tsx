/**
 * Intentionally bypasses the design system.
 * `uninvent check` should flag the raw input and button.
 */
export function LoginPage() {
  return (
    <form className="mx-auto flex max-w-sm flex-col gap-3 p-8">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <input placeholder="Email" />
      <button type="submit">Continue</button>
    </form>
  );
}
