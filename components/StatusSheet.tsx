import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { checkAppliedAt } from '@/lib/applicationInput';
import { todayLocal } from '@/lib/dates';
import { ACTIVE_STATUSES, appliedAtAction, CLOSED_STATUSES, STATUS_LABELS } from '@/lib/status';
import type { Application, Status } from '@/lib/types';
import { ArrowLeftIcon, CheckIcon } from './icons';
import { rovingIndex } from './rovingIndex';
import { Sheet } from './Sheet';
import type { StatusPick } from './StatusChip';

/** What a chip opens the sheet for. */
export type StatusTarget = Pick<Application, 'company' | 'status' | 'appliedAt'> &
  Partial<Pick<Application, 'title'>>;

interface Request {
  /** The chip that asked, so it can show it's expanded. */
  token: string;
  application: StatusTarget;
  onPick: (pick: StatusPick) => void;
}

interface StatusSheetApi {
  open: (request: Request) => void;
  /** The token of the chip whose sheet is open, if any. */
  openToken: string | null;
}

const StatusSheetContext = createContext<StatusSheetApi | null>(null);

export function useStatusSheet(): StatusSheetApi {
  const api = useContext(StatusSheetContext);
  if (!api) throw new Error('StatusChip needs a StatusSheetProvider above it');
  return api;
}

/**
 * The panel's one status sheet (spec §4.3), shared by every chip: one dialog however long the
 * list, rendered at the panel's root so it looks the same wherever the chip is. It lists every
 * status; one that implies an application while Date applied is empty asks for that date first,
 * in the same sheet (with a way back to the list). Closing it any other way changes nothing, and
 * focus returns to the chip that opened it.
 */
export function StatusSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<Status | null>(null);
  const current = useRef<HTMLButtonElement>(null);

  // Back from the date step: focus the current status again. (On opening, the sheet focuses it
  // itself, after recording the chip as where focus returns; focusing it earlier, from inside,
  // would make the sheet return focus to a button it's about to remove.)
  const wasAsking = useRef(false);
  useLayoutEffect(() => {
    if (wasAsking.current && !asking) current.current?.focus();
    wasAsking.current = asking !== null;
  }, [asking]);

  const api = useMemo<StatusSheetApi>(
    () => ({
      open: (next) => {
        setRequest(next);
        setAsking(null);
        setOpen(true);
      },
      openToken: open ? (request?.token ?? null) : null,
    }),
    [open, request],
  );

  function choose(status: Status) {
    if (!request) return;
    const { application, onPick } = request;
    if (status !== application.status) {
      if (appliedAtAction(application, status) === 'ask') return setAsking(status);
      onPick({ status });
    }
    setOpen(false);
  }

  const application = request?.application;
  return (
    <StatusSheetContext.Provider value={api}>
      {children}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        onClosed={() => {
          setAsking(null);
          setRequest(null);
        }}
        // A click outside can't lose a date being typed.
        dismissible={!asking}
        title={asking ? 'When did you apply?' : 'Change status'}
        description={
          application &&
          (asking
            ? `Moving ${application.company} to ${STATUS_LABELS[asking]}.`
            : [application.company, application.title].filter(Boolean).join(' · '))
        }
        initialFocus={current}
      >
        {application &&
          (asking ? (
            <AppliedAtStep
              status={asking}
              company={application.company}
              onDone={(appliedAt) => {
                request.onPick({ status: asking, ...(appliedAt && { appliedAt }) });
                setOpen(false);
              }}
              onBack={() => setAsking(null)}
            />
          ) : (
            <StatusList current={application.status} currentRef={current} onChoose={choose} />
          ))}
      </Sheet>
    </StatusSheetContext.Provider>
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
    const to = rovingIndex(event.key, index, buttons.length, {
      next: 'ArrowDown',
      previous: 'ArrowUp',
    });
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
function AppliedAtStep({
  status,
  company,
  onDone,
  onBack,
}: {
  status: Status;
  company: string;
  onDone: (appliedAt?: string) => void;
  onBack: () => void;
}) {
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
      {/* Said with the field, since a dialog's new title isn't announced while it's open. */}
      <p id={`${id}-why`} className="text-sm break-words">
        {company} hasn't got a date applied yet. {STATUS_LABELS[status]} means you applied, so when
        was it?
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-date`} className="field-label">
          Date applied
        </label>
        <input
          ref={input}
          id={`${id}-date`}
          type="date"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error ${id}-why` : `${id}-why`}
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
      <button type="button" onClick={onBack} className="btn btn-ghost self-start">
        <ArrowLeftIcon />
        Choose another status
      </button>
    </div>
  );
}
