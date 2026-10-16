import { useEffect, useRef, useState } from 'react';
import { ApplicationForm, readFailedMessage } from '@/components/ApplicationForm';
import { ApplicationList } from '@/components/ApplicationList';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useCaptureDraft } from '@/components/useCaptureDraft';
import type { CaptureDraft } from '@/lib/captureDraft';

type View = { name: 'list' } | { name: 'add' };

export default function App() {
  const [view, setView] = useState<View>({ name: 'list' });
  // Each opening of the Add view gets a fresh form.
  const [formSession, setFormSession] = useState(0);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  // Bumped when the form closes, so focus returns to the list (spec §10).
  const [returnFocus, setReturnFocus] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);

  const { prefill, consume } = useCaptureDraft((capture) => {
    setView({ name: 'add' });
    announce(captureAnnouncement(capture.draft));
  });
  const formKey = `${formSession}-${prefill?.nonce ?? 0}`;
  // A form's save can finish after a newer capture replaced that form; it must not close the
  // new one. Handlers compare their own key with the form currently on screen.
  const currentFormKey = useRef(formKey);
  useEffect(() => {
    currentFormKey.current = formKey;
  });

  function announce(text: string) {
    setAnnouncement(({ count }) => ({ text, count: count + 1 }));
  }

  useEffect(() => {
    if (returnFocus > 0) addButton.current?.focus();
  }, [returnFocus]);

  function openAdd() {
    setFormSession((n) => n + 1);
    setView({ name: 'add' });
  }

  function closeForm(key: string) {
    if (key !== currentFormKey.current) return;
    consume();
    setView({ name: 'list' });
    setReturnFocus((n) => n + 1);
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Job Log</h1>
      {/* One live region for the whole panel, mounted before anything is announced. */}
      <p role="status" className="sr-only">
        {/* A zero-width space alternates so a repeated message still changes the region. */}
        {announcement.text}
        {announcement.count % 2 ? '\u200b' : ''}
      </p>
      {view.name === 'add' ? (
        <section aria-labelledby="add-heading" className="flex flex-col gap-3">
          <h2 id="add-heading" className="text-base font-semibold">
            Add application
          </h2>
          {/* Remount per capture: a new capture replaces whatever is in the form (spec §4.1). */}
          <ApplicationForm
            key={formKey}
            prefill={prefill}
            onSaved={(application) => {
              announce(`Saved ${application.company}.`);
              closeForm(formKey);
            }}
            onCancel={() => closeForm(formKey)}
          />
        </section>
      ) : (
        <section aria-labelledby="applications-heading" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="applications-heading" className="text-base font-semibold">
              Applications
            </h2>
            <button
              ref={addButton}
              type="button"
              onClick={openAdd}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
            >
              + Add application
            </button>
          </div>
          <ErrorBoundary
            fallback={
              <p role="alert" className="text-sm text-slate-700">
                Couldn't load your applications. Close and reopen the side panel to try again.
              </p>
            }
          >
            <ApplicationList />
          </ErrorBoundary>
        </section>
      )}
    </main>
  );
}

function captureAnnouncement(draft: CaptureDraft): string {
  if (draft.readFailed) return readFailedMessage(draft.url);
  return draft.url || draft.title
    ? 'Job captured. Check the auto-filled fields.'
    : 'Add the job details below.';
}
