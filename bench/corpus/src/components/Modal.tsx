export function Modal({ title }: { title: string }) {
  return (
    <dialog open>
      <h2>{title}</h2>
    </dialog>
  );
}
