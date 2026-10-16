import {
  addApplication,
  isResumeInUse,
  NotFoundError,
  RECENTLY_DELETED_MS,
  softDeleteApplication,
} from './applications';
import { JobLogDB } from './db';
import {
  addResume,
  checkContents,
  checkResumeFile,
  defaultResumeName,
  deleteResume,
  formatLabel,
  getResume,
  getResumeBlob,
  listResumes,
  MAX_RESUME_BYTES,
  purgeDeletedResumeData,
  restoreResume,
  resumeFileExists,
  ResumeValidationError,
  RESUME_UNDO_WINDOW_MS,
  safeFileName,
  setResumeArchived,
  updateResume,
  type PickedFile,
} from './resumes';

let db: JobLogDB;
beforeEach(() => {
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete();
});

/** The first bytes of real files of each format. */
const HEAD: Record<string, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], // %PDF-1.7
  docx: [0x50, 0x4b, 0x03, 0x04],
  doc: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  rtf: [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31], // {\rtf1
  txt: [0x48, 0x69], // Hi
};

/** A picked file with real bytes; `size` is what the browser reports (defaults to the truth). */
function file(name: string, bytes?: number[], reportedSize?: number): PickedFile {
  const extension = name.split('.').pop()!.toLowerCase();
  const data = new Uint8Array(bytes ?? [...(HEAD[extension] ?? [1, 2, 3]), 1, 2, 3]);
  return {
    name,
    size: reportedSize ?? data.byteLength,
    arrayBuffer: async () => data.slice().buffer,
  };
}

