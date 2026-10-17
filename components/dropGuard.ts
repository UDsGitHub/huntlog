/** A drag of files (from the desktop or a file manager), not of text or a link. */
export function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer?.types.includes('Files'));
}

/** A drag Chrome would open by navigating to it: files, and links or URLs. */
function opensOnDrop(dataTransfer: DataTransfer | null): boolean {
  return carriesFiles(dataTransfer) || Boolean(dataTransfer?.types.includes('text/uri-list'));
}

/** Where a dropped link goes in as text: a text field. */
const EDITABLE =
  'textarea, input:not([type=file], [type=checkbox], [type=radio], [type=button], [type=submit]), [contenteditable]:not([contenteditable="false"])';

/**
 * A file or link dropped on a page that doesn't take it is opened by Chrome, which would replace
 * the side panel with it. So a file is refused (the "not allowed" cursor, its drop ignored)
 * anywhere but a drop zone (`[data-dropzone]`), and a link anywhere but a text field, where it
 * drops in as text. Drags of plain text are left alone.
 */
export function guardFileDrops(target: Window = window): () => void {
  const refused = (event: DragEvent) => {
    if (!opensOnDrop(event.dataTransfer)) return false;
    const element = event.target instanceof Element ? event.target : null;
    if (carriesFiles(event.dataTransfer)) return !element?.closest('[data-dropzone]');
    return !element?.closest(EDITABLE);
  };
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
