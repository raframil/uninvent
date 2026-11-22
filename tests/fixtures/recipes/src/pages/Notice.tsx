/** A dialog with one button is not a confirm dialog. */
export function Notice() {
  return (
    <dialog open>
      <h2>Saved</h2>
      <button type="button">Ok</button>
    </dialog>
  );
}
