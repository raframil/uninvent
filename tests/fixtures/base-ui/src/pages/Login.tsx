/** Raw controls. The catalog's Button and Input wrap Base UI, not a `<button>`. */
export function Login() {
  return (
    <form>
      <input placeholder="Email" />
      <button type="submit">Continue</button>
    </form>
  );
}
