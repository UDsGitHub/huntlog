import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApplicationDetail } from '@/components/ApplicationDetail';
import { ApplicationForm, readFailedMessage } from '@/components/ApplicationForm';
import { ApplicationList } from '@/components/ApplicationList';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ResumesPanel } from '@/components/ResumesPanel';
import { Fab } from '@/components/Fab';
import { guardFileDrops } from '@/components/dropGuard';
import { inert } from '@/components/inert';
import {
  BriefcaseIcon,
  ChartColumnIcon,
  FileTextIcon,
  PlusIcon,
  SettingsIcon,
} from '@/components/icons';
import { SettingsPanel } from '@/components/SettingsPanel';
import { focusOpenSheet, Sheet } from '@/components/Sheet';
import { StatsPanel } from '@/components/StatsPanel';
import { StatusSheetProvider } from '@/components/StatusSheet';
import { useSettings } from '@/components/useSettings';
import { panelState, TabPanel, useTabSlide } from '@/components/TabPanels';
import { useTheme } from '@/components/useTheme';
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
import { getResume, purgeDeletedResumeData, RESUME_STARTUP_PURGE_MS } from '@/lib/resumes';
import { DEFAULT_QUERY, type ListQuery } from '@/lib/listQuery';
import {
  onFormDefaultsChanged,
  readFormDefaults,
  rememberFormDefaults,
  type FormDefaults,
  usableFormDefaults,
} from '@/lib/formDefaults';
import type { Application } from '@/lib/types';

type TabId = 'applications' | 'stats' | 'resumes';
const TAB_PREFIX = 'section';
const TABS: Tab<TabId>[] = [
  { id: 'applications', label: 'Applications', icon: <BriefcaseIcon /> },
  { id: 'stats', label: 'Stats', icon: <ChartColumnIcon /> },
  { id: 'resumes', label: 'Resumes', icon: <FileTextIcon /> },
];

const TAB_ORDER = TABS.map((tab) => tab.id);

/** How long a capture's form waits for the remembered defaults (its resume) at most. */
export const CAPTURE_DEFAULTS_WAIT_MS = 300;

type View =
  | { name: 'list' }
  /** `nonce`: the capture it was opened for (0 for a manual Add), so its form keeps one key. */
  | { name: 'add'; nonce: number }
  | { name: 'detail'; id: string; focus: 'heading' | 'edit' }
  | { name: 'edit'; id: string };

/**
 * Where focus goes when the list shows again (spec §10). Cleared once used. `awaitRow`: the row
 * is about to appear (just restored), so wait for it instead of falling back to + Add.
 */
type FocusTarget = { kind: 'add' } | { kind: 'row'; id: string; awaitRow?: boolean };

