import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApplicationDetail } from '@/components/ApplicationDetail';
import { ApplicationForm, readFailedMessage } from '@/components/ApplicationForm';
import { ApplicationList } from '@/components/ApplicationList';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ResumesPanel } from '@/components/ResumesPanel';
import { panelId, TabBar, tabId, type Tab } from '@/components/TabBar';
import { Toast, useToast, type DismissReason } from '@/components/Toast';
import { useCaptureDraft } from '@/components/useCaptureDraft';
import {
  getApplication,
  NotFoundError,
  restoreApplication,
  setStatus,
  undoStatusChange,
  ValidationError,
} from '@/lib/applications';
import { STATUS_LABELS } from '@/lib/status';
import type { StatusPick } from '@/components/StatusChip';
import type { CaptureDraft } from '@/lib/captureDraft';
import { purgeDeletedResumeData, RESUME_STARTUP_PURGE_MS } from '@/lib/resumes';
import { DEFAULT_QUERY, type ListQuery } from '@/lib/listQuery';
import { readFormDefaults, rememberFormDefaults, type FormDefaults } from '@/lib/formDefaults';
import type { Application } from '@/lib/types';

type TabId = 'applications' | 'resumes';
const TAB_PREFIX = 'section';
const TABS: Tab<TabId>[] = [
  { id: 'applications', label: 'Applications' },
  { id: 'resumes', label: 'Resumes' },
];

type View =
  | { name: 'list' }
  | { name: 'add' }
  | { name: 'detail'; id: string; focus: 'heading' | 'edit' }
  | { name: 'edit'; id: string };

/**
 * Where focus goes when the list shows again (spec §10). Cleared once used. `awaitRow`: the row
 * is about to appear (just restored), so wait for it instead of falling back to + Add.
 */
type FocusTarget = { kind: 'add' } | { kind: 'row'; id: string; awaitRow?: boolean };

