import { useId, useRef, useState } from 'react';
import {
  countLiveData,
  mergeBackup,
  parseBackup,
  replaceWithBackup,
  SettingsRestoreError,
  type CheckedBackup,
} from '@/lib/backupImport';
import { formatTimestampDate } from '@/lib/dates';
import { applicationCount, formatBytes, resumeCount } from '@/lib/format';
import { formatNumber } from '@/lib/numberInput';
import { FileDropZone } from './FileDropZone';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';
import { SUBMIT_SHORTCUT } from './submitShortcut';
import { useAction } from './useAction';

/**
 * Past this, a file can't be read as text at all (Chrome's longest string is about 512 MB). A
 * backup of resumes that large would need to be split; with 10 MB files, it's 35 or more.
 */
const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

/** How many problems a refused file lists before "and N more". */
const SHOWN_ERRORS = 5;

type Mode = 'merge' | 'replace';

const applications = applicationCount;
const resumes = resumeCount;

/** A file read and checked, or why it can't be imported. */
type Picked =
  | { file: File; state: 'reading' }
  | { file: File; state: 'ready'; backup: CheckedBackup }
  | { file: File; state: 'refused'; errors: string[] };

/** Reads and checks a picked file. Never throws: what's wrong is in `errors`. */
async function readBackup(file: File): Promise<{ backup: CheckedBackup } | { errors: string[] }> {
  if (file.size > MAX_IMPORT_BYTES) return { errors: ['This file is too large to import.'] };
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    console.error('Reading the import failed', error);
    return { errors: ["Couldn't read this file. Check that it opens, then try again."] };
  }
  // Let "Checking the file…" paint before the check, which can take a moment for a big file.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return parseBackup(text);
}

/**
 * Import (spec §6), a sheet over Settings: pick a backup, see what it holds, then Merge it in or
 * Replace all data with it. Replace asks first, naming what it replaces and with what. Nothing is
 * written until the whole file has passed its checks.
 */
