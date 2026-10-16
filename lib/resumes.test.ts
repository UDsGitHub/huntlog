import { addApplication, softDeleteApplication } from './applications';
import { JobLogDB } from './db';
import {
  addResume,
  checkResumeFile,
  defaultResumeName,
  deleteResume,
  formatLabel,
  getResume,
  isResumeReferenced,
  listResumes,
  MAX_RESUME_BYTES,
  purgeDeletedResumeData,
  restoreResume,
  resumeBlob,
  ResumeValidationError,
  RESUME_UNDO_WINDOW_MS,
  safeFileName,
  setResumeArchived,
  updateResume,
  type ResumeFile,
} from './resumes';
import { NotFoundError } from './applications';

let db: JobLogDB;
beforeEach(() => {
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete();
});

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A file-like object with real bytes. */
function file(name: string, type = PDF, bytes: number[] = [37, 80, 68, 70, 45]): ResumeFile {
  const data = new Uint8Array(bytes);
  return { name, type, size: data.byteLength, arrayBuffer: async () => data.slice().buffer };
}

describe('checkResumeFile', () => {
  it.each([
    ['cv.pdf', PDF],
    ['cv.PDF', PDF],
    ['cv.docx', DOCX],
    ['cv.doc', 'application/msword'],
    ['cv.txt', 'text/plain'],
    ['cv.rtf', 'application/rtf'],
    ['cv.rtf', 'text/rtf'],
  ])('accepts %s reported as %s', (name, type) => {
    expect(checkResumeFile({ name, type, size: 10 })).toEqual({ mimeType: type });
  });

  it.each([
    ['cv.doc', '', 'application/msword'],
    ['cv.rtf', 'application/octet-stream', 'application/rtf'],
    ['cv.pdf', '', PDF],
  ])('accepts %s with an unknown type %j, storing %s', (name, type, stored) => {
    expect(checkResumeFile({ name, type, size: 10 })).toEqual({ mimeType: stored });
  });

  it.each([
    ['photo.png', 'image/png', 'Choose a PDF, DOCX, DOC, TXT or RTF file.'],
    ['cv', PDF, 'Choose a PDF, DOCX, DOC, TXT or RTF file.'],
    ['.pdf', PDF, 'Choose a PDF, DOCX, DOC, TXT or RTF file.'],
    ['cv.pdf.exe', 'application/x-msdownload', 'Choose a PDF, DOCX, DOC, TXT or RTF file.'],
    ['cv.pdf', 'image/png', "This file's contents don't match its extension."],
    ['cv.docx', PDF, "This file's contents don't match its extension."],
  ])('rejects %s (%s)', (name, type, error) => {
    expect(checkResumeFile({ name, type, size: 10 })).toEqual({ error });
  });

  it.each([
    [0, 'This file is empty.'],
    [MAX_RESUME_BYTES + 1, 'Choose a file of 10 MB or less.'],
  ])('rejects a size of %d bytes', (size, error) => {
    expect(checkResumeFile({ name: 'cv.pdf', type: PDF, size })).toEqual({ error });
  });

  it('accepts exactly 10 MB and 1 byte', () => {
    expect(checkResumeFile({ name: 'cv.pdf', type: PDF, size: MAX_RESUME_BYTES })).toEqual({
      mimeType: PDF,
    });
    expect(checkResumeFile({ name: 'cv.pdf', type: PDF, size: 1 })).toEqual({ mimeType: PDF });
  });
});

