/**
 * Hand-rolled confirm. The catalog recipe is Dialog + Button.
 * `uninvent check` reports the recipe once, not once per raw element.
 */
export function Confirm({ title, onConfirm }: { title: string; onConfirm?: () => void }) {
  return (
    <dialog open className="rounded-lg border p-6">
      <h2>{title}</h2>
      <p>This cannot be undone.</p>
      <button type="button">Cancel</button>
      <button type="button" onClick={onConfirm}>Delete</button>
    </dialog>
  );
}
