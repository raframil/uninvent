export function FieldAndButton() {
  return (
    <form>
      <label htmlFor="email">Email</label>
      <input id="email" />
      <p>Required</p>
      <button type="submit">Save</button>
    </form>
  );
}
