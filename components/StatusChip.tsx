import { useId, type KeyboardEvent } from 'react';
import { STATUS_LABELS } from '@/lib/status';
import type { Status } from '@/lib/types';
import { STATUS_CHIP } from './statusColors';
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
      className={`focus-ring rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_CHIP[application.status]}`}
    >
      {STATUS_LABELS[application.status]}
    </button>
  );
}
