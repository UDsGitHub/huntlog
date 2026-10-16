import { AddApplicationForm, readFailedMessage } from '@/components/AddApplicationForm';
import { ApplicationList } from '@/components/ApplicationList';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useCaptureDraft } from '@/components/useCaptureDraft';
import type { CaptureDraft } from '@/lib/captureDraft';

export default function App() {
  const prefill = useCaptureDraft();
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Job Log</h1>
      {/* Lives outside the keyed form so screen readers announce each capture. */}
      <p role="status" className="sr-only">
        {prefill && captureAnnouncement(prefill.draft)}
      </p>
      {/* Remount per capture: a new capture replaces whatever is in the form (spec §4.1). */}
      <AddApplicationForm key={prefill?.nonce ?? 0} prefill={prefill} />
      <section aria-labelledby="applications-heading" className="flex flex-col gap-2">
        <h2 id="applications-heading" className="text-base font-semibold">
          Applications
        </h2>
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
    </main>
  );
}

function captureAnnouncement(draft: CaptureDraft): string {
  if (draft.readFailed) return readFailedMessage(draft.url);
  return draft.url || draft.title
    ? 'Job captured. Check the auto-filled fields.'
    : 'Add the job details below.';
}