export function ImportSheet({
  open,
  onClose,
  onImported,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  /** Data changed (also when a later step failed): the app refreshes what it shows. */
  onImported: () => void;
  notify: (message: string) => void;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [mode, setMode] = useState<Mode>('merge');
  // Replace all's confirmation is open, with what's stored now (null counts: unknown).
  const [confirm, setConfirm] = useState<{
    current: { applications: number; resumes: number } | null;
  } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const action = useAction(notify);
  // Only the newest pick may show its result.
  const latest = useRef<File | null>(null);

  async function pick(file: File) {
    latest.current = file;
    action.reset();
    setDropError(null);
    setPicked({ file, state: 'reading' });
    const result = await readBackup(file);
    if (latest.current !== file) return;
    setPicked(
      'backup' in result
        ? { file, state: 'ready', backup: result.backup }
        : { file, state: 'refused', errors: result.errors },
    );
  }

  const backup = picked?.state === 'ready' ? picked.backup : null;

  async function start() {
    if (!backup || action.busy) return;
    if (mode === 'replace') {
      try {
        setConfirm({ current: await countLiveData() });
      } catch (error) {
        console.error('Counting the data failed', error);
        setConfirm({ current: null });
      }
      return;
    }
    const done = await action.run(
      async () => {
        const counts = await mergeBackup(backup);
        if (counts.changed) onImported();
        notify(
          counts.applications + counts.resumes === 0
            ? 'Everything in the backup was already here.'
            : `Backup merged: ${applications(counts.applications)} and ${resumes(counts.resumes)} added or updated.`,
        );
        return true;
      },
      () => "Couldn't import the backup. Nothing was changed. Try again.",
    );
    if (done) onClose();
  }

  async function replace() {
    if (!backup) return;
    const done = await action.run(
      async () => {
        try {
          await replaceWithBackup(backup);
        } catch (error) {
          if (error instanceof SettingsRestoreError) onImported();
          throw error;
        }
        onImported();
        notify(
          `Backup restored: ${applications(backup.applications.length)} and ${resumes(backup.resumes.length)}.`,
        );
        return true;
      },
      (cause) =>
        cause instanceof SettingsRestoreError
          ? "Your data was replaced, but the settings couldn't be restored. Check them in Settings."
          : "Couldn't import the backup. Nothing was changed. Try again.",
    );
    setConfirm(null);
    if (done) onClose();
  }

  const errors = dropError ? [dropError] : picked?.state === 'refused' ? picked.errors : [];
  return (
    <Sheet
      open={open}
      // Mid-import, the sheet stays: closing it wouldn't stop the write.
      onClose={() => !action.busy && onClose()}
      onClosed={() => {
        latest.current = null;
        setPicked(null);
        setMode('merge');
        setConfirm(null);
        setDropError(null);
        action.reset();
      }}
      title="Import"
      description="Restore a Huntlog backup (.json)."
      dismissible
      footer={
        <button
          type="button"
          {...SUBMIT_SHORTCUT}
          disabled={!backup}
          // Busy: still focusable (disabling would drop focus to the page), and start() ignores it.
          aria-disabled={action.busy || undefined}
          onClick={() => void start()}
          className="btn btn-primary w-full"
        >
          {action.busy ? 'Importing…' : mode === 'replace' ? 'Replace all data…' : 'Import'}
        </button>
      }
    >
      <div className="flex min-w-0 flex-col gap-1">
        <FileDropZone
          inputRef={fileInput}
          id={`${id}-file`}
          label="Backup file"
          accept=".json,application/json"
          file={picked && { name: picked.file.name, detail: formatBytes(picked.file.size) }}
          busy={action.busy}
          invalid={errors.length > 0}
          onPick={(file) => void pick(file)}
          onError={(message) => {
            latest.current = null;
            action.reset();
            setPicked(null);
            setDropError(message);
          }}
          inputProps={{
            'aria-describedby':
              [
                picked && `${id}-file-chosen`,
                errors.length ? `${id}-errors` : backup && `${id}-summary`,
              ]
                .filter(Boolean)
                .join(' ') || undefined,
            'aria-invalid': errors.length > 0 || undefined,
          }}
        />
      </div>
      {picked?.state === 'reading' && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking the file…
        </p>
      )}
      {errors.length > 0 && <ErrorList id={`${id}-errors`} errors={errors} />}
      {backup && (
        <>
          <p id={`${id}-summary`} role="status" className="text-sm">
            {backup.exportedAt
              ? `Backup from ${formatTimestampDate(backup.exportedAt)}: `
              : 'This backup holds '}
            {applications(backup.applications.length)} and {resumes(backup.resumes.length)}.
          </p>
          <SegmentedControl
            legend="How to import"
            options={[
              { value: 'merge', label: 'Merge' },
              { value: 'replace', label: 'Replace all' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <p className="field-hint">
            {mode === 'merge'
              ? 'Adds what’s new and updates what changed since. Nothing here is deleted, and your settings stay.'
              : 'Deletes everything here, then restores the backup, settings included.'}
          </p>
        </>
      )}
      {action.error && (
        <p role="alert" className="field-error">
          {action.error}
        </p>
      )}
      <Sheet
        open={confirm !== null}
        onClose={() => !action.busy && setConfirm(null)}
        title="Replace all data?"
        description={
          confirm &&
          backup &&
          `This replaces ${
            confirm.current
              ? `your ${applications(confirm.current.applications)} and ${resumes(confirm.current.resumes)}`
              : 'all your applications and resumes'
          } with the ${applications(backup.applications.length)} and ${resumes(backup.resumes.length)} in this backup, and restores its settings. It can't be undone.`
        }
        dismissible
        footer={
          <button
            type="button"
            aria-disabled={action.busy || undefined}
            onClick={() => void replace()}
            className="btn btn-destructive w-full"
          >
            {action.busy ? 'Replacing…' : 'Replace all data'}
          </button>
        }
      >
        {null}
      </Sheet>
    </Sheet>
  );
}

/** Why a file was refused: every problem, up to a few, then how many more. */
function ErrorList({ id, errors }: { id: string; errors: string[] }) {
  const more = errors.length - SHOWN_ERRORS;
  return (
    <div id={id} role="alert" className="flex flex-col gap-1 text-sm text-destructive">
      {errors.length === 1 ? (
        <p>{errors[0]}</p>
      ) : (
        <>
          <p>This backup can’t be imported:</p>
          <ul className="list-disc pl-5">
            {errors.slice(0, SHOWN_ERRORS).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          {more > 0 && <p>…and {formatNumber(more)} more.</p>}
        </>
      )}
    </div>
  );
}
