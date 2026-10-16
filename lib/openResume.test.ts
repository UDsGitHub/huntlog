import { fakeBrowser } from 'wxt/testing/fake-browser';
import { db } from './db';
import { openResume, opensInViewer } from './openResume';
import * as resumes from './resumes';
import { addResume, deleteResume, purgeDeletedResumeData } from './resumes';

const file = (name: string, head: number[]) => {
  const bytes = new Uint8Array([...head, 1, 2, 3]);
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer };
};
const PDF = [0x25, 0x50, 0x44, 0x46];
const DOCX = [0x50, 0x4b, 0x03, 0x04];

beforeEach(async () => {
  fakeBrowser.reset();
  await db.delete();
  await db.open();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('opensInViewer', () => {
  it('is true for PDFs only', () => {
    expect(opensInViewer({ mimeType: 'application/pdf' })).toBe(true);
    expect(opensInViewer({ mimeType: 'application/msword' })).toBe(false);
    expect(opensInViewer({ mimeType: 'text/plain' })).toBe(false);
  });
});

describe('openResume', () => {
  it('opens a PDF in the viewer tab without loading the file in the panel', async () => {
    const resume = await addResume(file('cv.pdf', PDF));
    const create = vi.fn().mockResolvedValue({});
    Object.assign(fakeBrowser.tabs, { create });
    const loadBlob = vi.spyOn(resumes, 'getResumeBlob');
    expect(await openResume(resume)).toBe(true);
    expect(create).toHaveBeenCalledWith({
      url: expect.stringMatching(new RegExp(`/resume-viewer\\.html\\?id=${resume.id}$`)),
    });
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it('downloads other formats under a safe name and revokes the URL later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const resume = await addResume(file('Backend: v3.docx', DOCX));
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    expect(await openResume(resume)).toBe(true);
    expect(clicks).toEqual(['Backend_ v3.docx']);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['PDF', PDF, 'cv.pdf'],
    ['DOCX', DOCX, 'cv.docx'],
  ])('returns false for a %s whose file is gone', async (_label, head, name) => {
    const resume = await addResume(file(name, head));
    await deleteResume(resume.id);
    await purgeDeletedResumeData({ id: resume.id, olderThanMs: 0 });
    const create = vi.fn();
    Object.assign(fakeBrowser.tabs, { create });
    expect(await openResume(resume)).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
