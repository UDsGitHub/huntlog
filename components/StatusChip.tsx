import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { checkAppliedAt } from '@/lib/applicationInput';
import { todayLocal } from '@/lib/dates';
import { ACTIVE_STATUSES, appliedAtAction, CLOSED_STATUSES, STATUS_LABELS } from '@/lib/status';
import type { Application, Status } from '@/lib/types';
import { CheckIcon } from './icons';
import { Sheet } from './Sheet';

export interface StatusPick {
  status: Status;
  /** The answer to "When did you apply?"; absent for Skip or when nothing was asked. */
  appliedAt?: string;
}

interface Props {
  application: Pick<Application, 'company' | 'status' | 'appliedAt'> &
    Partial<Pick<Application, 'title'>>;
  onPick: (pick: StatusPick) => void;
}

/**
 * Neutral, calm colors. Closed outcomes are slate, never red: rejections aren't highlighted
 * (spec §4.7); offers and acceptances get the only accent.
 */
const CHIP_COLORS: Record<Status, string> = {
  saved: 'bg-status-neutral text-status-neutral-foreground',
  applied: 'bg-status-progress text-status-progress-foreground',
  screening: 'bg-status-progress text-status-progress-foreground',
  interviewing: 'bg-status-progress-strong text-status-progress-strong-foreground',
  offer: 'bg-status-success text-status-success-foreground',
  accepted: 'bg-status-success-strong text-status-success-strong-foreground',
  rejected: 'bg-status-neutral text-status-neutral-foreground',
  withdrawn: 'bg-status-neutral text-status-neutral-foreground',
  ghosted: 'bg-status-neutral text-status-neutral-foreground',
};

/**
 * A status chip (spec §4.3): a tap opens a sheet listing every status, with the current one
 * marked; one tap on another changes it. Moving to a status that implies an application while
 * Date applied is empty asks for that date first, in the same sheet (Set date / Skip). Closing the
 * sheet any other way changes nothing, and focus returns to the chip.
 */
export function StatusChip({ application, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<Status | null>(null);
  const current = useRef<HTMLButtonElement>(null);

  function choose(status: Status) {
    if (status !== application.status) {
      if (appliedAtAction(application, status) === 'ask') return setAsking(status);
      onPick({ status });
    }
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Status: ${STATUS_LABELS[application.status]}. Change status`}
        onClick={() => setOpen(true)}
        className={`focus-ring rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${CHIP_COLORS[application.status]}`}
      >
        {STATUS_LABELS[application.status]}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        onClosed={() => setAsking(null)}
        dismissible
        title={asking ? 'When did you apply?' : 'Change status'}
        description={
          asking
            ? `Moving ${application.company} to ${STATUS_LABELS[asking]}.`
            : [application.company, application.title].filter(Boolean).join(' · ')
        }
        initialFocus={current}
      >
        {asking ? (
          <AppliedAtStep
            onDone={(appliedAt) => {
              onPick({ status: asking, ...(appliedAt && { appliedAt }) });
              setOpen(false);
            }}
          />
        ) : (
          <StatusList current={application.status} currentRef={current} onChoose={choose} />
        )}
      </Sheet>
    </>
  );
}

/**
 * Every status as a large button, Active then Closed, the current one marked. Buttons, not
 * radios: moving through them with the arrow keys must not change anything; Enter or a tap does.
 */
function StatusList({
  current,
  currentRef,
  onChoose,
}: {
  current: Status;
  currentRef: RefObject<HTMLButtonElement>;
  onChoose: (status: Status) => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);

  // Up and Down move between the options (wrapping), Home and End go to either end.
  function onKeyDown(event: KeyboardEvent) {
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const to =
      event.key === 'ArrowDown'
        ? (index + 1) % buttons.length
        : event.key === 'ArrowUp'
          ? (index - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : undefined;
    if (to === undefined) return;
    event.preventDefault();
    buttons[to]!.focus();
  }

  const group = (label: string, statuses: readonly Status[]) => (
    <div role="group" aria-labelledby={`${id}-${label}`} className="flex flex-col gap-1">
      <p id={`${id}-${label}`} className="px-1 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      {statuses.map((status) => {
        const isCurrent = status === current;
        return (
          <button
            key={status}
            ref={isCurrent ? currentRef : undefined}
            type="button"
            aria-current={isCurrent || undefined}
            onClick={() => onChoose(status)}
            className={`focus-ring flex items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent ${
              isCurrent ? 'bg-accent font-semibold' : ''
            }`}
          >
            {STATUS_LABELS[status]}
            {isCurrent && (
              <>
                <span className="sr-only">(current)</span>
                <CheckIcon />
              </>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={list} onKeyDown={onKeyDown} className="flex flex-col gap-3">
      {group('Active', ACTIVE_STATUSES)}
      {group('Closed', CLOSED_STATUSES)}
    </div>
  );
}

/** The second step for a status that implies an application while Date applied is empty. */
function AppliedAtStep({ onDone }: { onDone: (appliedAt?: string) => void }) {
  const id = useId();
  const [date, setDate] = useState(() => todayLocal());
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Replaces the list inside the open sheet, so focus moves here itself.
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);

  function setDateAndFinish() {
    const problem = checkAppliedAt(date);
    if (problem) {
      setError(problem);
      input.current?.focus();
      return;
    }
    onDone(date);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-date`} className="field-label">
          Date applied
        </label>
        <input
          ref={input}
          id={`${id}-date`}
          type="date"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          max={todayLocal()}
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              setDateAndFinish();
            }
          }}
          className="field"
        />
        {error && (
          <p id={`${id}-error`} className="field-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={setDateAndFinish} className="btn btn-primary flex-1">
          Set date
        </button>
        <button type="button" onClick={() => onDone(undefined)} className="btn btn-outline flex-1">
          Skip
        </button>
      </div>
    </div>
  );
}