describe('names and labels', () => {
  it.each([
    ['Backend v3.pdf', 'Backend v3'],
    ['  Backend   v3 .docx', 'Backend v3'],
    ['resume.final.pdf', 'resume.final'],
    ['noextension', 'noextension'],
    [`${'x'.repeat(150)}.pdf`, 'x'.repeat(100)],
  ])('defaultResumeName(%j) → %j', (input, expected) => {
    expect(defaultResumeName(input)).toBe(expected);
  });

  it.each([
    ['a.pdf', 'PDF'],
    ['a.DOCX', 'DOCX'],
    ['a.rtf', 'RTF'],
  ])('formatLabel(%s) → %s', (name, label) => {
    expect(formatLabel(name)).toBe(label);
  });

  it.each([
    ['Backend v3.pdf', 'Backend v3.pdf'],
    ['a/b\\c:d*e?f"g<h>i|j.pdf', 'a_b_c_d_e_f_g_h_i_j.pdf'],
    ['tab\there.pdf', 'tab_here.pdf'],
    ['  ..hidden.pdf.  ', 'hidden.pdf'],
    ['...', 'resume'],
  ])('safeFileName(%j) → %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
});

describe('addResume', () => {
  it('stores the bytes, type, size and a default name; the bytes round-trip exactly', async () => {
    const bytes = Array.from({ length: 300 }, (_, i) => i % 256);
    const resume = await addResume(file('Backend v3.pdf', PDF, bytes), {}, db);
    expect(resume).toMatchObject({
      name: 'Backend v3',
      fileName: 'Backend v3.pdf',
      mimeType: PDF,
      size: 300,
      archived: false,
    });
    const stored = await db.applications.db.table('resumes').get(resume.id);
    expect(Array.from(new Uint8Array(stored.data))).toEqual(bytes);
    const blob = resumeBlob(stored)!;
    expect(blob.type).toBe(PDF);
    expect(blob.size).toBe(300);
  });

  it('takes a display name and note, trimmed', async () => {
    const resume = await addResume(
      file('cv.pdf'),
      { name: '  Backend  v3 ', note: ' For SRE ' },
      db,
    );
    expect(resume).toMatchObject({ name: 'Backend v3', note: 'For SRE' });
  });

  it('reports every problem at once and stores nothing', async () => {
    const error = await addResume(
      file('photo.png', 'image/png'),
      { name: '  ', note: 'x'.repeat(501) },
      db,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResumeValidationError);
    expect((error as ResumeValidationError).fields).toEqual({
      file: 'Choose a PDF, DOCX, DOC, TXT or RTF file.',
      name: 'Enter a name for this resume.',
      note: 'Use 500 characters or fewer.',
    });
    expect(await db.resumes.count()).toBe(0);
  });

  it('allows the same display name twice (e.g. PDF and DOCX)', async () => {
    await addResume(file('Backend v3.pdf'), {}, db);
    await addResume(file('Backend v3.docx', DOCX), {}, db);
    expect((await listResumes(db)).map((r) => r.name)).toEqual(['Backend v3', 'Backend v3']);
  });
});

describe('reading, renaming, archiving', () => {
  it('lists live resumes newest first, archived included, deleted not', async () => {
    const a = await addResume(file('a.pdf'), {}, db, new Date('2026-10-01T00:00:00Z'));
    const b = await addResume(file('b.pdf'), {}, db, new Date('2026-10-02T00:00:00Z'));
    const c = await addResume(file('c.pdf'), {}, db, new Date('2026-10-03T00:00:00Z'));
    await setResumeArchived(b.id, true, db);
    await deleteResume(c.id, db);
    expect((await listResumes(db)).map((r) => r.id)).toEqual([b.id, a.id]);
    expect(await getResume(c.id, db)).toBeUndefined();
  });

  it('renames and sets the note, leaving the file alone', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    const updated = await updateResume(resume.id, { name: 'Backend v3 (old)', note: '' }, db);
    expect(updated).toMatchObject({ name: 'Backend v3 (old)', fileName: 'cv.pdf', size: 5 });
    expect(updated).not.toHaveProperty('note');
  });

  it('archives and unarchives', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    expect((await setResumeArchived(resume.id, true, db)).archived).toBe(true);
    expect((await setResumeArchived(resume.id, false, db)).archived).toBe(false);
  });

  it.each([
    ['rename', 'updateResume'],
    ['archive', 'setResumeArchived'],
  ])('refuses to %s a deleted resume', async (_label, fn) => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    await deleteResume(resume.id, db);
    const call =
      fn === 'updateResume'
        ? updateResume(resume.id, { name: 'x' }, db)
        : setResumeArchived(resume.id, true, db);
    await expect(call).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('delete rules (spec §4.6)', () => {
  const linkResume = async (resumeId: string) => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    await db.applications.update(app.id, { resumeId, resumeNameSnapshot: 'cv' });
    return app;
  };

  it('archives instead of deleting a resume an application uses', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    await linkResume(resume.id);
    expect(await isResumeReferenced(resume.id, db)).toBe(true);
    const { outcome, resume: after } = await deleteResume(resume.id, db);
    expect(outcome).toBe('archived');
    expect(after).toMatchObject({ archived: true });
    expect(after).not.toHaveProperty('deletedAt');
    expect(after.data).toBeDefined();
  });

  it('still archives when only a soft-deleted application uses it (it can be restored)', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    const app = await linkResume(resume.id);
    await softDeleteApplication(app.id, db);
    expect((await deleteResume(resume.id, db)).outcome).toBe('archived');
  });

  it('soft-deletes an unused resume, which Undo restores', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, new Date('2026-10-01T00:00:00Z'));
    const { outcome } = await deleteResume(resume.id, db, new Date('2026-10-02T00:00:00Z'));
    expect(outcome).toBe('deleted');
    expect(await getResume(resume.id, db)).toBeUndefined();
    const restored = await restoreResume(resume.id, db, new Date('2026-10-02T00:00:30Z'));
    expect(restored).not.toHaveProperty('deletedAt');
    expect(restored.updatedAt).toBe('2026-10-02T00:00:30.000Z');
    expect(await getResume(resume.id, db)).toBeDefined();
  });

  it('refuses to delete or restore what it should not', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    await expect(deleteResume('missing', db)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreResume(resume.id, db)).rejects.toBeInstanceOf(NotFoundError);
    await deleteResume(resume.id, db);
    await expect(deleteResume(resume.id, db)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('purgeDeletedResumeData', () => {
  const t0 = new Date('2026-10-01T00:00:00Z');
  const later = (ms: number) => new Date(t0.getTime() + ms);

  it("removes a deleted resume's bytes once the Undo window has passed", async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    await deleteResume(resume.id, db, t0);
    expect(await purgeDeletedResumeData({}, db, later(RESUME_UNDO_WINDOW_MS - 1))).toBe(0);
    expect(await purgeDeletedResumeData({}, db, later(RESUME_UNDO_WINDOW_MS))).toBe(1);
    const stored = await db.resumes.get(resume.id);
    expect(stored).not.toHaveProperty('data');
    // The small record stays, for future sync.
    expect(stored).toMatchObject({ name: 'cv', deletedAt: t0.toISOString() });
    await expect(restoreResume(resume.id, db)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('can clear one resume right away (its toast ended)', async () => {
    const a = await addResume(file('a.pdf'), {}, db, t0);
    const b = await addResume(file('b.pdf'), {}, db, t0);
    await deleteResume(a.id, db, t0);
    await deleteResume(b.id, db, t0);
    expect(await purgeDeletedResumeData({ id: a.id, olderThanMs: 0 }, db, t0)).toBe(1);
    expect((await db.resumes.get(b.id))?.data).toBeDefined();
  });

  it('never touches live or archived resumes', async () => {
    const live = await addResume(file('a.pdf'), {}, db, t0);
    const archived = await addResume(file('b.pdf'), {}, db, t0);
    await setResumeArchived(archived.id, true, db, t0);
    expect(await purgeDeletedResumeData({ olderThanMs: 0 }, db, later(1e9))).toBe(0);
    expect((await db.resumes.get(live.id))?.data).toBeDefined();
    expect((await db.resumes.get(archived.id))?.data).toBeDefined();
  });

  it('a resume without bytes has no Blob', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    await deleteResume(resume.id, db, t0);
    await purgeDeletedResumeData({ id: resume.id, olderThanMs: 0 }, db, t0);
    expect(resumeBlob((await db.resumes.get(resume.id))!)).toBeUndefined();
  });
});
