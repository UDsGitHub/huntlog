import { downloadBlob } from './download';
import { getResumeBlob, resumeFileExists, safeFileName } from './resumes';
import type { Resume } from './types';

/** PDFs open in the viewer tab; every other format downloads. One rule for labels and behavior. */
export function opensInViewer(resume: Pick<Resume, 'mimeType'>): boolean {
  return resume.mimeType === 'application/pdf';
}

/**
 * Opens a resume (spec §4.6): a PDF in a new tab (the resume-viewer page, which reads it from the
 * extension's storage and shows Chrome's PDF viewer); any other format downloads under its
 * original, made-safe file name. Returns false if the file is gone.
 */
export async function openResume(resume: Pick<Resume, 'id' | 'mimeType'>): Promise<boolean> {
  if (opensInViewer(resume)) {
    // The viewer reads the file itself; here, only check it's there (without loading it).
    if (!(await resumeFileExists(resume.id))) return false;
    // Opening a tab needs no "tabs" permission.
    await browser.tabs.create({
      url: `${browser.runtime.getURL('/resume-viewer.html')}?id=${encodeURIComponent(resume.id)}`,
    });
    return true;
  }
  const file = await getResumeBlob(resume.id);
  if (!file) return false;
  downloadBlob(file.blob, safeFileName(file.resume.fileName));
  return true;
}
