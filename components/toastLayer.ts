import { useSyncExternalStore } from 'react';

/**
 * Where the toast shows. An open sheet is a modal <dialog>: it sits in the top layer and makes
 * the rest of the panel inert, so a toast outside it would be hidden and unclickable. Each open
 * sheet registers a slot here, and the toast renders into the newest one (spec §3).
 */
const slots: HTMLElement[] = [];
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** Registers a sheet's toast slot while it's open. Returns the unregister function. */
export function registerToastSlot(slot: HTMLElement): () => void {
  slots.push(slot);
  notify();
  return () => {
    const index = slots.lastIndexOf(slot);
    if (index >= 0) slots.splice(index, 1);
    notify();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const top = () => slots.at(-1) ?? null;

/** The slot of the newest open sheet, or null when no sheet is open (toast shows in the page). */
export function useToastSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, top);
}
