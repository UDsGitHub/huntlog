import { useId, type KeyboardEvent } from 'react';
import { STATUS_LABELS } from '@/lib/status';
import type { Status } from '@/lib/types';
import { useStatusSheet, type StatusTarget } from './StatusSheet';

export interface StatusPick {
  status: Status;
  /** The answer to "When did you apply?"; absent for Skip or when nothing was asked. */
  appliedAt?: string;
}

interface Props {
  application: StatusTarget;
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
 * A status chip (spec §4.3): a tap (or ArrowDown) opens the panel's one status sheet for this
 * application (`StatusSheetProvider`), and focus comes back here when it closes.
 */
export function StatusChip({ application, onPick }: Props) {
  const token = useId();
  const sheet = useStatusSheet();
  const open = () => sheet.open({ token, application, onPick });
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={sheet.openToken === token}
      aria-label={`Status: ${STATUS_LABELS[application.status]}. Change status`}
      onClick={open}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          open();
        }
      }}
      className={`focus-ring rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${CHIP_COLORS[application.status]}`}
    >
      {STATUS_LABELS[application.status]}
    </button>
  );
}
