import { getResumeBlob, safeFileName } from './resumes';

/**
 * Opens a resume (spec §4.6): a PDF in a new tab (the resume-viewer page, which reads it from the
 * extension's storage and shows Chrome's PDF viewer); any other format downloads under its
 * original, made-safe file name. Returns false if the file is gone.
 */
export async function openResume(id: string): Promise<boolean> {
  const file = await getResumeBlob(id);
  if (!file) return false;
  if (file.resume.mimeType === 'application/pdf') {
    // Opening a tab needs no "tabs" permission.
    await browser.tabs.create({ url: `${browser.runtime.getURL('/resume-viewer.html')}?id=${id}` });
    return true;
  }
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(file.resume.fileName);
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started from the click; give the browser a moment before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