export default function App() {
  useTheme();
  // Each tab keeps its own state while the other is shown: switching back to Applications
  // returns to the same list or detail view.
  const [tab, setTab] = useState<TabId>('applications');
  // Readable from async handlers (toast actions), like viewRef.
  const tabRef = useRef(tab);
  // The Resumes tab's upload sheet, opened by its floating + Upload (rendered out here).
  const [uploadOpen, setUploadOpen] = useState(false);
  // Settings, a sheet over whatever tab is showing (spec §3), opened by the header's gear.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // From opening until it has finished sliding out: the page behind is inert meanwhile, so focus
  // meant for it (the restored row after Undo, + Add) waits until then.
  const [settingsShown, setSettingsShown] = useState(false);
  // Loaded once for the whole panel (useTheme reads them too): Settings opens with its cards.
  const settingsLoaded = useSettings() !== undefined;
  if (settingsOpen && settingsLoaded && !settingsShown) setSettingsShown(true);
  const selectTab = useCallback((next: TabId) => {
    tabRef.current = next;
    setTab(next);
    // Leaving the tab (a capture) closes the sheet; coming back doesn't reopen it.
    if (next !== 'resumes') setUploadOpen(false);
    // Only a capture or a toast's action switches tabs, and what they show must not stay
    // hidden under Settings.
    setSettingsOpen(false);
  }, []);
  const slide = useTabSlide(tab, TAB_ORDER);
  const [view, setView] = useState<View>({ name: 'list' });
  // What shows in Applications: the list or a detail view. Add and Edit open as a sheet over it.
  const [base, setBase] = useState<View>(view);
  // The Add or Edit view whose sheet is on screen: kept until the sheet has finished sliding out.
  const [sheetView, setSheetView] = useState<View | null>(null);
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
  // The newest capture's nonce, for an Add view opened for it (now or once an edit closes).
  const latestCapture = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  // Remembered source, work mode and resume for the next manual Add (spec §4.2).
  // undefined until loaded: the Add form reads them once, on mount, so it waits for them.
  const [formDefaults, setFormDefaults] = useState<FormDefaults | undefined>(undefined);
  // The remembered resume as stored now, so one archived or deleted since isn't preselected. The
  // Add form waits for it only when there's one. Each result carries the id it was read for: a
  // live query keeps its last result while a new id loads, and the one for "no resume" must not
  // pass for "this resume is gone".
  const rememberedResumeId = formDefaults?.resumeId;
  const rememberedResume = useLiveQuery(
    async () => ({
      id: rememberedResumeId,
      resume: rememberedResumeId ? await getResume(rememberedResumeId) : undefined,
    }),
    [rememberedResumeId],
  );
  const addDefaults = useMemo(
    () =>
      !formDefaults?.resumeId
        ? formDefaults
        : rememberedResume?.id !== formDefaults.resumeId
          ? undefined
          : usableFormDefaults(formDefaults, rememberedResume.resume),
    [formDefaults, rememberedResume],
  );
  // A capture's form also starts with the remembered resume, so it waits for the defaults too, but
  // only briefly: they load as the panel opens, and a capture must never hang on them.
  const [defaultsPending, setDefaultsPending] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setDefaultsPending(false), CAPTURE_DEFAULTS_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  // A file dropped outside a drop zone mustn't replace the panel with it.
  useEffect(() => guardFileDrops(), []);
  // Files of resumes deleted in a session that closed before their Undo toast ended (spec §4.6).
  useEffect(() => {
    purgeDeletedResumeData({ olderThanMs: RESUME_STARTUP_PURGE_MS }).catch((error: unknown) =>
      console.error('Removing deleted resume files failed', error),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    let changed = false;
    // Follows changes from any window (a new application, or Delete all data elsewhere).
    const stop = onFormDefaultsChanged((defaults) => {
      changed = true;
      setFormDefaults(defaults);
    });
    void readFormDefaults().then((defaults) => !cancelled && !changed && setFormDefaults(defaults));
    return () => {
      cancelled = true;
      stop();
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
            navigate({ name: 'add', nonce: latestCapture.current });
          },
        },
      });
    }
    viewRef.current = next;
    setView(next);
    if (next.name === 'add' || next.name === 'edit') setSheetView(next);
    else setBase(next);
  }

  // Bumped whenever a form sheet has gone: the list behind it counts as shown again, so its
  // frozen order and membership refresh (spec §4.4), e.g. a new row sorts into place.
  const [listShown, setListShown] = useState(0);
  // The application the last Add saved, so the list can sort it in once it arrives.
  const [savedRow, setSavedRow] = useState<string>();
  /** A form's sheet finished closing (unless another one opened meanwhile). */
  const formClosed = (closing: View) => {
    setSheetView((current) => (current === closing ? null : current));
    setListShown((n) => n + 1);
  };

  /**
   * Async work (a save, a delete) may finish after the user has moved on, e.g. a capture opened
   * the Add view meanwhile. Only the view that started the work may navigate away from itself.
   */
  const isCurrent = (v: View) => viewRef.current === v;
  const sectionState = (id: TabId) => panelState(id, tab, slide.leaving);
  // A sheet covers the page (a form, or Settings until it has gone): focus can't go to it yet.
  const pageInert = Boolean(sheetView) || settingsShown;

  function announce(text: string) {
    setAnnouncement(({ count }) => ({ text, count: count + 1 }));
  }

  const { prefill, consume } = useCaptureDraft((capture) => {
    latestCapture.current = capture.nonce;
    announce(captureAnnouncement(capture.draft));
    // Replacing an Add form is expected (spec §4.1); throwing away unsaved edits is not.
    if (viewRef.current.name === 'edit') {
      deferredCapture.current = true;
      showToast({ message: 'Job captured. It opens when you finish editing.' });
      return;
    }
    // A capture opens its form on the Applications tab, whichever tab is showing.
    selectTab('applications');
    navigate({ name: 'add', nonce: latestCapture.current });
  });

  function openAdd() {
    setFormSession((n) => n + 1);
    navigate({ name: 'add', nonce: 0 });
  }

  /** Delete all data finished (spec §4.8): back to an empty list, forgetting what was in flight. */
  function handleDataDeleted() {
    deferredCapture.current = false;
    setFocusTarget(null);
    setFormDefaults({});
    navigate({ name: 'list' });
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
                } else if (!focusOpenSheet()) {
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
    // Behind an open sheet (Settings, a form) the page is inert: focus stays in the sheet.
    if (focusOpenSheet()) return;
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
    // The panel's height, split between the header (title and tabs) and the tab sections, which
    // each scroll on their own (spec §3).
    // One status sheet for every chip in the panel (spec §4.3).
    <StatusSheetProvider>
      <main className="flex h-dvh flex-col">
        {/* The tab bar spans the panel's full width: three labels beside their icons need it at
            320px. */}
        <div className="flex shrink-0 flex-col gap-1 pt-3">
          <div className="flex items-center justify-between gap-2 px-4">
            <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
              Huntlog
            </h1>
            <button
              type="button"
              aria-label="Settings"
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen(true)}
              className="btn btn-ghost btn-icon -mr-2"
            >
              <SettingsIcon />
            </button>
          </div>
          {/* One live region for the whole panel, mounted before anything is announced. */}
          <p role="status" className="sr-only">
            {/* A zero-width space alternates so a repeated message still changes the region. */}
            {announcement.text}
            {announcement.count % 2 ? '​' : ''}
          </p>
          <TabBar
            tabs={TABS}
            selected={tab}
            onSelect={selectTab}
            idPrefix={TAB_PREFIX}
            label="Huntlog sections"
          />
        </div>
        {/* Clipped, not hidden: overflow hidden would still let focus scroll it sideways. */}
        <div className="relative mt-4 min-h-0 flex-1 overflow-clip">
          <TabPanel
            state={sectionState('applications')}
            direction={slide.direction}
            role="tabpanel"
            id={panelId(TAB_PREFIX, 'applications')}
            aria-labelledby={tabId(TAB_PREFIX, 'applications')}
            className="flex min-w-0 flex-col gap-4"
          >
            {/* Out of reach as soon as a form is chosen, even before its sheet is up (Edit loads
                first): nothing behind can start a second action meanwhile. */}
            <div {...inert(Boolean(sheetView))} className="flex min-w-0 flex-col gap-4">
              {base.name === 'detail' ? (
                <ApplicationDetail
                  key={base.id}
                  id={base.id}
                  initialFocus={base.focus}
                  active={!sheetView}
                  onBack={() => toList({ kind: 'row', id: base.id })}
                  onEdit={() => navigate({ name: 'edit', id: base.id })}
                  onDeleted={(application) => handleDeleted(base, application)}
                  onStatusPick={(application, pick) => void handleStatusPick(application, pick)}
                />
              ) : (
                // Bottom padding keeps the last row clear of the floating + Add.
                <section
                  aria-labelledby="applications-heading"
                  className="flex flex-col gap-2 pb-16"
                >
                  <h2 id="applications-heading" className="section-heading">
                    Applications
                  </h2>
                  <ErrorBoundary
                    fallback={
                      <p role="alert" className="text-sm text-muted-foreground">
                        Couldn't load your applications. Close and reopen the side panel to try
                        again.
                      </p>
                    }
                  >
                    <ApplicationList
                      onAdd={openAdd}
                      shown={listShown}
                      expectRow={savedRow}
                      query={listQuery}
                      onQueryChange={setListQuery}
                      onOpen={(id) => navigate({ name: 'detail', id, focus: 'heading' })}
                      onStatusPick={(application, pick) => void handleStatusPick(application, pick)}
                      // Not while a sheet is on screen: the page behind it is inert until it's gone.
                      focusRowId={
                        !pageInert && focusTarget?.kind === 'row' ? focusTarget.id : undefined
                      }
                      awaitRow={focusTarget?.kind === 'row' && focusTarget.awaitRow}
                      onRowFocused={clearFocusTarget}
                      onRowMissing={focusAddInstead}
                      // A capture's form takes over: the filter sheet (and its draft) closes.
                      active={!sheetView}
                    />
                  </ErrorBoundary>
                </section>
              )}
            </div>
          </TabPanel>
          <TabPanel
            state={sectionState('stats')}
            direction={slide.direction}
            role="tabpanel"
            id={panelId(TAB_PREFIX, 'stats')}
            aria-labelledby={tabId(TAB_PREFIX, 'stats')}
          >
            <ErrorBoundary
              fallback={
                <p role="alert" className="text-sm text-muted-foreground">
                  Couldn't load your stats. Close and reopen the side panel to try again.
                </p>
              }
            >
              <StatsPanel active={tab === 'stats'} />
            </ErrorBoundary>
          </TabPanel>
          {/* Focusable itself: until it has controls, Tab from the tab bar must still reach it. */}
          <TabPanel
            state={sectionState('resumes')}
            direction={slide.direction}
            role="tabpanel"
            id={panelId(TAB_PREFIX, 'resumes')}
            aria-labelledby={tabId(TAB_PREFIX, 'resumes')}
            tabIndex={0}
            // Drawn inside its edge: the clipped viewport would cut off an outline outside it.
            className="focus-ring-inset"
          >
            <ResumesPanel
              showToast={showToast}
              announce={announce}
              active={tab === 'resumes'}
              uploadOpen={uploadOpen}
              onUploadOpenChange={setUploadOpen}
            />
          </TabPanel>
        </div>
        {/* Not dismissible: it holds a text field (the weekly goal). */}
        <Sheet
          open={settingsOpen && settingsLoaded}
          onClose={() => setSettingsOpen(false)}
          onClosed={() => setSettingsShown(false)}
          title="Settings"
          size="full"
        >
          <SettingsPanel
            onDataDeleted={handleDataDeleted}
            notify={(message) => showToast({ message })}
            active={settingsOpen}
          />
        </Sheet>
        {/* Add and Edit open as a sheet over the list or detail view (spec §4.2). */}
        {sheetView?.name === 'add' && (addDefaults || (prefill && !defaultsPending)) && (
          // Remount per capture: a new capture replaces whatever is in the form (spec §4.1). The
          // form reads the remembered defaults once, on mount: a manual Add waits for them, and a
          // capture (which uses only their resume) waits at most CAPTURE_DEFAULTS_WAIT_MS.
          <ApplicationForm
            // Stable for the life of this sheet: consume() clearing the prefill on Save or Back
            // mustn't remount it mid slide-out. A new capture is a new view, so a new form.
            key={`${formSession}-${sheetView.nonce}`}
            open={view === sheetView}
            onClosed={() => formClosed(sheetView)}
            prefill={prefill}
            defaults={addDefaults}
            onSaved={(application) => {
              announce(`Saved ${application.company}.`);
              setSavedRow(application.id);
              // Every new application, manual or captured, sets the next manual Add's defaults.
              void rememberFormDefaults(application, { captured: Boolean(prefill) }).then(
                setFormDefaults,
              );
              if (!isCurrent(sheetView)) return;
              consume();
              toList({ kind: 'add' });
            }}
            onCancel={() => {
              if (!isCurrent(sheetView)) return;
              consume();
              toList({ kind: 'add' });
            }}
            onViewExisting={(id) => {
              if (!isCurrent(sheetView)) return;
              consume();
              navigate({ name: 'detail', id, focus: 'heading' });
            }}
          />
        )}
        {sheetView?.name === 'edit' && (
          <EditView
            key={sheetView.id}
            id={sheetView.id}
            open={view === sheetView}
            onClosed={() => formClosed(sheetView)}
            onViewExisting={(id) => {
              if (isCurrent(sheetView)) navigate({ name: 'detail', id, focus: 'heading' });
            }}
            onDone={(saved) => {
              if (saved) announce('Saved changes.');
              if (!isCurrent(sheetView)) return;
              // This handler may come from the render where Save was pressed, before the capture
              // arrived, so it checks the ref rather than `prefill`.
              if (deferredCapture.current) {
                deferredCapture.current = false;
                return navigate({ name: 'add', nonce: latestCapture.current });
              }
              navigate({ name: 'detail', id: sheetView.id, focus: 'edit' });
            }}
          />
        )}
        {/* Outside the sections: a fixed element inside a sliding (transformed) one would move
          with it. Only on the Applications list. */}
        {/* Stays mounted under an Add sheet: it's where focus returns when that closes. */}
        {tab === 'applications' && base.name === 'list' && view.name !== 'edit' && (
          <AddButton
            focus={!pageInert && focusTarget?.kind === 'add'}
            onFocused={clearFocusTarget}
            onClick={openAdd}
          />
        )}
        {/* Stays mounted under the upload sheet: it's where focus returns when that closes. */}
        {tab === 'resumes' && (
          <Fab label="Upload resume" icon={<PlusIcon />} onClick={() => setUploadOpen(true)}>
            Upload
          </Fab>
        )}
        <Toast toast={toast} onDismiss={handleToastDismiss} />
      </main>
    </StatusSheetProvider>
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
    <Fab ref={button} label="Add application" icon={<PlusIcon />} onClick={onClick}>
      Add
    </Fab>
  );
}

