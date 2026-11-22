export function ArchiveProject() {
  return (
    <dialog open>
      <h2>Archive project?</h2>
      <p>You can restore it from the archive later.</p>
      <button type="button">Keep</button>
      <button type="button">Archive</button>
    </dialog>
  );
}
