/**
 * A file dropped on a page that doesn't take it is opened by Chrome, which would replace the
 * side panel with the file. Only a drop zone (`[data-dropzone]`) takes files, so a file dragged
 * anywhere else is refused (the "not allowed" cursor) and its drop ignored. Drags of text (into
 * a field) are left alone.
 */
export function guardFileDrops(target: Window = window): () => void {
  const refused = (event: DragEvent) =>
    Boolean(event.dataTransfer?.types.includes('Files')) &&
    !(event.target instanceof Element && event.target.closest('[data-dropzone]'));
  const onDragOver = (event: DragEvent) => {
    if (!refused(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'none';
  };
  const onDrop = (event: DragEvent) => {
    if (refused(event)) event.preventDefault();
  };
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
