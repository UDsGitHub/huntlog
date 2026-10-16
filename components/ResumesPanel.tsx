/** The Resumes tab (spec §4.6). Upload and the list arrive with the resume library (M4). */
export function ResumesPanel() {
  return (
    <section aria-labelledby="resumes-heading" className="flex flex-col gap-2">
      <h2 id="resumes-heading" className="text-base font-semibold">
        Resumes
      </h2>
      <p className="text-sm text-slate-600">
        No resumes yet. Upload the versions you send, so you always know which one went with each
        application.
      </p>
    </section>
  );
}
