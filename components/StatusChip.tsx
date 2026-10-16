import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { checkAppliedAt } from '@/lib/applicationInput';
import { todayLocal } from '@/lib/dates';
import {
  ACTIVE_STATUSES,
  appliedAtAction,
  CLOSED_STATUSES,
  STATUS_LABELS,
  STATUSES,
} from '@/lib/status';
import type { Application, Status } from '@/lib/types';

export interface StatusPick {
  status: Status;
  /** The answer to "When did you apply?"; absent for Skip or when nothing was asked. */
  appliedAt?: string;
}

interface Props {
  application: Pick<Application, 'company' | 'status' | 'appliedAt'>;
  onPick: (pick: StatusPick) => void;
  /** Which edge the chip and its popover line up with. */
  align?: 'start' | 'end';
}

/**
 * Neutral, calm colors. Closed outcomes are slate, never red: rejections aren't highlighted
 * (spec §4.7); offers and acceptances get the only accent.
 */
const CHIP_COLORS: Record<Status, string> = {
  saved: 'bg-slate-100 text-slate-800',
  applied: 'bg-indigo-50 text-indigo-800',
  screening: 'bg-indigo-50 text-indigo-800',
  interviewing: 'bg-indigo-100 text-indigo-900',
  offer: 'bg-emerald-50 text-emerald-800',
  accepted: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-slate-100 text-slate-700',
  withdrawn: 'bg-slate-100 text-slate-700',
  ghosted: 'bg-slate-100 text-slate-700',
};

/**
 * A row's status chip (spec §4.3): one tap opens a compact menu of all statuses; one tap on a
 * status changes it. Moving to a status that implies an application while Date applied is empty
 * asks for that date first (Set date / Skip). Opens inline below the chip, so nothing overflows
 * a 320px panel.
 */
export function StatusChip({ application, onPick, align = 'end' }: Props) {
  const id = useId().replace(/:/g, '');
  const [step, setStep] = useState<'closed' | 'menu' | { asking: Status }>('closed');
  const chip = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<Status, HTMLElement>());
  const [active, setActive] = useState<Status>(application.status);
  const open = step !== 'closed';

  function close({ focusChip }: { focusChip: boolean }) {
    setStep('closed');
    if (focusChip) chip.current?.focus();
  }

  function openMenu() {
    setActive(application.status);
    setStep('menu');
  }

  // The menu opens with the current status focused; arrows move from there.
  useLayoutEffect(() => {
    if (step === 'menu') items.current.get(active)?.focus();
  }, [step, active]);

  // A click anywhere else closes without changing anything.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setStep('closed');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(status: Status) {
    if (status === application.status) return close({ focusChip: true });
    if (appliedAtAction(application, status) === 'ask') return setStep({ asking: status });
    close({ focusChip: true });
    onPick({ status });
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const index = STATUSES.indexOf(active);
    const move = (to: number) => {
      event.preventDefault();
      setActive(STATUSES[(to + STATUSES.length) % STATUSES.length]!);
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(index + 1);
      case 'ArrowUp':
        return move(index - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(STATUSES.length - 1);
      case 'Escape':
        event.preventDefault();
        return close({ focusChip: true });
      case 'Tab':
        return close({ focusChip: false });
    }
  }

  const item = (status: Status) => (
    <div
      key={status}
      role="menuitemradio"
      aria-checked={status === application.status}
      tabIndex={status === active ? 0 : -1}
      ref={(element) => {
        if (element) items.current.set(status, element);
        else items.current.delete(status);
      }}
      onClick={() => choose(status)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose(status);
        }
      }}
      className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-2 focus:outline-indigo-600"
    >
      {STATUS_LABELS[status]}
      {status === application.status && <span aria-hidden="true">✓</span>}
    </div>
  );

  return (
    <div
      ref={container}
      className={`flex min-w-0 flex-col gap-1 ${align === 'end' ? 'items-end' : 'items-start'}`}
    >
      <button
        ref={chip}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-popover` : undefined}
        aria-label={`Status: ${STATUS_LABELS[application.status]}. Change status`}
        onClick={() => (open ? close({ focusChip: false }) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 ${CHIP_COLORS[application.status]}`}
      >
        {STATUS_LABELS[application.status]}
      </button>
      {step === 'menu' && (
        <div
          id={`${id}-popover`}
          role="menu"
          aria-label={`Change status for ${application.company}`}
          onKeyDown={onMenuKeyDown}
          className="z-10 flex w-44 flex-col gap-1 rounded border border-slate-200 bg-white p-1 shadow-lg"
        >
          <div role="group" aria-label="Active">
            {ACTIVE_STATUSES.map(item)}
          </div>
          <div role="separator" className="mx-2 border-t border-slate-200" />
          <div role="group" aria-label="Closed">
            {CLOSED_STATUSES.map(item)}
          </div>
        </div>
      )}
      {typeof step === 'object' && (
        <AppliedAtPrompt
          id={`${id}-popover`}
          status={step.asking}
          onDone={(appliedAt) => {
            close({ focusChip: true });
            onPick({ status: step.asking, ...(appliedAt && { appliedAt }) });
          }}
          onCancel={() => close({ focusChip: true })}
        />
      )}
    </div>
  );
}

/** Second step for a status that implies an application while Date applied is empty (§4.3). */
function AppliedAtPrompt({
  id,
  status,
  onDone,
  onCancel,
}: {
  id: string;
  status: Status;
  onDone: (appliedAt?: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(() => todayLocal());
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

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
    <div
      id={id}
      role="dialog"
      aria-labelledby={`${id}-question`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      className="z-10 flex w-56 flex-col gap-2 rounded border border-slate-200 bg-white p-3 shadow-lg"
    >
      <p id={`${id}-question`} className="text-sm font-medium">
        When did you apply?
      </p>
      <p className="text-xs text-slate-600">Moving to {STATUS_LABELS[status]}.</p>
      <label htmlFor={`${id}-date`} className="text-xs font-medium">
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
        className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700"
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={setDateAndFinish}
          className="rounded bg-indigo-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          Set date
        </button>
        <button
          type="button"
          onClick={() => onDone(undefined)}
          className="rounded border border-slate-300 px-2.5 py-1 text-sm font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