export default function App() {
  // Each tab keeps its own state while the other is shown: switching back to Applications
  // returns to the same list or detail view.
  const [tab, setTab] = useState<TabId>('applications');
  // Readable from async handlers (toast actions), like viewRef.
  const tabRef = useRef(tab);
  const selectTab = useCallback((next: TabId) => {
    tabRef.current = next;
    setTab(next);
  }, []);
  const [view, setView] = useState<View>({ name: 'list' });
  // The view on screen, readable from async handlers. Every navigation creates a new object, so
  // a handler can tell whether the view it belongs to is still showing (see isCurrent).
  const viewRef = useRef(view);
  // Each opening of the Add view gets a fresh form.
  const [formSession, setFormSession] = useState(0);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [listQuery, setListQuery] = useState<ListQuery>(DEFAULT_QUERY);
  // A capture that arrived while an edit was open; it opens once the edit closes.
  const deferredCapture = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  // Remembered source and work mode for the next manual Add (spec §4.2).
  // undefined until loaded: the Add form reads them once, on mount, so it waits for them.
  const [formDefaults, setFormDefaults] = useState<FormDefaults | undefined>(undefined);
  // Files of resumes deleted in a session that closed before their Undo toast ended (spec §4.6).
  useEffect(() => {
    purgeDeletedResumeData({ olderThanMs: RESUME_STARTUP_PURGE_MS }).catch((error: unknown) =>
      console.error('Removing deleted resume files failed', error),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readFormDefaults().then((defaults) => !cancelled && setFormDefaults(defaults));
    return () => {
      cancelled = true;
    };
  }, []);

  function navigate(next: View) {
    // Leaving Edit some other way than its own Save/Cancel (e.g. View existing): a capture that
    // waited for the edit mustn't be lost, nor linger to hijack a later edit.
    if (deferredCapture.current && viewRef.current.name === 'edit' && next.name !== 'add') {
      deferredCapture.current = false;
      showToast({
        message: 'Your captured job is ready.',
        action: {
          label: 'Open',
          onAction: () => {
            selectTab('applications');
            navigate({ name: 'add' });
          },
        },
      });
    }
    viewRef.current = next;
    setView(next);
  }

  /**
   * Async work (a save, a delete) may finish after the user has moved on, e.g. a capture opened
   * the Add view meanwhile. Only the view that started the work may navigate away from itself.
   */
  const isCurrent = (v: View) => viewRef.current === v;
  const inForm = view.name === 'add' || view.name === 'edit';

  function announce(text: string) {
    setAnnouncement(({ count }) => ({ text, count: count + 1 }));
  }

  const { prefill, consume } = useCaptureDraft((capture) => {
    announce(captureAnnouncement(capture.draft));
    // Replacing an Add form is expected (spec §4.1); throwing away unsaved edits is not.
    if (viewRef.current.name === 'edit') {
      deferredCapture.current = true;
      showToast({ message: 'Job captured. It opens when you finish editing.' });
      return;
    }
    // A capture opens its form on the Applications tab, whichever tab is showing.
    selectTab('applications');
    navigate({ name: 'add' });
  });

  function openAdd() {
    setFormSession((n) => n + 1);
    navigate({ name: 'add' });
  }

  function toList(focus: FocusTarget) {
    navigate({ name: 'list' });
    setFocusTarget(focus);
  }

  function handleDeleted(from: View, application: Application) {
    if (isCurrent(from)) toList({ kind: 'add' });
    showToast({
      message: `Deleted ${application.company}.`,
      action: {
        label: 'Undo',
        onAction: () => {
          restoreApplication(application.id).then(
            () => {
              announce(`Restored ${application.company}.`);
              // Show what was restored, even if the user moved to another tab meanwhile.
              selectTab('applications');
              if (viewRef.current.name === 'list') {
                setFocusTarget({ kind: 'row', id: application.id, awaitRow: true });
              }
            },
            (error: unknown) => {
              if (!(error instanceof NotFoundError)) console.error('Undo delete failed', error);
              announce("Couldn't undo the delete.");
            },
          );
        },
      },
    });
  }

  /** One tap on the chip (spec §4.3): change, announce, and offer Undo for about 5 seconds. */
  async function handleStatusPick(application: Application, pick: StatusPick) {
    try {
      const change = await setStatus(application.id, pick.status, { appliedAt: pick.appliedAt });
      if (change.after === change.before) return;
      // The toast is a live region itself; announcing too would read the message twice.
      showToast({
        message: `Moved ${application.company} to ${STATUS_LABELS[pick.status]}.`,
        action: {
          label: 'Undo',
          onAction: () => {
            undoStatusChange(change).then(
              (undone) => {
                announce(
                  undone
                    ? `${application.company} is back to ${STATUS_LABELS[change.before.status]}.`
                    : `Couldn't undo: ${application.company} changed since.`,
                );
                // The toast's Undo button had focus and is gone: return to the row, on the
                // Applications tab even if the user moved to another meanwhile.
                selectTab('applications');
                if (viewRef.current.name === 'list') {
                  setFocusTarget({ kind: 'row', id: application.id });
                } else {
                  heading.current?.focus();
                }
              },
              (error: unknown) => {
                console.error('Undo status change failed', error);
                announce("Couldn't undo the status change.");
              },
            );
          },
        },
      });
    } catch (error) {
      // A date rejected when saving (e.g. the clock passed midnight after the prompt) is expected.
      if (error instanceof ValidationError) {
        announce(
          `Couldn't change the status of ${application.company}: ${error.fields.appliedAt ?? 'check the date'}`,
        );
        return;
      }
      if (!(error instanceof NotFoundError)) console.error('setStatus failed', error);
      announce(`Couldn't change the status of ${application.company}.`);
    }
  }

  function handleToastDismiss(reason: DismissReason) {
    dismissToast(reason);
    // The toast's button had focus and is gone; put focus somewhere sensible. After Undo, the
    // restored row takes it once the restore finishes.
    if (reason !== 'dismiss') return;
    if (tabRef.current !== 'applications') {
      document.getElementById(tabId(TAB_PREFIX, tabRef.current))?.focus();
    } else if (viewRef.current.name === 'list') {
      setFocusTarget({ kind: 'add' });
    } else {
      heading.current?.focus();
    }
  }

  const clearFocusTarget = useCallback(() => setFocusTarget(null), []);
  const focusAddInstead = useCallback(() => setFocusTarget({ kind: 'add' }), []);

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
        Job Log
      </h1>
      {/* One live region for the whole panel, mounted before anything is announced. */}
      <p role="status" className="sr-only">
        {/* A zero-width space alternates so a repeated message still changes the region. */}
        {announcement.text}
        {announcement.count % 2 ? '​' : ''}
      </p>
      {/* Tabs are hidden while a form is open (spec §3): its sticky Save bar owns the panel. */}
      {!inForm && (
        <TabBar
          tabs={TABS}
          selected={tab}
          onSelect={selectTab}
          idPrefix={TAB_PREFIX}
          label="Job Log sections"
        />
      )}
      <div
        role={inForm ? undefined : 'tabpanel'}
        id={panelId(TAB_PREFIX, 'applications')}
        aria-labelledby={inForm ? undefined : tabId(TAB_PREFIX, 'applications')}
        hidden={tab !== 'applications'}
        className="flex min-w-0 flex-col gap-4"
      >
        {view.name === 'detail' ? (
          <ApplicationDetail
            key={view.id}
            id={view.id}
            initialFocus={view.focus}
            onBack={() => toList({ kind: 'row', id: view.id })}
            onEdit={() => navigate({ name: 'edit', id: view.id })}
            onDeleted={(application) => handleDeleted(view, application)}
            onStatusPick={(application, pick) => void handleStatusPick(application, pick)}
          />
        ) : view.name === 'edit' ? (
          <EditView
            id={view.id}
            onViewExisting={(id) => {
              if (isCurrent(view)) navigate({ name: 'detail', id, focus: 'heading' });
            }}
            onDone={(saved) => {
              if (saved) announce('Saved changes.');
              if (!isCurrent(view)) return;
              // This handler may come from the render where Save was pressed, before the capture
              // arrived, so it checks the ref rather than `prefill`.
              if (deferredCapture.current) {
                deferredCapture.current = false;
                return navigate({ name: 'add' });
              }
              navigate({ name: 'detail', id: view.id, focus: 'edit' });
            }}
          />
        ) : view.name === 'add' ? (
          <section aria-labelledby="add-heading" className="flex flex-col gap-3">
            <h2 id="add-heading" className="text-base font-semibold">
              Add application
            </h2>
            {/* Remount per capture: a new capture replaces whatever is in the form (spec §4.1). */}
            {/* A manual Add waits for the remembered defaults (read once, on mount); a capture
                doesn't use them, so it never waits. */}
            {(prefill || formDefaults) && (
              <ApplicationForm
                key={`${formSession}-${prefill?.nonce ?? 0}`}
                prefill={prefill}
                defaults={formDefaults}
                onSaved={(application) => {
                  announce(`Saved ${application.company}.`);
                  // Every new application, manual or captured, sets the next manual Add's defaults.
                  void rememberFormDefaults(application, { captured: Boolean(prefill) }).then(
                    setFormDefaults,
                  );
                  if (!isCurrent(view)) return;
                  consume();
                  toList({ kind: 'add' });
                }}
                onCancel={() => {
                  consume();
                  toList({ kind: 'add' });
                }}
                onViewExisting={(id) => {
                  if (!isCurrent(view)) return;
                  consume();
                  navigate({ name: 'detail', id, focus: 'heading' });
                }}
              />
            )}
          </section>
        ) : (
          <section aria-labelledby="applications-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id="applications-heading" className="text-base font-semibold">
                Applications
              </h2>
              <AddButton
                focus={focusTarget?.kind === 'add'}
                onFocused={clearFocusTarget}
                onClick={openAdd}
              />
            </div>
            <ErrorBoundary
              fallback={
                <p role="alert" className="text-sm text-slate-700">
                  Couldn't load your applications. Close and reopen the side panel to try again.
                </p>
              }
            >
              <ApplicationList
                query={listQuery}
                onQueryChange={setListQuery}
                onOpen={(id) => navigate({ name: 'detail', id, focus: 'heading' })}
                onStatusPick={(application, pick) => void handleStatusPick(application, pick)}
                focusRowId={focusTarget?.kind === 'row' ? focusTarget.id : undefined}
                awaitRow={focusTarget?.kind === 'row' && focusTarget.awaitRow}
                onRowFocused={clearFocusTarget}
                onRowMissing={focusAddInstead}
              />
            </ErrorBoundary>
          </section>
        )}
      </div>
      {/* Mounted while hidden, like Applications, so the tab keeps its state. Focusable itself:
          until it has controls, Tab from the tab bar must still reach its content. */}
      <div
        role="tabpanel"
        id={panelId(TAB_PREFIX, 'resumes')}
        aria-labelledby={tabId(TAB_PREFIX, 'resumes')}
        tabIndex={0}
        hidden={inForm || tab !== 'resumes'}
        className="focus:outline-2 focus:outline-indigo-600"
      >
        <ResumesPanel showToast={showToast} announce={announce} />
      </div>
      <Toast toast={toast} onDismiss={handleToastDismiss} />
    </main>
  );
}

