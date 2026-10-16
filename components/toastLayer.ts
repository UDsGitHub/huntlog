import { useSyncExternalStore } from 'react';

/**
 * Where the toast shows. An open sheet is a modal <dialog>: it sits in the top layer and makes
 * the rest of the panel inert, so a toast outside it would be hidden, unclickable and (being in
 * an inert subtree) not announced. Each open sheet registers a layer, and the toast uses the
 * newest one (spec §3).
 */
export interface ToastLayer {
  /** Where the toast card renders: a polite live region that exists before any card arrives. */
  region: HTMLElement;
}

const layers: ToastLayer[] = [];
const listeners = new Set<() => void>();
let snapshot: ToastLayer | null = null;

function notify() {
  snapshot = layers.at(-1) ?? null;
  listeners.forEach((listener) => listener());
}

/**
 * Registers a sheet's layer. Call it when the dialog is shown with showModal (which puts it on
 * top of the top layer) and unregister once it has closed, so the order here matches the screen.
 */
export function registerToastLayer(layer: ToastLayer): () => void {
  layers.push(layer);
  notify();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const index = layers.lastIndexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    notify();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The newest open sheet's layer, or null when no sheet is open (the toast shows in the page). */
export function useToastLayer(): ToastLayer | null {
  return useSyncExternalStore(subscribe, () => snapshot);
}
