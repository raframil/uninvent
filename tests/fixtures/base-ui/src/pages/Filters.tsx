/** A raw select and textarea. The catalog names Select and Textarea. */
export function Filters() {
  return (
    <form>
      <select defaultValue="open">
        <option value="open">Open</option>
      </select>
      <textarea placeholder="Note" />
    </form>
  );
}