function AddButton({
  focus,
  onFocused,
  onClick,
}: {
  focus: boolean;
  onFocused: () => void;
  onClick: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!focus) return;
    button.current?.focus();
    onFocused();
  }, [focus, onFocused]);
  return (
    <button
      ref={button}
      type="button"
      onClick={onClick}
      className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
    >
      + Add application
    </button>
  );
}

function EditView({
  id,
  onDone,
  onViewExisting,
}: {
  id: string;
  onDone: (saved: boolean) => void;
  onViewExisting: (id: string) => void;
}) {
  // Loaded once, not live: if the row is deleted in another window, the form stays (so typed
  // changes aren't lost) and Save explains why it can't save.
  const [application, setApplication] = useState<Application | null | undefined>(undefined);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false;
    getApplication(id).then(
      (app) => !cancelled && setApplication(app ?? null),
      (error: unknown) => {
        console.error('getApplication failed', error);
        if (!cancelled) setApplication(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  useLayoutEffect(() => {
    if (application === null) back.current?.focus();
  }, [application]);

  if (application === undefined) return null;
  return (
    <section aria-labelledby="edit-heading" className="flex flex-col gap-3">
      <h2 id="edit-heading" className="text-base font-semibold">
        Edit application
      </h2>
      {application ? (
        <ApplicationForm
          key={application.id}
          application={application}
          onSaved={() => onDone(true)}
          onCancel={() => onDone(false)}
          onViewExisting={onViewExisting}
        />
      ) : (
        <>
          <p className="text-sm text-slate-700">This application isn't available any more.</p>
          <button
            ref={back}
            type="button"
            onClick={() => onDone(false)}
            className="self-start rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
          >
            ← Back
          </button>
        </>
      )}
    </section>
  );
}

function captureAnnouncement(draft: CaptureDraft): string {
  if (draft.readFailed) return readFailedMessage(draft.url);
  return draft.url || draft.title
    ? 'Job captured. Check the auto-filled fields.'
    : 'Add the job details below.';
}