function EditView({
  id,
  open,
  onClosed,
  onDone,
  onViewExisting,
}: {
  id: string;
  open: boolean;
  onClosed: () => void;
  onDone: (saved: boolean) => void;
  onViewExisting: (id: string) => void;
}) {
  // Loaded once, not live: if the row is deleted in another window, the form stays (so typed
  // changes aren't lost) and Save explains why it can't save.
  const [application, setApplication] = useState<Application | null | undefined>(undefined);
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

  if (application === undefined) return null;
  if (application === null) {
    return (
      <Sheet
        open={open}
        onClose={() => onDone(false)}
        onClosed={onClosed}
        title="Edit application"
        closeButton="back"
      >
        <p className="text-sm text-muted-foreground">This application isn't available any more.</p>
      </Sheet>
    );
  }
  return (
    <ApplicationForm
      key={application.id}
      open={open}
      onClosed={onClosed}
      application={application}
      onSaved={() => onDone(true)}
      onCancel={() => onDone(false)}
      onViewExisting={onViewExisting}
    />
  );
}

function captureAnnouncement(draft: CaptureDraft): string {
  if (draft.readFailed) return readFailedMessage(draft.url);
  return draft.url || draft.title
    ? 'Job captured. Check the auto-filled fields.'
    : 'Add the job details below.';
}
