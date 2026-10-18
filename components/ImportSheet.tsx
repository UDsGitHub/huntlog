import { useId, useRef, useState } from 'react';
import { listApplications } from '@/lib/applications';
import { downloadCsvTemplate } from '@/lib/applicationsCsv';
import {
  countLiveData,
  mergeBackup,
  parseBackup,
  replaceWithBackup,
  SettingsRestoreError,
  type CheckedBackup,
} from '@/lib/backupImport';
import { importCsvRows, planCsvImport, type CsvPlan } from '@/lib/csvImport';
import { formatTimestampDate } from '@/lib/dates';
import { applicationCount, formatBytes, resumeCount } from '@/lib/format';
import { formatNumber } from '@/lib/numberInput';
import { listResumes } from '@/lib/resumes';
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

/** What a checked file would import: a JSON backup, or a CSV's rows. */
type Checked = { backup: CheckedBackup } | { csv: CsvPlan };

/** A file read and checked, or why it can't be imported. */
type Picked =
  | { file: File; state: 'reading' }
  | ({ file: File; state: 'ready' } & Checked)
  | { file: File; state: 'refused'; errors: string[] };

/** A CSV by its name, else a backup when it starts like JSON (spec §6: told by its contents). */
function isCsv(file: File, text: string): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return true;
  if (name.endsWith('.json')) return false;
  return !text.trimStart().startsWith('{');
}