describe('checkResumeFile (before reading)', () => {
  it.each([
    ['cv.pdf', 'application/pdf'],
    ['cv.PDF', 'application/pdf'],
    ['cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['cv.doc', 'application/msword'],
    ['cv.txt', 'text/plain'],
    ['cv.rtf', 'application/rtf'],
  ])('accepts %s, storing %s', (name, mimeType) => {
    expect(checkResumeFile({ name, size: 10 })).toEqual({ mimeType });
  });

  it.each([['photo.png'], ['cv'], ['.pdf'], ['cv.pdf.exe']])('rejects %s', (name) => {
    expect(checkResumeFile({ name, size: 10 })).toEqual({
      error: 'Choose a PDF, DOCX, DOC, TXT or RTF file.',
    });
  });

  it.each([
    [0, 'This file is empty.'],
    [MAX_RESUME_BYTES + 1, 'Choose a file of 10 MB or less.'],
  ])('rejects a reported size of %d bytes', (size, error) => {
    expect(checkResumeFile({ name: 'cv.pdf', size })).toEqual({ error });
  });

  it('accepts exactly 10 MB and 1 byte', () => {
    expect(checkResumeFile({ name: 'cv.pdf', size: MAX_RESUME_BYTES })).toHaveProperty('mimeType');
    expect(checkResumeFile({ name: 'cv.pdf', size: 1 })).toHaveProperty('mimeType');
  });
});

describe('checkContents (after reading)', () => {
  const bytes = (values: number[]) => new Uint8Array(values).buffer;

  it.each(Object.entries(HEAD))('accepts a real %s', (extension, head) => {
    expect(checkContents(`cv.${extension}`, bytes([...head, 0, 0]))).toBeUndefined();
  });

  it.each([
    [
      'cv.pdf',
      HEAD.docx!,
      "This file doesn't look like a PDF. Check that it opens, then try again.",
    ],
    [
      'cv.docx',
      HEAD.pdf!,
      "This file doesn't look like a DOCX. Check that it opens, then try again.",
    ],
    [
      'cv.doc',
      [0x48, 0x69],
      "This file doesn't look like a DOC. Check that it opens, then try again.",
    ],
    [
      'cv.rtf',
      [0x7b, 0x5c],
      "This file doesn't look like a RTF. Check that it opens, then try again.",
    ],
  ])('rejects %s whose bytes are another format', (name, head, error) => {
    expect(checkContents(name, bytes(head))).toBe(error);
  });

  it('accepts any text as TXT, and checks the bytes actually read for size', () => {
    expect(checkContents('cv.txt', bytes([0xff]))).toBeUndefined();
    expect(checkContents('cv.pdf', new ArrayBuffer(0))).toBe('This file is empty.');
    expect(checkContents('cv.txt', new ArrayBuffer(MAX_RESUME_BYTES + 1))).toBe(
      'Choose a file of 10 MB or less.',
    );
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

  it('shortens a long name by characters, keeping the extension and no trailing dot', () => {
    expect(safeFileName(`${'x'.repeat(160)}.pdf`)).toBe(`${'x'.repeat(146)}.pdf`);
    const emoji = safeFileName(`${'🚀'.repeat(200)}.pdf`);
    expect(emoji.endsWith('.pdf')).toBe(true);
    expect(emoji.isWellFormed()).toBe(true);
    expect(safeFileName(`${'x'.repeat(145)}. .pdf`)).toBe(`${'x'.repeat(145)}.pdf`);
  });
});

describe('addResume', () => {
  it('stores metadata and the file apart; the bytes round-trip exactly', async () => {
    const bytes = [...HEAD.pdf!, ...Array.from({ length: 300 }, (_, i) => i % 256)];
    const resume = await addResume(file('Backend v3.pdf', bytes), {}, db);
    expect(resume).toMatchObject({
      name: 'Backend v3',
      fileName: 'Backend v3.pdf',
      mimeType: 'application/pdf',
      size: bytes.length,
      archived: false,
    });
    expect(await db.resumes.get(resume.id)).not.toHaveProperty('data');
    const { blob } = (await getResumeBlob(resume.id, db))!;
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(bytes.length);
    const stored = await db.resumeFiles.get(resume.id);
    expect(Array.from(new Uint8Array(stored!.data))).toEqual(bytes);
  });

  it('stores the size actually read, and checks limits against it', async () => {
    const resume = await addResume(file('cv.pdf', undefined, 5), {}, db);
    expect(resume.size).toBe(11);
    const huge: PickedFile = {
      name: 'cv.pdf',
      size: 5,
      arrayBuffer: async () => new ArrayBuffer(MAX_RESUME_BYTES + 1),
    };
    await expect(addResume(huge, {}, db)).rejects.toBeInstanceOf(ResumeValidationError);
    expect(await db.resumes.count()).toBe(1);
  });

  it('rejects contents that do not match the extension, storing nothing', async () => {
    const error = await addResume(file('cv.pdf', HEAD.docx), {}, db).catch((e: unknown) => e);
    expect((error as ResumeValidationError).fields).toEqual({
      file: "This file doesn't look like a PDF. Check that it opens, then try again.",
    });
    expect(await db.resumes.count()).toBe(0);
    expect(await db.resumeFiles.count()).toBe(0);
  });

  it('takes a display name and note, trimmed', async () => {
    const resume = await addResume(
      file('cv.pdf'),
      { name: '  Backend  v3 ', note: ' For SRE ' },
      db,
    );
    expect(resume).toMatchObject({ name: 'Backend v3', note: 'For SRE' });
  });

  it('reports every problem it can before reading, and stores nothing', async () => {
    const error = await addResume(
      file('photo.png'),
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
    await addResume(file('Backend v3.docx'), {}, db);
    expect((await listResumes(db)).map((r) => r.name)).toEqual(['Backend v3', 'Backend v3']);
  });
});

describe('reading, renaming, archiving', () => {
  it('lists live resumes newest first, archived included, deleted not, without files', async () => {
    const a = await addResume(file('a.pdf'), {}, db, new Date('2026-10-01T00:00:00Z'));
    const b = await addResume(file('b.pdf'), {}, db, new Date('2026-10-02T00:00:00Z'));
    const c = await addResume(file('c.pdf'), {}, db, new Date('2026-10-03T00:00:00Z'));
    await setResumeArchived(b.id, true, db);
    await deleteResume(c.id, db);
    const listed = await listResumes(db);
    expect(listed.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(listed.some((r) => 'data' in r)).toBe(false);
    expect(await getResume(c.id, db)).toBeUndefined();
    expect(await getResumeBlob(c.id, db)).toBeUndefined();
  });

  it('renames, keeping the note unless one is given; an empty note clears it', async () => {
    const resume = await addResume(file('cv.pdf'), { note: 'For SRE' }, db);
    const renamed = await updateResume(resume.id, { name: 'Backend v4' }, db);
    expect(renamed).toMatchObject({ name: 'Backend v4', note: 'For SRE', fileName: 'cv.pdf' });
    const cleared = await updateResume(resume.id, { name: 'Backend v4', note: '' }, db);
    expect(cleared).not.toHaveProperty('note');
  });

  it('archives and unarchives', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    expect((await setResumeArchived(resume.id, true, db)).archived).toBe(true);
    expect((await setResumeArchived(resume.id, false, db)).archived).toBe(false);
  });

  it('refuses to rename or archive a deleted resume', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db);
    await deleteResume(resume.id, db);
    await expect(updateResume(resume.id, { name: 'x' }, db)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setResumeArchived(resume.id, true, db)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('delete rules (spec §4.6)', () => {
  const t0 = new Date('2026-10-01T00:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  async function usedBy(resumeId: string) {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, t0);
    await db.applications.update(app.id, { resumeId, resumeNameSnapshot: 'cv' });
    return app;
  }

  it('archives instead of deleting a resume an application uses', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    await usedBy(resume.id);
    expect(await isResumeInUse(resume.id, db, t0)).toBe(true);
    const { outcome, resume: after } = await deleteResume(resume.id, db, t0);
    expect(outcome).toBe('archived');
    expect(after).toMatchObject({ archived: true });
    expect(after).not.toHaveProperty('deletedAt');
    expect(await db.resumeFiles.get(resume.id)).toBeDefined();
  });

  it('archives while a just-deleted application could still be restored with Undo', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    const app = await usedBy(resume.id);
    await softDeleteApplication(app.id, db, t0);
    expect((await deleteResume(resume.id, db, at(RECENTLY_DELETED_MS - 1))).outcome).toBe(
      'archived',
    );
  });

  it('deletes once that application can no longer come back', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    const app = await usedBy(resume.id);
    await softDeleteApplication(app.id, db, t0);
    expect(await isResumeInUse(resume.id, db, at(RECENTLY_DELETED_MS))).toBe(false);
    expect((await deleteResume(resume.id, db, at(RECENTLY_DELETED_MS))).outcome).toBe('deleted');
  });

  it('says when a resume was already archived, so Undo leaves it archived', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    await usedBy(resume.id);
    expect((await deleteResume(resume.id, db, t0)).wasArchived).toBe(false);
    expect((await deleteResume(resume.id, db, t0)).wasArchived).toBe(true);
  });

  it('checks a file exists without loading it', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    expect(await resumeFileExists(resume.id, db)).toBe(true);
    await deleteResume(resume.id, db, t0);
    expect(await resumeFileExists(resume.id, db)).toBe(false);
    expect(await resumeFileExists('missing', db)).toBe(false);
  });

  it('soft-deletes an unused resume, which Undo restores', async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    expect((await deleteResume(resume.id, db, at(1000))).outcome).toBe('deleted');
    expect(await getResume(resume.id, db)).toBeUndefined();
    const restored = await restoreResume(resume.id, db, at(2000));
    expect(restored).not.toHaveProperty('deletedAt');
    expect(restored.updatedAt).toBe(at(2000).toISOString());
    expect(await getResumeBlob(resume.id, db)).toBeDefined();
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

  it("removes a deleted resume's file once the Undo window has passed", async () => {
    const resume = await addResume(file('cv.pdf'), {}, db, t0);
    await deleteResume(resume.id, db, t0);
    expect(await purgeDeletedResumeData({}, db, later(RESUME_UNDO_WINDOW_MS - 1))).toBe(0);
    expect(await purgeDeletedResumeData({}, db, later(RESUME_UNDO_WINDOW_MS))).toBe(1);
    expect(await db.resumeFiles.get(resume.id)).toBeUndefined();
    // The small record stays, for future sync.
    expect(await db.resumes.get(resume.id)).toMatchObject({
      name: 'cv',
      deletedAt: t0.toISOString(),
    });
    await expect(restoreResume(resume.id, db)).rejects.toBeInstanceOf(NotFoundError);
    expect(await purgeDeletedResumeData({}, db, later(1e9))).toBe(0);
  });

  it('can clear one resume right away (its toast ended), leaving others', async () => {
    const a = await addResume(file('a.pdf'), {}, db, t0);
    const b = await addResume(file('b.pdf'), {}, db, t0);
    await deleteResume(a.id, db, t0);
    await deleteResume(b.id, db, t0);
    expect(await purgeDeletedResumeData({ id: a.id, olderThanMs: 0 }, db, t0)).toBe(1);
    expect(await db.resumeFiles.get(b.id)).toBeDefined();
  });

  it('never touches live or archived resumes', async () => {
    const live = await addResume(file('a.pdf'), {}, db, t0);
    const archived = await addResume(file('b.pdf'), {}, db, t0);
    await setResumeArchived(archived.id, true, db, t0);
    expect(await purgeDeletedResumeData({ olderThanMs: 0 }, db, later(1e9))).toBe(0);
    expect(await purgeDeletedResumeData({ id: live.id, olderThanMs: 0 }, db, later(1e9))).toBe(0);
    expect(await db.resumeFiles.count()).toBe(2);
  });
});
