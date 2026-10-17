import { useId, useRef, useState, type ReactNode } from 'react';
import { deleteAllData, LeftoversError } from '@/lib/deleteAll';
import { localeWeekStart, type WeekStart } from '@/lib/locale';
import {
  isWeeklyGoal,
  MAX_WEEKLY_GOAL,
  MIN_WEEKLY_GOAL,
  resetSettings,
  updateSettings,
  WEEK_STARTS,
  type Settings,
  type SettingsPatch,
  type Theme,
} from '@/lib/settings';
import {
  ExternalLinkIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SunIcon,
  Trash2Icon,
} from './icons';
import { Sheet } from './Sheet';
import { useSettings } from './useSettings';

/** What must be typed before data is deleted (spec §4.8). Case-sensitive; spaces around ignored. */
export const CONFIRM_WORD = 'DELETE';
const confirmed = (typed: string) => typed.trim() === CONFIRM_WORD;

/** Suggested when the goal is first turned on; the user can change it at once. */
const DEFAULT_GOAL = 5;

const DAY_NAMES: Record<WeekStart, string> = { 0: 'Sunday', 1: 'Monday', 6: 'Saturday' };

const THEME_OPTIONS: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <MonitorIcon /> },
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
];

interface Props {
  /** Data was deleted: the app returns to an empty list. */
  onDataDeleted: () => void;
  /** A short confirmation, shown as a toast. */
  notify: (message: string) => void;
  /** The Settings tab is selected. Its sheets close when it isn't (e.g. a capture switched tabs). */
  active: boolean;
}

/**
 * The Settings tab (spec §4.8): cards for the weekly goal, display, your data, and about. Every
 * change saves as it's made and applies in every open window (settings live in storage, and
 * `useSettings` follows changes from anywhere).
 */
