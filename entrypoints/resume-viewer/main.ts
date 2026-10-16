import { getResumeBlob } from '@/lib/resumes';

/**
 * Shows a PDF resume in a full browser tab (spec §4.6): resume-viewer.html?id=… The file lives in
 * the extension's own storage, not on disk, so this extension page reads it and hands it to
 * Chrome's PDF viewer. The page owns the blob URL, so it outlives the side panel.
 */
const root = document.getElementById('root')!;

function message(text: string) {
  const p = document.createElement('p');
  p.textContent = text;
  root.replaceChildren(p);
}

async function show() {
  const id = new URLSearchParams(location.search).get('id');
  const file = id ? await getResumeBlob(id) : undefined;
  if (!file) {
    message("This resume isn't available. It may have been deleted.");
    return;
  }
  document.title = file.resume.name;
  const frame = document.createElement('iframe');
  frame.title = file.resume.name;
  frame.src = URL.createObjectURL(file.blob);
  root.replaceChildren(frame);
}

show().catch((error: unknown) => {
  console.error('Showing the resume failed', error);
  message("Couldn't open this resume.");
});
