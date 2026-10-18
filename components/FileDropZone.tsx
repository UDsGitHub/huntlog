import { useState, type DragEvent, type InputHTMLAttributes, type RefObject } from 'react';
import { carriesFiles } from './dropGuard';
import { FileIcon, UploadIcon } from './icons';

interface Props {
  inputRef: RefObject<HTMLInputElement>;
  /** The file input's id. */
  id: string;
  /** Names the field for screen readers; the zone itself says what it's for. */
  label: string;
  accept: string;
  /** The picked file, shown in the zone with a line of details (format, size). */
  file: { name: string; detail: string } | null;
  /** Mid-action (an upload, an import): a drop or pick is ignored. */
  busy?: boolean;
  invalid?: boolean;
  onPick: (file: File) => void;
  /** A drop that can't be taken, e.g. more than one file. */
  onError: (message: string) => void;
  /** More attributes for the input, e.g. its description and invalid state. */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

/**
 * Choosing one file (spec §4.6): a dashed drop zone ("Choose a file or drag it here"), clickable
 * as a whole, with a visible Choose file link. The file input is visually hidden but focusable:
 * the zone is its label, so a click anywhere opens the picker and the zone shows its focus. A
 * drop of exactly one file picks it (`[data-dropzone]` lets `guardFileDrops` allow it here).
 */
export function FileDropZone({
  inputRef,
  id,
  label,
  accept,
  file,
  busy = false,
  invalid = false,
  onPick,
  onError,
  inputProps,
}: Props) {
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent) {
    // Only drags that carry files light the zone up (not a text selection).
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      onError('Drop one file at a time.');
      return;
    }
    // The picker's own value no longer matches: clear it, so picking that file again still counts.
    if (inputRef.current) inputRef.current.value = '';
    onPick(files[0]!);
    inputRef.current?.focus();
  }

  return (
    <>
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        aria-labelledby={`${id}-label`}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked && !busy) onPick(picked);
        }}
        className="peer sr-only"
        {...inputProps}
      />
      <label
        htmlFor={id}
        data-dropzone=""
        onDragEnter={(event) => carriesFiles(event.dataTransfer) && setDragging(true)}
        onDragOver={(event) => {
          if (!carriesFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={onDrop}
        className={`group flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:bg-accent/50 ${
          dragging ? 'border-primary bg-accent' : invalid ? 'border-destructive' : 'border-input'
        }`}
      >
        {file ? (
          <>
            <FileIcon className="size-5 text-muted-foreground" />
            <span id={`${id}-chosen`} className="flex min-w-0 flex-col">
              <span className="text-sm font-medium break-all">{file.name}</span>
              <span className="text-xs text-muted-foreground">{file.detail}</span>
            </span>
            <span
              aria-hidden="true"
              className="btn btn-link pointer-events-none group-hover:underline"
            >
              Change file
            </span>
          </>
        ) : (
          <>
            <UploadIcon className="size-5 text-muted-foreground" />
            <span className="text-sm">
              {dragging ? 'Drop it here' : 'Choose a file or drag it here'}
            </span>
            <span
              aria-hidden="true"
              className="btn btn-link pointer-events-none group-hover:underline"
            >
              Choose file
            </span>
          </>
        )}
      </label>
    </>
  );
}