export function SettingsPanel({ onDataDeleted, notify, active }: Props) {
  const settings = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(patch: SettingsPatch) {
    try {
      await updateSettings(patch);
      setSaveError(null);
    } catch (error) {
      console.error('Saving settings failed', error);
      setSaveError("Couldn't save that setting. Please try again.");
    }
  }

  if (!settings) return null;
  return (
    <section aria-labelledby="settings-heading" className="flex min-w-0 flex-col gap-4 pb-4">
      <h2 id="settings-heading" className="section-heading">
        Settings
      </h2>
      {saveError && (
        <p role="alert" className="field-error">
          {saveError}
        </p>
      )}
      <GoalCard goal={settings.weeklyGoal} onChange={(weeklyGoal) => void save({ weeklyGoal })} />
      <DisplayCard settings={settings} onChange={(patch) => void save(patch)} />
      <DataCard onDataDeleted={onDataDeleted} notify={notify} active={active} />
      <AboutCard />
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="card flex min-w-0 flex-col gap-3 p-4">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Digits only (spaces around allowed): "10" is a goal, "1e1", "10.0" and "-3" aren't. */
const parseGoal = (value: string) => (/^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN);

/** Weekly goal (spec §4.7): off, or a whole number of applications per week, 1 to 200. */
function GoalCard({
  goal,
  onChange,
}: {
  goal: number | undefined;
  onChange: (goal: number | undefined) => void;
}) {
  const id = useId();
  const on = goal !== undefined;
  const [typed, setTyped] = useState(goal === undefined ? '' : String(goal));
  const [error, setError] = useState<string | null>(null);
  // The goal changed elsewhere (another window, a reset, the switch): show it. A save from here
  // stores the number the field already shows, so it never overwrites what's being typed.
  const [shown, setShown] = useState(goal);
  if (goal !== shown) {
    setShown(goal);
    if (goal === undefined || parseGoal(typed) !== goal) {
      setTyped(goal === undefined ? '' : String(goal));
      setError(null);
    }
  }

  // Checked as it's typed, but saved only when the field is left or Enter is pressed: saving
  // every keystroke would store "2" and "20" on the way to an invalid "201".
  function onType(value: string) {
    setTyped(value);
    setError(
      isWeeklyGoal(parseGoal(value))
        ? null
        : `Enter a whole number from ${MIN_WEEKLY_GOAL} to ${MAX_WEEKLY_GOAL}.`,
    );
  }
  // Enter then leaving the field commits once, not twice (the stored goal updates a beat later).
  const committed = useRef(goal);
  function commit() {
    const number = parseGoal(typed);
    if (!isWeeklyGoal(number) || number === goal || number === committed.current) return;
    committed.current = number;
    onChange(number);
  }

  return (
    <Card title="Weekly goal">
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-switch-label`} className="text-sm">
          Set a weekly goal
        </span>
        <Switch
          checked={on}
          labelledBy={`${id}-switch-label`}
          onChange={(next) => onChange(next ? DEFAULT_GOAL : undefined)}
        />
      </div>
      {on && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-goal`} className="field-label">
            Applications per week
          </label>
          <input
            id={`${id}-goal`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            onChange={(event) => onType(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-goal-error` : `${id}-goal-hint`}
            className="field w-24"
          />
          {error ? (
            <p id={`${id}-goal-error`} className="field-error">
              {error}
            </p>
          ) : (
            <p id={`${id}-goal-hint`} className="field-hint">
              Stats shows how this week is going against it.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** An on/off switch (a button with role="switch"), labelled by visible text elsewhere. */
function Switch({
  checked,
  labelledBy,
  onChange,
}: {
  checked: boolean;
  labelledBy: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={`focus-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${
        checked ? 'bg-primary' : 'bg-input'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-5 rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** Theme (a three-way segmented control) and the first day of the week. */
function DisplayCard({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: SettingsPatch) => void;
}) {
  const id = useId();
  const localeDay = DAY_NAMES[localeWeekStart()];
  return (
    <Card title="Display">
      {/* Native radios: arrow keys move between them, and the group is announced as one. */}
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="field-label mb-1.5">Theme</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {THEME_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name={`${id}-theme`}
                value={option.value}
                checked={settings.theme === option.value}
                onChange={() => onChange({ theme: option.value })}
                className="sr-only"
              />
              {option.icon}
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-week`} className="field-label">
          First day of the week
        </label>
        <select
          id={`${id}-week`}
          value={settings.weekStartsOn ?? ''}
          onChange={(event) =>
            onChange({
              weekStartsOn:
                event.target.value === '' ? undefined : (Number(event.target.value) as WeekStart),
            })
          }
          className="field"
        >
          <option value="">Locale default ({localeDay})</option>
          {WEEK_STARTS.map((day) => (
            <option key={day} value={day}>
              {DAY_NAMES[day]}
            </option>
          ))}
        </select>
        <p className="field-hint">Used for This week and the weekly goal.</p>
      </div>
    </Card>
  );
}

/** Delete all data, and Reset settings (spec §4.8), each confirmed in a sheet. */
function DataCard({ onDataDeleted, notify, active }: Props) {
  const [open, setOpen] = useState<'delete' | 'reset' | null>(null);
  // Leaving the tab (a capture) closes its sheet: hidden behind another tab, it would stay modal
  // and block the panel. A delete still running reports its outcome in a toast.
  if (!active && open !== null) setOpen(null);
  const finish = (message: string) => {
    setOpen(null);
    notify(message);
  };
  return (
    <Card title="Your data">
      <p className="text-sm text-muted-foreground">
        Everything is stored only in this browser. Export and import arrive in a later version.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen('delete')} className="btn btn-destructive">
          <Trash2Icon />
          Delete all data
        </button>
        <button type="button" onClick={() => setOpen('reset')} className="btn btn-outline">
          <RotateCcwIcon />
          Reset settings
        </button>
      </div>
      <DeleteAllSheet
        open={open === 'delete'}
        onClose={() => setOpen(null)}
        onDataDeleted={onDataDeleted}
        onDone={() => finish('All your data was deleted.')}
        notify={notify}
      />
      <ResetSheet
        open={open === 'reset'}
        onClose={() => setOpen(null)}
        onDataDeleted={onDataDeleted}
        onDone={(deleted) =>
          finish(deleted ? 'Settings reset, and all your data deleted.' : 'Settings reset.')
        }
        notify={notify}
      />
    </Card>
  );
}

/** The typed confirmation: the action works only once DELETE is typed. */
function ConfirmField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        Type {CONFIRM_WORD} to confirm
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field"
      />
    </div>
  );
}

/**
 * Runs a sheet's action once at a time (a ref, so a double activation before React re-renders
 * can't start it twice), showing a failure in the sheet. `reset` forgets the error, for when the
 * sheet closes; a still-running attempt that then fails reports through `onOrphanedError` (a
 * toast), since the sheet that would say whether the data is gone has closed (e.g. a capture
 * switched tabs mid-delete).
 */
function useAction(onOrphanedError: (message: string) => void) {
  const running = useRef(false);
  const attempt = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(
    action: () => Promise<boolean>,
    describe: (cause: unknown) => string,
  ): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    const mine = ++attempt.current;
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      console.error(cause);
      if (mine === attempt.current) setError(describe(cause));
      else onOrphanedError(describe(cause));
      return false;
    } finally {
      running.current = false;
      if (mine === attempt.current) setBusy(false);
    }
  }
  function reset() {
    attempt.current++;
    running.current = false;
    setBusy(false);
    setError(null);
  }
  return { busy, error, run, reset };
}

/** Why it failed, saying plainly whether the data is gone. */
function failureMessage(cause: unknown): string {
  if (cause instanceof SettingsResetError) {
    return "Your data was deleted, but the settings couldn't be reset. Try again.";
  }
  if (cause instanceof LeftoversError) {
    return 'Your data was deleted, but a few leftovers (saved form choices, a pending capture) remain. Try again to clear them.';
  }
  return "Couldn't delete your data. Nothing was deleted. Try again.";
}

class SettingsResetError extends Error {
  constructor(cause: unknown) {
    super('Settings reset failed', { cause });
    this.name = 'SettingsResetError';
  }
}

/**
 * Deletes everything, telling the app as soon as the data is gone, even if a later step fails:
 * the app must stop showing deleted data either way.
 */
async function deleteReporting(onDataDeleted: () => void): Promise<void> {
  try {
    await deleteAllData();
  } catch (error) {
    if (error instanceof LeftoversError) onDataDeleted();
    throw error;
  }
  onDataDeleted();
}

function DeleteAllSheet({
  open,
  onClose,
  onDataDeleted,
  onDone,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  onDataDeleted: () => void;
  onDone: () => void;
  notify: (message: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const action = useAction(notify);
  const ready = confirmed(typed);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      onClosed={() => {
        setTyped('');
        action.reset();
      }}
      title="Delete all data?"
      description="This permanently deletes every application and resume, including the files. Your settings stay. It can't be undone."
      footer={
        <button
          type="button"
          disabled={!ready}
          // Busy: still focusable (disabling would drop focus to the page), and run() ignores it.
          aria-disabled={action.busy || undefined}
          onClick={async () => {
            const done = await action.run(async () => {
              await deleteReporting(onDataDeleted);
              return true;
            }, failureMessage);
            if (done) onDone();
          }}
          className="btn btn-destructive w-full"
        >
          {action.busy ? 'Deleting…' : 'Delete all data'}
        </button>
      }
    >
      <ConfirmField value={typed} onChange={setTyped} />
      {action.error && (
        <p role="alert" className="field-error">
          {action.error}
        </p>
      )}
    </Sheet>
  );
}

function ResetSheet({
  open,
  onClose,
  onDataDeleted,
  onDone,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  onDataDeleted: () => void;
  onDone: (deleted: boolean) => void;
  notify: (message: string) => void;
}) {
  const id = useId();
  const [alsoDelete, setAlsoDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const action = useAction(notify);
  const ready = !alsoDelete || confirmed(typed);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      onClosed={() => {
        setAlsoDelete(false);
        setTyped('');
        action.reset();
      }}
      title="Reset settings?"
      description="The weekly goal, first day of the week and theme go back to their defaults."
      footer={
        <button
          type="button"
          disabled={!ready}
          // Busy: still focusable (disabling would drop focus to the page), and run() ignores it.
          aria-disabled={action.busy || undefined}
          onClick={async () => {
            const deleting = alsoDelete;
            const done = await action.run(
              async () => {
                // Data first: if deleting fails, the settings stay as they were too.
                if (deleting) await deleteReporting(onDataDeleted);
                try {
                  await resetSettings();
                } catch (error) {
                  if (deleting) throw new SettingsResetError(error);
                  throw error;
                }
                return true;
              },
              (cause) =>
                deleting ? failureMessage(cause) : "Couldn't reset the settings. Try again.",
            );
            if (done) onDone(deleting);
          }}
          className={`btn w-full ${alsoDelete ? 'btn-destructive' : 'btn-primary'}`}
        >
          {action.busy
            ? 'Resetting…'
            : alsoDelete
              ? 'Reset and delete everything'
              : 'Reset settings'}
        </button>
      }
    >
      <label htmlFor={`${id}-also`} className="flex items-start gap-2 text-sm">
        <input
          id={`${id}-also`}
          type="checkbox"
          checked={alsoDelete}
          onChange={(event) => {
            setAlsoDelete(event.target.checked);
            // Never arrive pre-confirmed: unticking forgets what was typed.
            if (!event.target.checked) setTyped('');
          }}
          className="mt-0.5 size-4 accent-[var(--destructive)]"
        />
        Also delete all my data (applications and resumes)
      </label>
      {alsoDelete && <ConfirmField value={typed} onChange={setTyped} />}
      {action.error && (
        <p role="alert" className="field-error">
          {action.error}
        </p>
      )}
    </Sheet>
  );
}

/** Links to bundled pages (no network), and the version. */
function AboutCard() {
  let version = '';
  try {
    version = browser.runtime.getManifest().version;
  } catch {
    // Not available (e.g. tests): the line is left out.
  }
  const page = (path: '/privacy.html' | '/notices.html') => {
    try {
      return browser.runtime.getURL(path);
    } catch {
      return path;
    }
  };
  return (
    <Card title="About">
      <ul className="flex flex-col gap-2 text-sm">
        <li>
          <a href={page('/privacy.html')} target="_blank" rel="noreferrer" className="link">
            Privacy policy
            <ExternalLinkIcon className="ml-1 inline size-3.5 align-[-2px]" />
          </a>
        </li>
        <li>
          <a href={page('/notices.html')} target="_blank" rel="noreferrer" className="link">
            Third-party notices
            <ExternalLinkIcon className="ml-1 inline size-3.5 align-[-2px]" />
          </a>
        </li>
      </ul>
      {version && <p className="field-hint">Job Log {version}</p>}
    </Card>
  );
}