/** Reads and checks a picked file. Never throws: what's wrong is in `errors`. */
async function readImport(file: File): Promise<Checked | { errors: string[] }> {
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
  if (!isCsv(file, text)) return parseBackup(text);
  try {
    // Checked against what's stored now, for "already logged" and resume names.
    const [applications, resumes] = await Promise.all([listApplications(), listResumes()]);
    const result = planCsvImport(text, { applications, resumes });
    return 'plan' in result ? { csv: result.plan } : { errors: [result.error] };
  } catch (error) {
    console.error('Checking the CSV failed', error);
    return { errors: ["Couldn't check this file. Try again."] };
  }
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
  // A CSV's rows already logged are imported too (spec §6: "Import them anyway").
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const action = useAction(notify);
  // Only the newest pick may show its result.
  const latest = useRef<File | null>(null);

  async function pick(file: File) {
    latest.current = file;
    action.reset();
    setDropError(null);
    setPicked({ file, state: 'reading' });
    setIncludeDuplicates(false);
    const result = await readImport(file);
    if (latest.current !== file) return;
    setPicked(
      'errors' in result
        ? { file, state: 'refused', errors: result.errors }
        : { file, state: 'ready', ...result },
    );
  }

  const backup = picked?.state === 'ready' && 'backup' in picked ? picked.backup : null;
  const csv = picked?.state === 'ready' && 'csv' in picked ? picked.csv : null;
  const csvCount = csv ? csv.rows.filter((row) => includeDuplicates || !row.duplicate).length : 0;

  async function importCsv() {
    if (!csv || action.busy || csvCount === 0) return;
    const done = await action.run(
      async () => {
        const added = await importCsvRows(csv, { includeDuplicates });
        onImported();
        notify(`Imported ${applications(added)}.`);
        return true;
      },
      () => "Couldn't import the file. Nothing was added. Try again.",
    );
    if (done) onClose();
  }

  async function start() {
    if (csv) return importCsv();
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
        setIncludeDuplicates(false);
        action.reset();
      }}
      title="Import"
      description="Restore a Huntlog backup (.json), or add applications from a spreadsheet (.csv)."
      dismissible
      footer={
        <button
          type="button"
          {...SUBMIT_SHORTCUT}
          disabled={!backup && csvCount === 0}
          // Busy: still focusable (disabling would drop focus to the page), and start() ignores it.
          aria-disabled={action.busy || undefined}
          onClick={() => void start()}
          className="btn btn-primary w-full"
        >
          {action.busy
            ? 'Importing…'
            : csv
              ? `Import ${applications(csvCount)}`
              : mode === 'replace'
                ? 'Replace all data…'
                : 'Import'}
        </button>
      }
    >
      <div className="flex min-w-0 flex-col gap-1">
        <FileDropZone
          inputRef={fileInput}
          id={`${id}-file`}
          label="File to import"
          accept=".json,.csv,application/json,text/csv"
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
                errors.length ? `${id}-errors` : (backup || csv) && `${id}-summary`,
              ]
                .filter(Boolean)
                .join(' ') || undefined,
            'aria-invalid': errors.length > 0 || undefined,
          }}
        />
        <p className="text-xs text-muted-foreground">
          A spreadsheet needs the template’s columns.{' '}
          <button type="button" onClick={downloadCsvTemplate} className="link">
            Download the CSV template
          </button>
        </p>
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
      {csv && (
        <CsvPreview
          id={`${id}-summary`}
          plan={csv}
          count={csvCount}
          includeDuplicates={includeDuplicates}
          onIncludeDuplicates={setIncludeDuplicates}
        />
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

/** "Row 4: …" lines, up to a few, then how many more. */
function RowList({ items }: { items: { row: number; text: string }[] }) {
  const more = items.length - SHOWN_ERRORS;
  return (
    <>
      <ul className="list-disc pl-5">
        {items.slice(0, SHOWN_ERRORS).map((item, i) => (
          <li key={i}>
            Row {formatNumber(item.row)}: {item.text}
          </li>
        ))}
      </ul>
      {more > 0 && <p>…and {formatNumber(more)} more.</p>}
    </>
  );
}

/**
 * A CSV's preview (spec §6), before anything is added: how many rows will be imported, which have
 * warnings, which are skipped and why, which are already logged (left out unless the user ticks
 * Import them anyway), and the columns that aren't Huntlog's.
 */
function CsvPreview({
  id,
  plan,
  count,
  includeDuplicates,
  onIncludeDuplicates,
}: {
  id: string;
  plan: CsvPlan;
  count: number;
  includeDuplicates: boolean;
  onIncludeDuplicates: (include: boolean) => void;
}) {
  const checkbox = useId();
  const duplicates = plan.rows.filter((row) => row.duplicate).length;
  const warned = plan.rows.flatMap((row) => row.warnings.map((text) => ({ row: row.row, text })));
  const skipped = plan.skipped.map((row) => ({ row: row.row, text: row.reason }));
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <p id={id} role="status">
        {count === 0 ? 'Nothing to import.' : `${applications(count)} ready to import.`}
      </p>
      {duplicates > 0 && (
        <div className="flex flex-col gap-1">
          <p>
            {applications(duplicates)} already logged (the same job posting URL, or company and
            title), so {duplicates === 1 ? 'it’s' : 'they’re'} left out.
          </p>
          <label htmlFor={checkbox} className="flex items-start gap-2">
            <input
              id={checkbox}
              type="checkbox"
              checked={includeDuplicates}
              onChange={(event) => onIncludeDuplicates(event.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            Import them anyway
          </label>
        </div>
      )}
      {warned.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Imported with a note</p>
          <div className="text-muted-foreground">
            <RowList items={warned} />
          </div>
        </div>
      )}
      {skipped.length > 0 && (
        <div className="flex flex-col gap-1 text-destructive">
          <p className="font-medium">
            {formatNumber(skipped.length)} {skipped.length === 1 ? 'row' : 'rows'} skipped
          </p>
          <RowList items={skipped} />
        </div>
      )}
      {plan.ignoredColumns.length > 0 && (
        <p className="text-muted-foreground">
          Not imported: {plan.ignoredColumns.length === 1 ? 'the column' : 'the columns'}{' '}
          {plan.ignoredColumns.map((name) => `“${name}”`).join(', ')}.
        </p>
      )}
    </div>
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
